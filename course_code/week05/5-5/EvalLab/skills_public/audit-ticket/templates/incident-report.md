# Incident report — {TARGET}

<!-- credited to anthropics/defending-code-reference-harness; see ATTRIBUTION.md.
     templates/incident-report.md → incident_<n>/INCIDENT_REPORT.md, written by
     /auditor:hunt. The human-readable companion to INCIDENTS.json. Verdict rules:
     references/detection-response/README.md. Nothing here is an action — the
     proposed response is RESPONSE-INC-<n>.<k>.md. -->

**Run:** incident_{N}/ · **Date:** {ISO} · **Mode:** hunt
**Corpus:** {files + line counts} · **Window:** slots {from}–{to} · **RPC provider:** {domain (the host's last two DNS labels), or user-supplied}
**Execution mode (Rule 11a):** {isolated — which isolation | native — target code ran on the auditor's host, and which steps ran it; copied from the ledger header}
**Verdict legs met per incident:** on-chain effect / flaw in deployed source / local PoC on real bytes.

## Executive summary

{Three sentences at most: what happened, whether it succeeded, the single most
important next action. If funds may still be moving, the first line says so and
points at the pause runbook and SEAL 911 — this report is not emergency response.}

## Unified timeline

Ordered by `(slot, transactionIndex)`, not by `blockTime` (an estimate). One row
per pivotal event across all incidents.

| Slot | idx | Signature | Actor | Event |
|------|-----|-----------|-------|-------|
| {…} | {…} | {…} | {…} | {…} |

## INC-{N}.{k} — {title}

- **Verdict:** {confirmed_exploited | suspected} · **Outcome:** {succeeded | failed | partial | undetermined} · **Urgency:** {immediate | urgent | routine}
- **Root cause class:** {code_flaw | key_compromise | …}

**On-chain evidence (Leg 1).** {balance/token deltas, or the four-part account-data
check for a takeover — each a query result, at `finalized`. A program-log line is a
hint, never the proof.}

**Source confirmation (Leg 2).** {file:function in the source deployed at the
incident slot; the missing/wrong check; sibling instructions checked.}

**PoC (Leg 3).** {tier + `poc/INC-{N}.{k}/run.sh` and its final line, `OK: reproduced
on prebuilt bytes — vulnerable sha256=<the snapshot's hash> …`; the real-bytes
provenance — dumped-unchanged / rebuilt-hash-match / …; if a fixed arm ran, how it
held (the pinned error for our patch; blocked for a deployed hotfix). If Leg 3 unmet,
say why and that the verdict ceiling is `suspected`.}

**Blast radius.** {records, distinct victims, raw units out per mint, window — all
from queries. Victim lists stay in INCIDENTS.json, not here.}

## Ruled out

| Subject | Verdict | Reason (defense at file:function, or benign explanation) |
|---------|---------|----------------------------------------------------------|
| {e.g. scanner hitting a parameterized/guarded instruction} | attempted_not_vulnerable | {…} |
| {benign top-talker} | benign | {…} |

## Collection gaps

{What this corpus cannot answer: every row of `corpus*/collection-gaps.tsv` (a
failed fetch, a page cap where older history may exist, the `--max-tx` cap, a stop
after ten failed fetches in a row), provider retention, a missing v1 opt-in, a
`Log truncated` tail, an un-fetched sibling address. Never a URL.}

## Appendix — hypothesis ledger

{The full LEDGER.md, refuted rows included — this is what lets someone else check
the hunt step by step.}

## Next steps

- `/auditor:respond INC-{N}.{k}` — widen the scope, size the damage, and draft the plan.
- `/auditor:poc INC-{N}.{k}` / `/auditor:patch INC-{N}.{k}` — Leg-3 PoC and a verified fix.
