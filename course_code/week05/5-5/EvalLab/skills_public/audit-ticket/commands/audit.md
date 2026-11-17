---
name: auditor:audit
description: Full scope-gated security audit of a Solana / full-stack repository — discovery, context reconstruction, per-item checklist verdicts, false-positive validation, and a severity-ranked report.
argument-hint: "[path] [--scope full|program|backend|frontend]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# auditor-skill — Full Audit

**Arguments:** $ARGUMENTS

Run the auditor-skill end-to-end:

1. Read `OUTPUT-RULES.md` (mandatory output format, severity 1-10, the Rule 5b validation gate).
2. Follow `FULL-AUDIT.md` top to bottom, honoring **scope-gated loading** (Rule 0): discover the repo, declare scope, load only in-scope checklists/vectors on demand.
3. Delegate: spawn `context-builder` (Phase 0.5) first, then `vuln-hunter` for the item-by-item walk, `economic-analyst` for checklist 06 + economic vectors, and `audit-reporter` to assemble the report.
4. Every in-scope checklist item and phase-triggered vector gets an explicit verdict (`[PASS]` / `[FAIL-N]` / `[PARTIAL]` / `[N/A]`). Findings with N≥6 must pass the Rule 5b validation gate or be downgraded to `[PARTIAL]` / `[UNCONFIRMED]`.
5. Emit `audit_<n>/REPORT.md`: executive summary (safe-to-deploy verdict), Scope Coverage table, findings, Phase 4.5 maturity scorecard, remediation roadmap.

If the bundled Trail of Bits tooling is present (`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"` — the installation's copy, never a relative `vendor/` path, which would resolve inside the audited repo), use it for SAST / harnesses / coverage per `references/orchestration/boundary-map.md`; otherwise fall back to the native `discovery/grep-commands.md` scanners and note the tooling gap.
