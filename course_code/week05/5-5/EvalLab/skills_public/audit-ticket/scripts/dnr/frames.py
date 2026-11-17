#!/usr/bin/env python3
"""frames.py — attribute each program-emitted log line to the program frame that
emitted it, reading a getTransaction JSONL corpus.

Input: one getTransaction result object per line (the `result` field of an RPC
response, encoding `jsonParsed` or `json`), on stdin or in files named as args —
every corpus of an incident at once (`incident_<n>/corpus*/transactions.jsonl`).
Each signature is read once: a later copy of the same transaction is skipped, and
the number skipped is reported on stderr.
Output: JSONL, one record per emitted log line:

    {"sig": "...", "ok": true, "depth": 2, "program": "<id|?>",
     "kind": "log|data|return|truncated|unparsed", "text": "..."}

With `--instructions`, it emits instead what the runtime recorded about each
instruction, for Leg 1's "which instruction ran":

    {"sig", "ok", "kind": "ix", "seq": k, "top": i, "inner": j|null,
     "stack_height": h|null, "program": "<id|?>", "data": "<base58 as given>"|null,
     "data_status": "raw|parsed-only|absent", "accounts": [...]}
        one per instruction, from the transaction's own instruction lists:
        `transaction.message.instructions[i]` (inner = null) and
        `meta.innerInstructions[*].instructions[j]` of top-level instruction i
        (a CPI), in execution order (seq). `data` is exactly what the RPC gave;
        a jsonParsed instruction decoded by the RPC carries `parsed` and
        `program_name` instead, marked "parsed-only". No field of an `ix` record
        comes from the logs.
    {"sig", "ok", "kind": "invoke", "seq": m, "program": "<id>", "depth": N,
     "outcome": "success|failed: ...|null", "ix_seq": k|null}
        one per runtime `Program <id> invoke [N]` line, with the outcome its
        matching success / failed line gave (null when the log ends first), and
        the `ix` record it ran: matched in order on program id and depth (stack
        height); an instruction with no invoke line is passed over.

Design rules, each forced by a real failure mode:

  * Walk `logMessages` one element at a time. Never flatten the array into one
    string and grep it: a `\\n` inside a `Program log:` payload would then forge
    frame lines (adversarial fixture `log-newline-injection.jsonl` turns 2 logs
    into 4 apparent frames under `jq -r '.[]' | grep`). JSON arrays keep each log
    a single element no matter what bytes it contains, so the newline never
    splits a record here.
  * Match invoke / success / failure lines ANCHORED at start-of-string with the
    base58 program-id shape. A program can emit `Program log: ... invoke [1]`
    (Anchor's own client carries a regression test for exactly that string); an
    unanchored contains-match would pop the frame stack on it.
  * A `Program log:` / `Program data:` line is PROGRAM-ASSERTED. It attributes an
    utterance to a frame; it is never proof that a state change happened (KV-122).
    Downstream verdict logic must treat `kind in {log,data,return}` as a hint.
  * Output is JSONL with the raw text in a JSON string, so tabs/newlines inside a
    payload are escaped by the encoder and can never break a column.

Run it as `python3 -I "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/frames.py" [--instructions] <corpus.jsonl>...`.
Isolated mode keeps the working directory (usually the audited repo) and
PYTHONPATH off sys.path, so it imports nothing beyond the stdlib — keep it that
way: no sibling modules.

No network. stdlib only.
"""

from __future__ import annotations

import json
import re
import sys

# base58 (Bitcoin alphabet) pubkey, 32..44 chars — the shape of a program id.
_B58 = r"[1-9A-HJ-NP-Za-km-z]{32,44}"
_INVOKE = re.compile(rf"^Program ({_B58}) invoke \[(\d+)\]$")
_EXIT = re.compile(rf"^Program ({_B58}) (success|failed: .*)$")
_LOG = "Program log: "
_DATA = "Program data: "
_RETURN = re.compile(rf"^Program return: ({_B58}) (.*)$")
_CONSUMED = re.compile(rf"^Program ({_B58}) consumed \d+ of \d+ compute units$")


def _rows(tx: dict):
    meta = tx.get("meta") or {}
    txn = tx.get("transaction") or {}
    sigs = txn.get("signatures") or []
    sig = sigs[0] if sigs else "?"
    ok = meta.get("err") is None
    stack: list[str] = []
    for msg in meta.get("logMessages") or []:
        if not isinstance(msg, str):
            continue
        m = _INVOKE.match(msg)
        if m:
            stack.append(m.group(1))
            continue
        if _EXIT.match(msg):
            if stack:
                stack.pop()
            continue
        if _CONSUMED.match(msg):
            continue
        depth = len(stack)
        prog = stack[-1] if stack else "?"
        if msg == "Log truncated":
            yield {"sig": sig, "ok": ok, "depth": depth, "program": prog,
                   "kind": "truncated", "text": ""}
        elif msg.startswith(_LOG):
            yield {"sig": sig, "ok": ok, "depth": depth, "program": prog,
                   "kind": "log", "text": msg[len(_LOG):]}
        elif msg.startswith(_DATA):
            yield {"sig": sig, "ok": ok, "depth": depth, "program": prog,
                   "kind": "data", "text": msg[len(_DATA):]}
        elif (r := _RETURN.match(msg)):
            yield {"sig": sig, "ok": ok, "depth": depth, "program": r.group(1),
                   "kind": "return", "text": r.group(2)}
        else:
            # A runtime diagnostic with no program prefix (e.g. a bare
            # "<pubkey> signer_key().is_none()" before a failure). Keep it,
            # attributed to the open frame, flagged so it is never mistaken for
            # a program-asserted log.
            yield {"sig": sig, "ok": ok, "depth": depth, "program": prog,
                   "kind": "unparsed", "text": msg}


