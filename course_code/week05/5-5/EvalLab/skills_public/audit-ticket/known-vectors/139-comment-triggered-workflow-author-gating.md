---
id: 139
title: "Comment / Issue-Triggered Privileged Workflow Without Per-Event Author Gating"
severity: 9
category: devops
---

### 139 — Comment / Issue-Triggered Privileged Workflow Without Per-Event Author Gating

**Severity: 9** | **Real: project-akri, Feb 28, 2026 — its "Auto Bump Versions" workflow ran on a `/version` comment with no check on who wrote it; an outside account opened a PR that edited `version.sh`, commented `/version minor`, and the workflow checked out the fork and ran the edited script (HackerBot Claw campaign, StepSecurity analysis 2026-03-01). Cline ("Clinejection"), disclosed Feb 9, 2026 — an `issues`-triggered claude-code-action triage workflow accepted any user (`allowed_non_write_users: "*"`), fed the issue title into the prompt and allowed shell tools, which opened the path to the nightly publish credentials (Adnan Khan disclosure).**

`issue_comment`, `pull_request_review_comment`, `pull_request_review`, `discussion_comment`, `discussion`, `issues` and (when wiki editing is unrestricted) `gollum` can be fired by any GitHub account on a public repository. The comment, issue, discussion and wiki events run on the default branch with the repository's secrets and token permissions; the two review events run on the PR merge ref, which is privileged for any same-repository PR even when the reviewer is an outsider. A job that acts on the text of one of these events without asking who wrote it hands that privilege to every account on GitHub. AI agents in CI made this the dominant privileged shape: the mention is the trigger and the body is the prompt.

The gate fails in three ways while appearing to exist:

- **Wrong object.** Each payload object carries its own `author_association`. On `issue_comment`, `github.event.issue.author_association` is the issue opener's, so a gate that ORs the comment's and the issue's association lets an outsider through by commenting under a member's issue.
- **Unsound comparison.**
  - String-form `contains('OWNER,MEMBER,COLLABORATOR', x)` is true when `x` is a field the event lacks: a missing context property resolves to the empty string, which is a substring of everything.
  - Deny-lists admit every value nobody listed.
  - `CONTRIBUTOR` only means one earlier commit.
  - On PR-family and `workflow_run` events `github.actor` is whoever last acted on the event, not the PR author.
- **Unbound commit (TOCTOU).** After a member approves with a comment, review or label, the PR author pushes again before the job resolves the PR head.

