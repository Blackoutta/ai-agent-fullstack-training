#!/usr/bin/env python3
"""deltas.py — compute balance movements from a getTransaction JSONL corpus, with
every total done in Python integers.

Input: one getTransaction result object per line (`jsonParsed` or `json`), on
stdin or in files named as args — every corpus of an incident at once
(`incident_<n>/corpus*/transactions.jsonl`). A transaction is counted once however
many inputs hold it: the first occurrence of each signature wins, and the number
skipped is reported on stderr. The corpus is streamed one transaction at a time,
and every named file is opened once before the first row is written: a missing or
unreadable one exits 1 with no output.

Two modes:
  deltas.py lamports [files...]   per (signature, account) non-zero lamport delta;
                                  the fee is added back for the fee payer (index 0),
                                  so the row reflects movement, not the fee.
  deltas.py tokens   [files...]   per (signature, token account, mint) raw-unit
                                  token delta; columns: signature, owner (a label,
                                  `?` when the RPC gave none), mint, delta, token
                                  account.

Output: TSV. Signatures, owners and mints are base58 in real RPC data and deltas
are decimal integers; any tab, newline, carriage return or backslash in a string
field is escaped (`\\t`, `\\n`, `\\r`, `\\\\`), so a crafted corpus cannot forge a
row. Token deltas are per token account (its `accountIndex` resolved through the
transaction's account keys) and mint, so two accounts never share a bucket, even
when the RPC gives no owner; sum the rows per owner for an owner's net, which nets
a move between one owner's accounts to zero and adds up a drain across several.
Aggregate further in Python ints — never in jq or awk, whose numbers are doubles.

Why Python ints, not jq: a u64 token amount or a lamport balance can exceed 2^53,
and jq numbers are IEEE doubles. Over the adversarial fixture
`token-amount-over-2-53.jsonl`, `jq` reports a delta of 2 for a true 1 and drops
a true 1 entirely. Python's `int` is arbitrary precision, and these amounts arrive
as JSON strings (`uiTokenAmount.amount`) or as JSON integers that Python parses
losslessly, so the arithmetic is exact.

Success-only: a failed transaction commits no instruction state (atomic revert —
`references/false-positives.md` FP-4), so a delta from a failed tx would be a
phantom. Both modes skip `meta.err != null`.

Account indexing note: in `jsonParsed`, `accountKeys` already includes
lookup-table-loaded addresses, so it lines up 1:1 with pre/postBalances. With
`encoding: json`, append `meta.loadedAddresses.writable` then `.readonly` to the
static keys before indexing; this script handles both.

Run it as `python3 -I "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/deltas.py" tokens|lamports
<corpus.jsonl>`. Isolated mode keeps the working directory (usually the audited
repo) and PYTHONPATH off sys.path, so it imports nothing beyond the stdlib — keep
it that way: no sibling modules.

No network. python3 stdlib only.
"""

from __future__ import annotations

import json
import sys
from collections import OrderedDict


def _account_keys(tx: dict) -> list[str]:
    msg = (tx.get("transaction") or {}).get("message") or {}
    keys = []
    for k in msg.get("accountKeys") or []:
        keys.append(k["pubkey"] if isinstance(k, dict) else k)
    # encoding: json keeps loaded (ALT) addresses out of accountKeys; jsonParsed
    # already folds them in. Append only when they are not already present.
    loaded = (tx.get("meta") or {}).get("loadedAddresses") or {}
    if loaded and len(keys) < len(((tx.get("meta") or {}).get("preBalances")) or []):
        keys += list(loaded.get("writable") or [])
        keys += list(loaded.get("readonly") or [])
    return keys


def _ok(tx: dict) -> bool:
    return (tx.get("meta") or {}).get("err") is None


def _clean(s) -> str:
    """Escape the bytes that could break a TSV row. Real RPC data carries base58
    here, but a corpus can come from an untrusted export, so a key or mint holding a
    tab or newline must not be able to forge an extra row or column."""
    return (str(s).replace("\\", "\\\\").replace("\t", "\\t")
            .replace("\n", "\\n").replace("\r", "\\r"))


