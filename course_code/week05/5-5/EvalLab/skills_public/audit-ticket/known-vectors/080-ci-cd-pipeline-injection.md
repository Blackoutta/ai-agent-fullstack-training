---
id: 80
title: "CI/CD Pipeline Injection"
severity: 9
category: devops
---

### 80 — CI/CD Pipeline Injection
**Severity: 9** | **Real: Codecov supply chain attack (2021), SolarWinds CI compromise; on GitHub Actions: Ultralytics (Dec 2024, `pull_request_target` branch-name injection plus cache poisoning), tj-actions/changed-files tag repointing (CVE-2025-30066, Mar 2025), Nx "s1ngularity" (Aug 2025, `pull_request_target` PR-title injection)**

Attacker modifies CI workflow or compromises CI tool — injects malicious code into build artifacts deployed to production.

> Cross-ref: checklist 13 §13.9 (DEP-067..071) and §13.13 (DEP-090..096); KV-139 (comment-triggered workflow without per-event author gating); KV-140 (`workflow_run` / `pull_request_target` pwn request incl. artifact and cache poisoning); KV-116 (AI agent in CI holding deploy keys); `references/vuln-classes/github-actions.md`; recipes R1–R8 in `discovery/grep-commands.md` ("GitHub Actions (CI trigger trust)").

#### Verification Procedure

**Step 1: List all CI workflows**
```
find .github -name '*.yml' -o -name '*.yaml' 2>/dev/null
grep -rn -A 12 --include='*.yml' --include='*.yaml' '^on:' .github/workflows/ 2>/dev/null | head -150
```
- Record: All workflow files and their trigger conditions

**Step 2: Check privileged triggers (`pull_request_target`, `workflow_run`) for fork-controlled checkouts**
```
grep -rnE --include='*.yml' --include='*.yaml' 'pull_request_target|workflow_run' .github/
grep -rnE --include='*.yml' --include='*.yaml' 'ref:[[:space:]]*.?\$\{\{[[:space:]]*(github\.event\.(pull_request\.(head\.(sha|ref)|merge_commit_sha)|workflow_run\.head_(sha|branch))|github\.head_ref|steps\.[A-Za-z0-9_-]+\.outputs\.head_(sha|ref)|from(JSON|Json)\(steps\.[A-Za-z0-9_-]+\.outputs\.[A-Za-z0-9_]+\)\.head\.(sha|ref))|repository:[[:space:]]*.?\$\{\{[[:space:]]*github\.event\.pull_request\.head\.repo\.full_name|refs/pull/|gh pr checkout|git (fetch|pull|checkout)[^#]*(pull/|head_ref|head\.ref|head\.sha)|allow-unsafe-pr-checkout' .github/
```
- ✅ PASS: No privileged trigger, or the privileged job checks out only the base ref with an `actions/checkout` that carries the fork-PR guard (v2.8.0 / v3.7.0 / v4.4.0 / v5.1.0 / v6.1.0 / v7.0.0 or later)
- ❌ FAIL: `pull_request_target` or `workflow_run` with a checkout or fetch of the PR / run head, or `allow-unsafe-pr-checkout: true` — forked PRs run arbitrary code with the base repository's secrets and write token. Full procedure: KV-140

**Step 3: Check for secret exposure in logs**
```
grep -rnE --include='*.yml' --include='*.yaml' 'echo.*(\$\{\{[^}]*secrets\.|\$[A-Z_]*(SECRET|TOKEN|KEY))' .github/
```
- ✅ PASS: Secrets never echoed in CI logs
- ❌ FAIL: Secrets printed to CI output (visible in logs)

**Step 4: Check action versions (pinned to SHA?)**
```
grep -rnE --include='*.yml' --include='*.yaml' 'uses:' .github/ | grep -vE '@[a-f0-9]{40}' | grep -v 'uses: \./'
```
- ✅ PASS: All actions pinned to full SHA (`@abc123...`) — immune to tag tampering; DEP-067 adds that each SHA must resolve to a tag or branch of the named repository and that pins are kept current
- ⚠️ PARTIAL: Actions pinned to version tag (`@v4`) — better than no pin, but tag can be moved
- ❌ FAIL: Actions referencing `@main` or `@latest`

**Step 5: Check for write permissions**
```
grep -rn "permissions:" .github/workflows/ | head -10
grep -rn "GITHUB_TOKEN" .github/workflows/
```
- ✅ PASS: Minimum permissions declared (e.g., `contents: read`), no unnecessary write access
- ❌ FAIL: Default permissions (full read-write) used
- ⚠️ PARTIAL: No `permissions:` block, so the scope depends on the repository's default-token setting, which the source does not show

**Step 6: Check for third-party CI tools**
```
grep -rn --include="*.yml" --include="*.yaml" "uses.*/" .github/workflows/ | grep -v "actions/" | grep -v "github/"
```
- ✅ PASS: Only official GitHub Actions or well-known, audited third-party actions
- ⚠️ PARTIAL: Some third-party actions from less-known orgs
- ❌ FAIL: Third-party actions from unknown sources without version pinning

**Step 7: Check comment- and issue-triggered jobs for an author gate**
```
grep -rlE --include='*.yml' --include='*.yaml' '^[[:space:]]*-?[[:space:]]*(issue_comment|pull_request_review_comment|pull_request_review|discussion_comment|discussion|issues):?[[:space:]]*(#.*)?$|^[[:space:]]*(issue_comment|pull_request_review_comment|pull_request_review|discussion_comment|discussion|issues):[[:space:]]*\{|^on:.*(issue_comment|pull_request_review|discussion|issues)' .github/ | xargs -r grep -L 'author_association'
```
- ✅ PASS: Every privileged job on these triggers gates on the triggering object's own `author_association`, paired per event
- ❌ FAIL: A privileged job starts on a mention or command alone, or reads the opener's association on a comment event. Full procedure: KV-139

**Overall verdict:**
- ✅: Actions SHA-pinned, minimal permissions, no fork-controlled code in privileged triggers, comment triggers author-gated, secrets protected
- ⚠️: Version-tag pinned, reasonable permissions, known action vendors
- ❌: Unpinned actions, privileged trigger with PR checkout, ungated comment-triggered privileged job, secrets in logs
