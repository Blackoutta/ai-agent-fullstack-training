---
name: auditor:audit-report
description: Aggregate audit checkpoints into the final report — executive summary, Scope Coverage, findings by severity, maturity scorecard, and remediation roadmap.
argument-hint: "[audit-dir]"
allowed-tools: Read, Glob, Bash
---

# auditor-skill — Report

**Arguments:** $ARGUMENTS

1. Gather the session's checkpoints and findings.
2. Deduplicate and classify findings by severity (1-10).
3. Assemble the report from `templates/report-template.md`: executive summary (safe-to-deploy verdict), Scope Coverage table, per-checklist verdicts, findings, Phase 4.5 maturity scorecard, remediation roadmap (CRITICAL → INFO).
4. Write `audit_<n>/REPORT.md`. Flag any in-scope item lacking a verdict as `[INCOMPLETE — in-scope item without verdict]`.
