# Report Format — auditor-skill

> Load at report assembly / Phase 5 / by `audit-reporter`.

This file holds the report-time layout details factored out of [OUTPUT-RULES.md](../OUTPUT-RULES.md) so the review-time floor stays small. The rules keep their canonical numbers in OUTPUT-RULES.md (Rule 2, Rule 6, Rule 8, Rule 9); their bodies live here and are loaded only when a report is being assembled.

---

## Rule 2 § Executive Summary

Every audit output — regardless of size — MUST start with an **Executive Summary** block. This goes at the very top of the report.

```markdown
## Executive Summary

**Repository:** {org/repo}
**Commit:** {short SHA}
**Date:** {YYYY-MM-DD}
**Scope:** {FULL / PROGRAM / BACKEND / FRONTEND / DEVOPS}
**Repository Risk Score:** {1-10} — {CRITICAL/HIGH/MEDIUM/LOW/MINIMAL}

### What We Found

{2-4 sentences in plain language. What was audited. What is the overall security posture.
Highlight the most important finding(s) if any critical/high exist.
State whether the code is safe to deploy or not.}

### Severity Distribution

| Score | Label | Count |
|-------|-------|-------|
| 10 | 🔴 CRITICAL | 0 |
| 9 | 🔴 CRITICAL | 0 |
| 8 | 🟠 HIGH | 0 |
| 7 | 🟠 HIGH | 0 |
| 6 | 🟡 MEDIUM | 0 |
| 5 | 🟡 MEDIUM | 0 |
| 4 | 🔵 LOW | 0 |
| 3 | 🔵 LOW | 0 |
| 2 | ⚪ INFO | 0 |
| 1 | ⚪ INFO | 0 |
| **Total Findings** | | **0** |

### Items Verified

| Metric | Count |
|--------|-------|
| Total checklist items | {N} |
| PASS | {N} |
| FAIL | {N} |
| PARTIAL | {N} |
| N/A | {N} |
| Completion | {%} |
```

---

## Rule 6 § Report Sections Order

Every full audit report follows this exact section order:

```
1. Executive Summary          (Rule 2 — always first)
2. Scope Coverage             (in-scope checklists / vector groups, items evaluated / total)
3. Scope & Methodology        (languages, files, LOC, checklists applied, execution mode + outside services — OUTPUT-RULES Rule 11a/11b)
4. Findings                   (severity ≥ 4, full blocks, grouped by severity descending)
5. Detailed Item Results      (all in-scope checklist items, item-by-item verdicts)
6. Known Vector Results       (each in-scope KV, with verdict)
7. Instruction Matrix         (on-chain only — if applicable)
8. State Model Verification   (on-chain only — if applicable)
9. Code Maturity Scorecard    (Phase 4.5 — 9 categories, 0-4)
10. Remediation Roadmap       (by severity; maturity categories scoring <= 1 first)
11. Appendices                (tool versions, environment, disclaimer)
```

---

## Rule 8 § Metric Computation

The report MUST include computed metrics at the end of the Item Results section.

```markdown
### Audit Metrics

| Metric | Value |
|--------|-------|
| Total items evaluated | {N} |
| PASS | {N} ({%}) |
| FAIL | {N} ({%}) |
| PARTIAL | {N} ({%}) |
| N/A | {N} ({%}) |
| **Pass rate** (excl. N/A) | **{%}** |
| Highest severity found | {1-10} |
| Repository Risk Score | **{1-10}** |

### Known Vector Metrics

| Metric | Value |
|--------|-------|
| Total known vectors | 140 |
| PASS | {N} |
| FAIL | {N} |
| PARTIAL | {N} |
| N/A | {N} |
| Completion | {%} |

### Per-Checklist Summary

| # | Checklist | Items | Pass | Fail | Partial | N/A | Pass Rate |
|---|-----------|-------|------|------|---------|-----|-----------|
| 01 | Account Validation | 90 | | | | | % |
| ... | ... | ... | ... | ... | ... | ... | ... |
| **Total** | | **{N}** | | | | | **{%}** |
```

---

## Rule 9 § File Naming

| Output | Filename |
|--------|----------|
| Full audit report | `audit_{N}/REPORT.md` |
| Threat-model bootstrap evidence | `audit_{N}/bootstrap/` (working material, OUTPUT-RULES.md Rule 11d) |
| Remediation roadmap | `audit_{N}/roadmap.md` |
| Per-instruction worksheets | `audit_{N}/worksheets/{instruction_name}.md` |
| Incident run | `incident_{N}/INCIDENTS.json` · `INCIDENT_REPORT.md` · `RESPONSE-INC-{N}.{k}.md` |
| Incident PoC / patch | `incident_{N}/poc/INC-{N}.{k}/` · `incident_{N}/patches/INC-{N}.{k}.patch` |
| Checkpoint (session) | session memory: `audit-checkpoint.md` |

Where `{N}` is the highest existing `audit_*` number + 1; create the dir with `mkdir` (not `mkdir -p`) and stop if it exists. Reuse an existing `audit_*` only if git does not track it and it holds no symbolic links, after the human confirms which one. Never write into a tracked `audit_*`. The first file in each `audit_{N}/` is a `.gitignore` containing `*` (OUTPUT-RULES Rule 11d). For `incident_{N}/`, `{N}` is the highest existing number + 1 and the directory is created with `mkdir` (not `-p`); an existing one is reused only when git does not track it, it holds no symbolic links, and the human confirms it (`references/detection-response/README.md` § Run directory).
