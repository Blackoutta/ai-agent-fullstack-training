---
name: auditor:audit-assist
description: Flow B — AI-assisted iterative audit with a human in the loop. Same lifecycle as audit-cycle, but pauses at checkpoints to surface confirmed findings, the next-focus plan, and targeted questions only the human can answer (business context, trust model, severity calls). The human steers; the agent re-synthesizes toward the audit document.
argument-hint: "[path] [--scope full|program|backend|frontend]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# auditor-skill — Flow B: AI-Assisted Iterative Audit (Human-in-the-Loop)

**Arguments:** $ARGUMENTS

Run the same lifecycle as `/auditor:audit-cycle`, but **stop at checkpoints** and let the human steer. Read `OUTPUT-RULES.md` first (format, severity 1-10, **Rule 5b** gate) and `references/audit-lifecycle/methodology.md` (the firm-spine → skill-mechanism mapping). This is the collaborative mode: the agent does the mechanical review; the human resolves the judgment calls a tool cannot (business intent, trust boundaries, severity of a business-logic gap). Think ToB weekly progress report + Zellic client discussion.

Run bundled scripts, tools and Trail of Bits plugins only from the auditor-skill installation (`${CLAUDE_PLUGIN_ROOT}`; for a non-plugin install, the directory holding this skill's SKILL.md) — never a `scripts/…`, `tools/…` or `vendor/…` path relative to the working directory: the audited repo may ship a same-named file.

Operating safety follows `OUTPUT-RULES.md` Rule 11. Target-controlled code (builds, test suites, harnesses) and every PoC build run in the execution mode recorded at intake (`Q46`, Rule 11a); if none is recorded, ask once at Checkpoint 1 and record it in `intake.md` §8 (a non-interactive run is native, and the report says so).

## Checkpoint protocol

At **every checkpoint**, surface a compact status and then **wait for the human** before proceeding:
- **(a) Confirmed findings so far** — severity-ordered, each already through Rule 5b + `references/false-positives.md`.
- **(b) Next-focus plan** — which surfaces / instructions / vectors are queued next and why.
- **(c) Targeted questions** — the specific things only the human can answer: business context, the intended trust / threat model, whether a flagged behavior is intentional, and severity calls that depend on off-chain assumptions. Ask sharp, answerable questions — not "anything to add?".

Fold the human's answers back in, re-synthesize, and continue.

## Lifecycle with checkpoints

1. **Scope / intake.** Discover the repo, declare scope (Rule 0), pin the commit. **⏸ Checkpoint 1 — after scope:** confirm the scope boundary, the pinned commit, and any `QUESTIONS.md` answers the human wants to override before a single file is judged. Persist the confirmed answers to `audit_<n>/intake.md` (`/intake`) so both flows and the report read one source of truth.

2. **Context reconstruction (Phase 0.5).** Spawn `context-builder`; it writes worksheets to `audit_<n>/worksheets/context/`. **⏸ Checkpoint 2 — after context:** present the instruction matrix + state model and the reconstructed invariants/assumptions. Ask the human to correct any `UNKNOWN — needs manual review` items and confirm the trust model. Their corrections seed every later phase. With the trust model confirmed, build `audit_<n>/threat-model.md` (`/threat-model`) — asset inventory + actor×capability + trust boundaries — which feeds report §4.4/§4.6/§4.7 and the review's attacker goals.
   - **Bootstrap triggers.** T2 is intake §7. For T3/T4 run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/threat-model/collect.sh" --repo <target> --out audit_<n>/bootstrap --pin <sha> --detect`.
   - **Offline collection.** If any trigger fires, collect offline (`--offline`) before the checkpoint.
   - **At this checkpoint:** ask whether a member of the protocol team is on hand to answer design questions. Offer an explicit fork parent (`--parent <https-url>`) or report URLs (`--vulns`) for the human to confirm; only a confirmed URL is fetched.
   - **Bootstrap → interview.** Walk the draft's §5 open items with them (`references/audit-lifecycle/threat-model-bootstrap.md` §5).

3. **Tool-assisted first pass.** If the bundled Trail of Bits plugins are present (`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`), run ToB `static-analysis` and fold SARIF as attention-directing evidence (`references/orchestration/boundary-map.md`); else native `discovery/grep-commands.md` and note the gap. Load in-scope `references/methodologies/*` per protocol markers.

4. **Domain-partitioned manual review.** Run `vuln-hunter` (checklists + vectors) and `economic-analyst` (checklist 06 + economic vectors + methodology refs) over their **disjoint** surfaces — partitioned, not cloned. Each starts from `audit_<n>/threat-model.md` §4: the goals mapped to its partition, their Evidence, and the Leads. Each candidate finding passes Rule 5b + `references/false-positives.md` **at the leaf** before it is emitted. **⏸ Checkpoint 3 — after each review phase:** surface (a)/(b)/(c). This is where the human resolves "is this intended?" and re-scopes the next phase.

4b. **Triage (`/triage`).** Before reconciliation, dedup by root-cause (`audit-mem` suppression/regression when `"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem"` is built), re-apply Rule 5b with quantified downgrades, and split real findings from the Notes & Nitpicks list. **⏸ Checkpoint 3b — after triage:** show the human what was deduped/suppressed and why.

5. **Independent reconciliation.** Spawn `peer-reviewer` on the top-severity survivors (N≥8, plus any N≥7 the primary could not PoC); it re-derives from code, reusing the context worksheets. Reconcile CONFIRM / DISPUTE / DOWNGRADE. **⏸ Checkpoint 4 — after reconciliation:** present the reconciled set and any primary-vs-peer disagreements for the human to adjudicate.

6. **Converge to the audit document.** Spawn `audit-reporter`: dedup by root-cause, order by severity / business importance, and fill the **client-facing** `templates/audit-report.md` (maturity + trust-model caveats + disclaimers, **no deploy guarantee**); the numeric Repository Risk Score stays in the internal `templates/report-template.md`. Emit `audit_<n>/REPORT.md`. Iterate on human feedback until the document is agreed.

## Re-runs against changed code

When re-auditing after the team has changed code in response to findings, do **not** re-run the whole flow — use **`/auditor:re-audit`** for a delta review that classifies each prior finding FIXED / STILL-OPEN / REGRESSED and sweeps for un-patched siblings (Zenith-style fix review).