def _lamports(txs, out):
    for tx in txs:
        if not _ok(tx):
            continue
        meta = tx.get("meta") or {}
        pre = meta.get("preBalances") or []
        post = meta.get("postBalances") or []
        fee = int(meta.get("fee") or 0)
        keys = _account_keys(tx)
        sig = ((tx.get("transaction") or {}).get("signatures") or ["?"])[0]
        for i in range(min(len(pre), len(post), len(keys))):
            d = int(post[i]) - int(pre[i]) + (fee if i == 0 else 0)
            if d != 0:
                out.write(f"{_clean(sig)}\t{_clean(keys[i])}\t{d}\n")


def _tokens(txs, out):
    for tx in txs:
        if not _ok(tx):
            continue
        meta = tx.get("meta") or {}
        sig = ((tx.get("transaction") or {}).get("signatures") or ["?"])[0]
        keys = _account_keys(tx)
        acc: "OrderedDict[tuple[str, str], list[int]]" = OrderedDict()
        labels: dict = {}

        def fold(entries, slot):
            for b in entries or []:
                owner = b.get("owner") or "?"
                mint = b.get("mint") or "?"
                amt = (b.get("uiTokenAmount") or {}).get("amount")
                # amount is a decimal STRING of the raw u64/u128; int() is exact.
                val = int(amt) if amt is not None else 0
                # Keyed by the token account, so two accounts never merge — not even
                # two owner-less ones. Without a usable accountIndex the owner is the
                # key; SUM, never assign, in that bucket. Fixtures: same-owner-move.jsonl
                # (two legs, net 0 for the owner), same-owner-drain.jsonl (-140 for
                # the owner, over two accounts).
                idx = b.get("accountIndex")
                account = keys[idx] if type(idx) is int and 0 <= idx < len(keys) else None
                key = (account if account is not None else "owner:" + owner, mint)
                acc.setdefault(key, [0, 0])[slot] += val
                if key not in labels or b.get("owner"):
                    labels[key] = (owner, account or "?")

        fold(meta.get("preTokenBalances"), 0)
        fold(meta.get("postTokenBalances"), 1)
        for key, (p, q) in acc.items():
            d = q - p
            if d != 0:
                owner, account = labels[key]
                out.write(f"{_clean(sig)}\t{_clean(owner)}\t{_clean(key[1])}\t{d}\t{_clean(account)}\n")


def _unreadable(paths):
    """The first input that cannot be opened, as "<path>: <reason>", else None. Checked
    before the first row is written, so a bad later file never leaves partial output."""
    for path in paths:
        if path == "-":
            continue
        try:
            open(path, encoding="utf-8", errors="replace").close()
        except OSError as e:
            return f"{path}: {e.strerror or e}"
    return None


def _signature(tx: dict):
    sigs = (tx.get("transaction") or {}).get("signatures") or []
    return sigs[0] if sigs and isinstance(sigs[0], str) else None


def _iter_tx(argv, dupes):
    """Yield one transaction at a time, so the corpus is never held in memory, and
    each signature once: a later copy (the same transaction in a second corpus) is
    skipped and counted in dupes[0]."""
    seen = set()
    srcs = argv or ["-"]
    for path in srcs:
        fh = sys.stdin if path == "-" else open(path, encoding="utf-8", errors="replace")
        try:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                sig = _signature(obj)
                if sig is not None:
                    if sig in seen:
                        dupes[0] += 1
                        continue
                    seen.add(sig)
                yield obj
        finally:
            if fh is not sys.stdin:
                fh.close()


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ("lamports", "tokens"):
        print("usage: deltas.py lamports|tokens [files...]", file=sys.stderr)
        return 2
    mode, files = argv[0], argv[1:]
    bad = _unreadable(files)
    if bad:
        print(f"deltas.py: cannot read {bad}", file=sys.stderr)
        return 1
    dupes = [0]
    txs = _iter_tx(files, dupes)
    if mode == "lamports":
        _lamports(txs, sys.stdout)
    else:
        _tokens(txs, sys.stdout)
    if dupes[0]:
        print(f"deltas.py: skipped {dupes[0]} transaction(s) already read under the same signature",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
