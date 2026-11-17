---
name: auditor:diff-audit
description: PR / commit-scoped differential audit — audits only changed functions (plus 1-hop callers) and the published-code delta of changed dependencies, flags removed security checks, and prioritizes by risk × blast radius.
argument-hint: "[base..head | PR number]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# auditor-skill — Differential Audit (Mode 4)

**Arguments:** $ARGUMENTS

1. Compute the changed set: `git diff --name-only <base>..<head>` (default `main..HEAD`). In a checkout you did not clone yourself, every git call carries the `OUTPUT-RULES.md` Rule 11c flags.
2. Run Phase 0.5 Context Reconstruction on changed functions + their direct callers/callees (1-hop).
3. Risk-classify changed files (auth / crypto / value-transfer / validation-removal = HIGH). Git-blame removed security code (in a checkout you did not clone: `GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false blame --no-textconv --no-ext-diff <rev> -- <path>`, Rule 11c) — code deleted in a "fix" / "CVE" commit is a CRITICAL regression.
4. Run only the checklist items + known-vectors matching the changed files' language/domain, through the Rule 5b gate.
5. **Dependency lane.** If the changed set touches a manifest or lockfile (`Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `pyproject.toml`, `uv.lock`, `poetry.lock`, `requirements*.txt`, `go.mod`, `go.sum`), run checklist 11 §11.11 on the dependency delta. Baseline: this run's `<base>..<head>`; a re-audit passes the last audited ref as `<base>`. Enumerate every changed entry, artifact-diff what the §11.11 coverage budget names — fetched from the registry, never installed or built — and verdict SC-059..062, stating how many changed packages were left without an artifact diff. A one-line lockfile bump can bring in a whole new release, so the changed lines alone are not the reviewed code.
6. Emit `audit_<n>/PR-REPORT.md` — changed-surface verdicts + findings only, plus a **Dependency delta** section when step 5 ran. Reuses the methodology corpus; skips whole-repo discovery. Output hygiene and any outside-service disclosure follow `OUTPUT-RULES.md` Rule 11d / 11b.