def _keys(tx: dict) -> list:
    """The transaction's account keys, in index order: jsonParsed folds lookup-table
    addresses in; encoding json lists them in meta.loadedAddresses."""
    msg = (tx.get("transaction") or {}).get("message") or {}
    keys = [k.get("pubkey") if isinstance(k, dict) else k for k in msg.get("accountKeys") or []]
    loaded = (tx.get("meta") or {}).get("loadedAddresses") or {}
    if isinstance(loaded, dict) and loaded and not any(isinstance(k, dict) for k in msg.get("accountKeys") or []):
        keys += list(loaded.get("writable") or []) + list(loaded.get("readonly") or [])
    return keys


def _ix_record(ix, keys, sig, ok, seq, top, inner):
    if not isinstance(ix, dict):
        ix = {}
    pidx = ix.get("programIdIndex")
    program = ix.get("programId")
    if program is None and type(pidx) is int and 0 <= pidx < len(keys):
        program = keys[pidx]
    accounts = []
    for a in ix.get("accounts") or []:
        accounts.append(keys[a] if type(a) is int and 0 <= a < len(keys) else a)
    rec = {"sig": sig, "ok": ok, "kind": "ix", "seq": seq, "top": top, "inner": inner,
           "stack_height": ix.get("stackHeight"), "program": program or "?",
           "data": ix.get("data") if isinstance(ix.get("data"), str) else None}
    if rec["data"] is not None:
        rec["data_status"] = "raw"
    elif "parsed" in ix:
        rec["data_status"] = "parsed-only"
        rec["program_name"] = ix.get("program")
        rec["parsed"] = ix.get("parsed")
    else:
        rec["data_status"] = "absent"
    rec["accounts"] = accounts
    return rec


def _instruction_rows(tx: dict):
    """`ix` records from the instruction lists, then `invoke` records from the
    runtime's invoke / success / failed lines, each joined to the `ix` it ran."""
    meta = tx.get("meta") or {}
    txn = tx.get("transaction") or {}
    sigs = txn.get("signatures") or []
    sig = sigs[0] if sigs else "?"
    ok = meta.get("err") is None
    keys = _keys(tx)
    inner_by_top: dict = {}
    for group in meta.get("innerInstructions") or []:
        if isinstance(group, dict) and type(group.get("index")) is int:
            inner_by_top.setdefault(group["index"], []).extend(group.get("instructions") or [])
    ixs = []
    for i, ix in enumerate((txn.get("message") or {}).get("instructions") or []):
        ixs.append(_ix_record(ix, keys, sig, ok, len(ixs), i, None))
        for j, inner in enumerate(inner_by_top.get(i, [])):
            ixs.append(_ix_record(inner, keys, sig, ok, len(ixs), i, j))
    yield from ixs
    invokes, stack, ptr = [], [], 0
    for msg in meta.get("logMessages") or []:
        if not isinstance(msg, str):
            continue
        m = _INVOKE.match(msg)
        if m:
            program, depth = m.group(1), int(m.group(2))
            match = None
            while ptr < len(ixs):
                cand = ixs[ptr]
                ptr += 1
                want = 1 if cand["inner"] is None else cand["stack_height"]
                if cand["program"] == program and (depth == want or (want is None and depth >= 2)):
                    match = cand["seq"]
                    break
            rec = {"sig": sig, "ok": ok, "kind": "invoke", "seq": len(invokes), "program": program,
                   "depth": depth, "outcome": None, "ix_seq": match}
            invokes.append(rec)
            stack.append(rec)
            continue
        e = _EXIT.match(msg)
        if e and stack:
            stack.pop()["outcome"] = e.group(2)
    yield from invokes


def _iter_lines(argv: list[str]):
    if argv:
        for path in argv:
            with open(path, encoding="utf-8", errors="replace") as fh:
                yield from fh
    else:
        yield from sys.stdin


def main(argv: list[str]) -> int:
    out = sys.stdout
    rows = _rows
    if argv[:1] == ["--instructions"]:
        rows, argv = _instruction_rows, argv[1:]
    seen: set[str] = set()
    dupes = 0
    for line in _iter_lines(argv):
        line = line.strip()
        if not line:
            continue
        try:
            tx = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"kind": "parse_error", "text": line[:200]}), file=out)
            continue
        if not isinstance(tx, dict):
            continue
        sigs = (tx.get("transaction") or {}).get("signatures") or []
        if sigs and isinstance(sigs[0], str):
            if sigs[0] in seen:
                dupes += 1
                continue
            seen.add(sigs[0])
        for row in rows(tx):
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
    if dupes:
        print(f"frames.py: skipped {dupes} transaction(s) already read under the same signature",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