A near-miss shows how ordinary the shape is. In October 2026, solanabr/ai-kit found that its own agent workflow, and the CI template it ships to user projects, started a job holding write scopes and `id-token: write` on an `@claude` mention alone. The fix (solanabr/ai-kit#179) pairs each event branch with that event's own association field, because one OR across fields would have kept the opener-association hole open. No exploitation was reported. claude-code-action's built-in write-access check limited what an outsider could reach, but the job, its token permissions and any earlier steps had already started.

> Cross-ref: checklist 13 §13.13 (DEP-090 gate and pairing, DEP-091 sound comparisons, DEP-092 approved-commit binding); checklist 19 §19.5 (AI-031 wildcard agent allowlists, AI-034 agent authority); KV-140 (what a privileged job may run or trust); KV-116 (agents in CI with deploy keys); KV-080 (CI/CD pipeline injection); `references/vuln-classes/github-actions.md` §2.4–§3; recipes R1–R3 in `discovery/grep-commands.md` ("GitHub Actions (CI trigger trust)").

#### Verification Procedure

Read-only: never comment, review, label or open issues on the target to test a gate (`references/vuln-classes/github-actions.md` §0).

**Step 1: Inventory externally triggerable comment, review, issue, discussion and wiki workflows**
```
grep -rlE --include='*.yml' --include='*.yaml' '^[[:space:]]*-?[[:space:]]*(issue_comment|pull_request_review_comment|pull_request_review|discussion_comment|discussion|issues|gollum):?[[:space:]]*(#.*)?$|^[[:space:]]*(issue_comment|pull_request_review_comment|pull_request_review|discussion_comment|discussion|issues|gollum):[[:space:]]*\{|^on:.*(issue_comment|pull_request_review|discussion|issues|gollum)' .github/
```
- Record per job: triggers, job-level `if:`, `permissions:`, secrets referenced, `id-token: write`, AI-agent steps (`anthropics/claude-code-action`, `run-gemini-cli`, `openai/codex-action`, `claude -p`, `codex exec`), and any checkout or fetch of PR code
- If no such job holds write scopes, secrets, `id-token: write`, an agent or PR code, the vector is N/A (record it; a labeler with only `issues: write` is informational)

**Step 2: Is there an author gate at all?**
- ✅ PASS: every privileged job tests the author in its job-level `if:` (or a first step looks up the actor's permission through the REST API and fails the job); an agent CLI started from `run:` sits behind that gate, because it has no check of its own
- ❌ FAIL: the gate is only a mention or command match (`contains(github.event.comment.body, '@claude')`, `startsWith(…, '/deploy')`), or there is none

**Step 3: Does each event branch pair its own text with its own association?** (recipe R2; read every hit)
```
grep -rnE --include='*.yml' --include='*.yaml' 'github\.event\.(issue|pull_request|discussion)\.author_association' .github/
```
- ✅ PASS: `comment.*` with `comment.author_association` on `issue_comment` / `pull_request_review_comment` / `discussion_comment`; `review.*` with `review.author_association` on `pull_request_review`; `issue.author_association` only on the `issues` branch; `discussion.author_association` only on the `discussion` branch
- ❌ FAIL: an opener field can satisfy the gate on a comment or review event, for example one OR across the `comment.` and `issue.` association fields

**Step 4: Is the comparison sound?** (recipe R3)
```
grep -rnE --include='*.yml' --include='*.yaml' -e "contains\([[:space:]]*'[^']*(OWNER|MEMBER|COLLABORATOR)" -e 'author_association[[:space:]]*!=' -e '![[:space:]]*contains\([[:space:]]*from(JSON|Json)' -e 'github\.(actor|triggering_actor)[[:space:]]*[!=]=' -e 'contains\(.*github\.(actor|triggering_actor)' -e "[\"'](CONTRIBUTOR|FIRST_TIMER|FIRST_TIME_CONTRIBUTOR|MANNEQUIN)[\"']" -e "app/[A-Za-z0-9_-]+'" .github/
```
- ✅ PASS:
  - membership is `==` or `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), …)`, and the allowed set is those three only;
  - `github.actor` is used as an allowlist only on `issue_comment`, where the actor is the commenter;
  - bot identities are compared as `<slug>[bot]`.
- ❌ FAIL:
  - string-form `contains()` in a workflow with any trigger that lacks the field;
  - a deny-list (`!= 'NONE'`, `!contains(fromJSON(…), …)`), or `CONTRIBUTOR` / `FIRST_TIME_*` in the allowed set;
  - a trust decision on `github.actor` / `github.triggering_actor` for PR-family or `workflow_run` events (Synacktiv 2024 showed `github.actor` set to `dependabot[bot]` on an attacker's PR);
  - `contains(github.actor, …)` on any event, because it tests a substring;
  - an `app/<slug>` string compared to `github.actor`, which never matches.

**Step 5: If the job runs PR code, is the approved commit bound?**
- ✅ PASS: the checkout uses the commit fixed at approval time:
  - `pull_request_review` → `github.event.review.commit_id`;
  - labeled `pull_request_target` → `github.event.pull_request.head.sha`;
  - `issue_comment` (its payload has no `pull_request` object, so `github.event.pull_request.head.sha` is empty) → a SHA named in the command, checked out exactly, with the job failing unless that SHA is still the PR head.
- ❌ FAIL: after a comment, review or label approval, the job checks out `refs/pull/<n>/head`, `github.head_ref`, a branch name, or an empty `head.sha`.

**Step 6: Agent gates, and association versus permission**
```
grep -rnE --include='*.yml' --include='*.yaml' 'allowed_non_write_users|allowed_bots|allow-users|allow-bots|include_comments_by_actor' .github/
```
- ✅ PASS:
  - `allowed_non_write_users` / `allowed_bots` / `allow-users` / `allow-bots` are absent or list explicit names (never `*`);
  - on public repositories `include_comments_by_actor` limits whose comments reach the prompt;
  - jobs that can deploy, publish or upgrade check the actor's repository permission through the API, because `MEMBER` and `COLLABORATOR` are associations, not permissions.
- ❌ FAIL: a wildcard agent allowlist on a job with write scopes, secrets or OIDC, or a deploy-capable job gated only on association.
- ⚠️ PARTIAL: the verdict depends on a hosted setting the source does not show (fork-PR approval policy, wiki editing restriction).

**Overall verdict:**
- ✅: every privileged comment, review, issue, discussion and wiki job is gated on the triggering object's own association with a sound comparison, binds the approved commit when it runs PR code, and keeps agent allowlists explicit
- ⚠️: gates are paired and sound, but a weakness remains that reaches no secret or write scope (an unsound comparison on an unprivileged branch, TOCTOU in a job holding nothing), or a hosted setting is unconfirmed
- ❌: a non-collaborator can start a privileged job (no gate, wrong object, unsound comparison, wildcard agent allowlist), or a job runs PR code that moved after approval
- N/A: no externally triggerable comment, review, issue, discussion or wiki workflow holds privilege
