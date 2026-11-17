# scripts/dnr — detection & response recipes

The shipped recipes behind `/auditor:hunt` and `/auditor:respond`. They turn a
Solana transaction corpus into the small aggregates an investigator quotes in a
ledger, **without reading the raw corpus into a context window** — a real corpus
is far larger than any window (one mainnet transaction is ~20 KB of JSON, so
100k transactions runs to gigabytes). Profile and query it; never `cat` it into
the conversation.

Full method and the verdict rules these feed: `references/detection-response/`.

| File | What it does |
|------|--------------|
| `snapshot-program.sh` | Step 1 of every run: read-only `solana program show` + `dump` (loader-v4: `program-v4 show` + `download`) of each implicated program into `incident_<n>/bin/`, from a throwaway CLI config (no URL in argv, no keypair to sign with), printing the last-deployed slot (`n/a (immutable loader)` for BPFLoader2) and the zero-trimmed sha256 for the ledger — before a hotfix can overwrite the incident binary. The slot is read again after the dump. A snapshot is never overwritten: a later one of a redeployed program is kept as `bin/<id>@<slot>.so`, and a program that has not changed prints `unchanged`. Refuses an id that is not a base58 32-byte key, and a run directory that is a symbolic link, holds one, is tracked by git, or that git or find cannot check. |
| `collect.sh` | The gated collector: pages signature history (failed transactions included — they are attempt evidence) and fetches transactions into a local JSONL corpus, integers exact on any jq. Refuses without `--confirmed`, on any input that is not base58, when `--out` already holds any corpus file, and when `--out` or its `incident_*` directory is a symbolic link, holds one, is tracked by git, or cannot be checked by git or find; read-only RPC only; capped (`--max-tx` counts every `getTransaction` call) and stops after ten failed calls in a row; pages until an empty page (a shorter page ends the history only on the cap's last page); reports when the page cap stops on a full page, where older history may exist, and writes every gap (a failed fetch, that page cap, the `--max-tx` cap, a stop) to `collection-gaps.tsv`. |
| `profile.sh` | Baseline a `transactions.jsonl`: outcome / version histograms, time window, fee-payer, signer and top-level-program inventories — all from structural fields, never from log text. |
| `frames.py` | Attribute each `Program log:` / `Program data:` line to the program frame that emitted it, as JSONL. Walks the log array one element at a time with anchored regexes. With `--instructions`, emits the runtime-recorded instructions instead (`ix`: top-level and CPI, program, accounts, data as given) and the runtime invoke lines joined to them (`invoke`), which is how Leg 1 names the instruction that ran. |
| `deltas.py` | `lamports` or `tokens`: per-account / per-(token account, mint) balance movement, with the owner as a label, computed in Python integers, successful transactions only. |
| `redact.sh` | A stderr/stdout filter that strips provider credentials (e.g. `?api-key=…`, a `/v2/<key>` path, a token in a subdomain, curl's verbose request lines) before text reaches the transcript, the ledger, or a report. |
| `fixtures/` | Committed adversarial corpora the self-test and the docs cite. |

## Running them

Always from the auditor-skill installation, by absolute path —
`<auditor-skill root>/scripts/dnr/…`, the root the invoking command gave you
(`OUTPUT-RULES.md` Rule 11e) — and never as a `scripts/…` path relative to the
working directory, which during an incident is usually the
audited repo and may ship a same-named file. The python recipes run as
`python3 -I` (isolated: neither the working directory nor `PYTHONPATH` reaches
`sys.path`), so they import only the stdlib and never a sibling module.
`snapshot-program.sh` hashes with `python3 -I` for the same reason.

```bash
bash "<auditor-skill root>/scripts/dnr/profile.sh" <corpus.jsonl>...
python3 -I "<auditor-skill root>/scripts/dnr/frames.py" [--instructions] <corpus.jsonl>...
python3 -I "<auditor-skill root>/scripts/dnr/deltas.py" tokens|lamports <corpus.jsonl>...
```

Each takes every corpus of an incident at once
(`incident_<n>/corpus*/transactions.jsonl`) and reads a transaction that more
than one of them holds once, by signature, saying how many copies it skipped.

## Two hazards these encode, and why

- **A program log can forge a frame.** `Program log:` text is attacker-chosen and
  can contain a newline followed by a counterfeit `Program <id> invoke [1]` line.
  Flattening the log array (`jq -r '.meta.logMessages[]' | grep …`) splits on that
  newline and invents frames — `fixtures/log-newline-injection.jsonl` turns one
  real invoke into two under a naive flatten. `frames.py` reads the JSON array
  element by element, so a newline inside a payload never becomes a new record.
- **u64 amounts overflow a double.** A token amount or lamport balance can exceed
  2^53, and `jq` numbers are IEEE doubles. Over
  `fixtures/token-amount-over-2-53.jsonl`, `jq` reports a true delta of 1 as 0 for
  one row and as 2 for another. `deltas.py` does every total in Python integers,
  reading amounts from their JSON-string form, so the arithmetic is exact.

Both properties are pinned by `scripts/tests/test-dnr.sh`, which also plants a
`json.py` / `re.py` / `hashlib.py` in the working directory and on `PYTHONPATH`
and checks that none of them loads.

## What a log line proves

`Program log:` / `Program data:` lines and `emit_cpi!` event payloads are
**program-asserted**: a (possibly compromised) program said them, and they still
appear when a later instruction in the same transaction fails. They attribute an
utterance to a frame; they never prove a state change happened (KV-122), and an
`Instruction: X` line never proves which instruction ran — `frames.py
--instructions` reads that from the runtime-recorded instruction lists. A verdict
is grounded in runtime-recorded effects — `meta.err`, balance deltas, and the
account's current value — at `finalized`, not in log text. See
`references/detection-response/README.md`.

## Not a sandbox

These scripts run on the auditor's machine and read whatever corpus they are
pointed at; `collect.sh` makes outbound RPC calls. None of them is pre-approved by
the commands' `allowed-tools`, so each run asks for approval; those lists, and these
recipes, shape intent and are not a security boundary (see
`references/detection-response/README.md` § "allowed-tools is not a sandbox"). Confinement, when you need it, is an isolated
run mode (`OUTPUT-RULES.md` Rule 11a).

## Local tooling

`jq`, `python3` (3.8+, stdlib only, run with `-I`) and `curl`. For a corpus too
large for `grep` passes, the same queries translate to DuckDB SQL over the JSONL;
DuckDB is optional and not required by anything here.
