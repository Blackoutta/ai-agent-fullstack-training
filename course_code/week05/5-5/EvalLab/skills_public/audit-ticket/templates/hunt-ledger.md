# Hypothesis ledger — {TARGET}

<!-- credited to anthropics/defending-code-reference-harness; see ATTRIBUTION.md.
     templates/hunt-ledger.md → incident_<n>/LEDGER.md. The audit trail for a
     /auditor:hunt or /auditor:respond run. Contract and rules:
     references/detection-response/README.md § "The hypothesis ledger". -->

**Run:** incident_{N}/ · **Mode:** hunt | respond · **Opened:** {ISO, est}
**RPC provider:** {domain only — the host's last two DNS labels, as `collect.sh` prints it — or "user-supplied corpus — no collection"} · **Endpoint:** `$RPC_URL` (never written out)
**Corpus:** {files + line counts} · **Window:** slots {from}–{to} ({from blockTime}–{to blockTime}, est)
**Collection gaps:** {every row of `corpus*/collection-gaps.tsv` (signature or address: reason), plus retention limits, a missing v1 opt-in, `Log truncated` tails — never a URL}
**Execution mode (Rule 11a):** {isolated | native — asked once, before the first PoC run or build of target code; passed to every `run.sh` call as `AUDITOR_EXEC_MODE`}
**Snapshots:** {per program: `bin/<id>.so`, last-deployed slot, zero-trimmed sha256 — the hash `run.sh`'s Leg 3 line must name (`OK: reproduced on prebuilt bytes — vulnerable sha256=<…>`)}

## Baseline (from the bundled `profile.sh`)

- Transactions: {n} ({ok} ok / {failed} failed) · versions: {legacy/v0/v1}
- Fee payers (top): {…} · Signers (top): {…}
- Top-level programs: {…}
- Oddities to chase: {…}

## Ledger

Every query is a row; every row names the hypothesis it tested and where it
pivots next. A refuted row stays — it is how "we checked, it's clean" becomes
durable. Stop after two rounds that surface no new entity.

| # | Round | Hypothesis | Source | Query (recipe + args) | Result (a number from the query) | Verdict | Next pivot |
|---|-------|-----------|--------|-----------------------|----------------------------------|---------|------------|
| 1 |   1   | {e.g. one signer drained a vault mint} | transactions.jsonl | `deltas.py tokens … \| group by mint` | {net raw units out, per mint} | supported / refuted / needs-pivot | → H{n} |
| … |       |           |        |                       |                                  |         |            |
| — | stop  | **two rounds, no new entity** | | | | | |

## Suspects carried to source confirmation

| Suspect | Entities (signers / programs / accounts / mints) | Summary | Evidence rows (ledger #) |
|---------|--------------------------------------------------|---------|--------------------------|
| {…} | {…} | {…} | {#…} |
