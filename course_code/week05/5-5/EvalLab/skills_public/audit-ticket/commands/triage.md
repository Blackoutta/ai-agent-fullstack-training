---
name: auditor:triage
description: Re-runnable batch triage checkpoint over the candidate finding set (fixes triage being diffused across agents). Dedups by root-cause signature (reusing /re-audit's signature idea; audit-mem auto-suppresses prior-ruled false positives and flags regressions when built), enforces Rule 5b calibration (every N≥6 carries its validation block or is downgraded to [UNCONFIRMED]/[UNDETERMINED], with any economic/reachability downgrade quantified per the false-positives "quantify the barrier" rule), and splits real security findings (severity 1–10) from the Notes & Nitpicks list. Emits a triaged finding set plus a suppression appendix recording what was withheld and why.
argument-hint: "[audit_<n>] [--program-id <id>]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# auditor-skill — Batch Triage Checkpoint

**Arguments:** $ARGUMENTS

Run one **consolidated** triage pass over the candidate finding set, so calibration is a single auditable checkpoint instead of being diffused across the leaf reviewers. Read `OUTPUT-RULES.md` first — **Rule 1** (severity 1–10, the "Notes & Nitpicks" tier below severity 1), **Rule 5b** (the validation gate + `[UNCONFIRMED]`/`[UNDETERMINED]` outcomes) — and `references/false-positives.md` (the triage catalog + the "quantify the barrier" symmetric-rejection rule). Re-run this after any new review phase adds candidates.

## Input

The current candidate set — every `[FAIL-N]` / `[PARTIAL]` / `[UNCONFIRMED]` the reviewers have emitted this run (from `audit_<n>/` worksheets / session findings). Triage is idempotent: re-running folds in new candidates without re-litigating settled ones.

## Steps

1. **Dedup by root-cause signature.** Collapse candidates that share a **root-cause signature** — the normalized code shape of the bug (e.g. a missing signer check, an unchecked `*`, a PDA derived without the stored bump), the same signature `/auditor:re-audit` uses for its sibling sweep. Two candidates with the same signature at the same root cause are **one** finding (record all locations); the same signature at *different* sites are siblings (keep separate, note the shared class).
   - If the bundled tools are built (`test -x "${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem"`) and the store passes the `OUTPUT-RULES.md` Rule 11d check, run again now since a later pull can change the answer (`GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false --icase-pathspecs ls-files -- .audit-memory` prints nothing and exits 0, and you created the store; any output, in any letter case, or any error means a fresh `--db <path outside the tree>` store, which holds no prior rulings), run `"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" check --program-id <id> --signature <sig>` per candidate (always this absolute path, never a relative `tools/` one): an authoritative `FALSE_POSITIVE` ruling **auto-suppresses** the candidate to `[N/A — prior ruling #<id>]` (record the ruling id in the suppression appendix — never drop it silently). `"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" regressions --program-id <id>` flags any `finding_id` previously `FIXED` and now re-observed as **`REGRESSED`** (deterministic). If the tools are absent, dedup by signature manually and note the tooling gap. (See `references/orchestration/pre-scan.md`.)

2. **Rule 5b calibration (the gate, applied in batch).** Every candidate at **N≥6** must carry a filled **Reachability** + **Math/State-Bounds** block (plus **Attacker-Model** for **N≥7**). A candidate that cannot complete the gate with cited evidence is **downgraded** — never left as a bare `[FAIL-N]`:
   - `[UNCONFIRMED]` — the gate failed on reachability or bounds (unreachable / unbounded as written); reported for manual follow-up, **not** counted as a confirmed FAIL.
   - `[UNDETERMINED]` — the path **is** reachable but its full impact could not be quantified in scope; carried at its likely severity band with "extent not determined within this assessment". Reachable-but-unquantified ≠ unreachable.
   - Cross-check each candidate against `references/false-positives.md` (FP-1…FP-6 + the fast pass): a candidate matching an entry needs the **specific escape** cited to `file:line`, or it is downgraded.
   - **Quantify every downgrade.** A rejection on "not profitable" / "not exploitable" must show the **worked bound** — concrete numbers (capital vs. max extractable, cost > gain by how much) or the **named blocking precondition** @ `file:line`. A bare "not profitable" / "attacker gains nothing" is **not** a valid rejection (symmetric to an unquantified High): the finding stays open (`[PARTIAL]`/`[UNCONFIRMED]`) until the barrier is computed. Delegate re-derivation of contested N≥8 candidates to `peer-reviewer` if a judgment call needs an independent read.

3. **Tier split.** Partition the survivors into two lists:
   - **Security findings (severity 1–10)** — real issues with a security impact. These get inline verdicts (Rule 4) and full blocks at N≥4 (Rule 5) / the client report's findings section.
   - **Notes & Nitpicks (below severity 1)** — observations with **no security impact**: style, naming, redundant code, micro-optimizations, documentation gaps (`OUTPUT-RULES.md` Rule 1). A bulleted `file:line — observation` list, no severity, no remediation-tracking obligation. A note graduates to a severity-1 Informational finding only if it carries a concrete (if minor) security implication — do not inflate nits into findings, and do not bury a real syntactic gap as a nit.

4. **Record occurrences (if tools built).** For each surviving finding, `"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" put-finding …` records an occurrence for this run so dedup / regression / FP state persists across audits. Skip if the tools are absent.

## Output

Emit the triaged set (not a fresh report — this feeds synthesis / the checkpoint):
- **Triaged security findings** — deduped, severity-ordered, each carrying its Rule 5b outcome tag.
- **Notes & Nitpicks** — the below-severity-1 list.
- **Suppression appendix** — everything withheld and **why**: each `[N/A — prior ruling]` (with ruling id), each Rule 5b downgrade (with the quantified barrier or named precondition), and each dedup merge (which candidates collapsed into which finding). A reviewer must be able to see exactly what was cut and on what basis — nothing is suppressed silently.
