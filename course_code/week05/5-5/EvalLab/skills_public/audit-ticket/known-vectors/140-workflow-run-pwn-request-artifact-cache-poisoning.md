---
id: 140
title: "workflow_run / pull_request_target Pwn Request — Privileged Job Trusts Fork Code, Artifacts or Cache"
severity: 9
category: devops
---

### 140 — workflow_run / pull_request_target Pwn Request — Privileged Job Trusts Fork Code, Artifacts or Cache

**Severity: 9** | **Real: Ultralytics, Dec 2024 — a branch name expanded inside a `pull_request_target` workflow's composite action gave runner secrets and a poisoned Actions cache, which shipped 8.3.41/8.3.42 through Trusted Publishing (PyPI post-mortem). spotbugs → tj-actions, Dec 2024 – Mar 2025 — spotbugs' `pull_request_target` workflow leaked a maintainer token, the first link of the chain that repointed the tj-actions/changed-files tags (CVE-2025-30066; Unit 42). Nx "s1ngularity", Aug 2025 — a PR title expanded in a `pull_request_target` workflow gave a write-scoped token that dispatched the publish workflow on an attacker branch and yielded the npm token (Nx post-mortem). HackerBot Claw, Feb 2026 — a `pull_request_target` checkout of `head.sha` followed by `go run` in avelino/awesome-go exfiltrated a token, and a PAT stolen from aquasecurity/trivy led to repository takeover; the advisory for the March malicious release (CVE-2026-33634) says the non-atomic rotation that followed could have let the attacker keep access.**

`pull_request_target` and `workflow_run` run in the base repository with its secrets and a write-capable token, and since Dec 8, 2025 `pull_request_target` always runs the default branch's copy of the workflow. `workflow_run` holds that privilege whatever the upstream run had. The upstream is usually a `pull_request` run, which executes the PR's own copy of the upstream workflow, so its artifacts, outputs and branch name belong to the PR author.

A pwn request is any path by which fork-controlled bytes execute in, or steer, that privileged job:
- checking out the PR or `workflow_run.head_branch` / `head_sha`;
- building it (`npm install`, `pip download` of an sdist, `cargo build` / `build-sbf` running `build.rs`, `anchor build` / `anchor test` running `Anchor.toml` `[hooks]` / `[scripts]`, `make`, local actions);
- consuming its artifacts as code or env;
- poisoning the default-branch cache scope that release jobs restore.

`actions/checkout` v7.0.0, and the 2026-07-20 backports to v2.8.0 / v3.7.0 / v4.4.0 / v5.1.0 / v6.1.0, refuses fork-PR checkouts on these triggers unless the step sets `allow-unsafe-pr-checkout: true`. On `workflow_run` the guard applies only when the upstream run was a `pull_request*` event. The guard does not cover:
- refs pinned to a SHA, minor or patch version cut before the backport;
- `git fetch` / `gh pr checkout`;
- checkouts of another repository;
- `issue_comment` jobs.

For a Solana repository the prize is the deploy keypair, the program upgrade authority, a Squads member key or the SDK publish token.

> Cross-ref: checklist 13 §13.9 (DEP-067..071) and §13.13 (DEP-092 approved-commit binding, DEP-093 privileged triggers, DEP-094 `workflow_run` consumers, DEP-095 env files, DEP-096 caches); checklist 11 SC-045/048 (install scripts) and SC-050 (remote build caches); KV-139 (comment-triggered gating); KV-080; KV-116; `references/vuln-classes/github-actions.md` §1, §5; recipes R4, R5, R7 in `discovery/grep-commands.md`.

#### Verification Procedure

Read-only: the procedure never opens a PR or triggers a run on the target; a PoC is a written trace (`references/vuln-classes/github-actions.md` §0).

**Step 1: Inventory privileged triggers and their consumers**
```
grep -rnE --include='*.yml' --include='*.yaml' 'pull_request_target|workflow_run' .github/
```
- Record per job: trigger, `permissions:`, secrets and `environment:`, `id-token: write`, and every `actions/checkout` with its pinned version. For `workflow_run`, also record the upstream workflow it listens to and the events that start that upstream.
- Comment-triggered jobs that fetch PR code are judged here for what the code can reach; their gate is KV-139.
- If neither trigger exists and no comment-triggered job fetches PR code, the vector is N/A (record it).

**Step 2: Is fork-controlled code checked out or fetched?** (recipe R7)
```
grep -rnE --include='*.yml' --include='*.yaml' 'ref:[[:space:]]*.?\$\{\{[[:space:]]*(github\.event\.(pull_request\.(head\.(sha|ref)|merge_commit_sha)|workflow_run\.head_(sha|branch))|github\.head_ref|steps\.[A-Za-z0-9_-]+\.outputs\.head_(sha|ref)|from(JSON|Json)\(steps\.[A-Za-z0-9_-]+\.outputs\.[A-Za-z0-9_]+\)\.head\.(sha|ref))|repository:[[:space:]]*.?\$\{\{[[:space:]]*github\.event\.pull_request\.head\.repo\.full_name|refs/pull/|gh pr checkout|git (fetch|pull|checkout)[^#]*(pull/|head_ref|head\.ref|head\.sha)|allow-unsafe-pr-checkout' .github/
```
- ✅ PASS: the job checks out only the base ref, or nothing, and its `actions/checkout` carries the fork-PR guard (v2.8.0 / v3.7.0 / v4.4.0 / v5.1.0 / v6.1.0 / v7.0.0 or later in that line).
- ❌ FAIL: a privileged job checks out or fetches the PR head or merge commit, `workflow_run.head_branch` / `head_sha`, or the fork repository, or sets `allow-unsafe-pr-checkout: true`.
- ⚠️ PARTIAL: base-only checkout, but `actions/checkout` is pinned below the guard, so a later `ref:` edit would not be stopped.

**Step 3: Does anything execute fork-controlled bytes?**
- ✅ PASS: the privileged job only reads metadata (labels, comments, the PR number) and runs no build or install entry point over PR content.
- ❌ FAIL: any of these runs over a PR checkout or PR artifact:
  - `npm|yarn|pnpm install`;
  - `pip install` or `pip download` of an sdist;
  - `cargo build` / `build-sbf`;
  - `anchor build|test`;
  - `make`, `go run`, or `uses: ./…`;
  - an agent CLI.

**Step 4: `workflow_run` artifacts and gates** (recipe R4)
```
grep -rnE --include='*.yml' --include='*.yaml' 'workflow_run\.(head_branch|head_sha|head_commit|head_repository|display_title|pull_requests)|download-artifact|downloadArtifact|listWorkflowRunArtifacts|gh run download|run-id:' .github/
```
- ✅ PASS:
  - artifacts are downloaded into `${{ runner.temp }}`, parsed and validated as data (a numeric PR number, say);
  - gates use `github.event.workflow_run.event` and `github.event.workflow_run.head_repository.full_name == github.repository`.
- ❌ FAIL:
  - an artifact is unpacked into the workspace, executed, sourced, or written to `$GITHUB_ENV` / `$GITHUB_PATH`;
  - the gate is `workflow_run.head_branch == 'main'` (a fork branch can carry that name) or `github.repository` (always the base on this trigger).

**Step 5: Env-file writes in privileged jobs** (recipe R5)
```
grep -rnE --include='*.yml' --include='*.yaml' '(>>|tee[[:space:]]+(-a|--append))[[:space:]]*"?\$\{?GITHUB_(ENV|PATH|OUTPUT)|core\.(exportVariable|addPath)' .github/
```
- ✅ PASS: no event-, artifact- or output-derived value reaches `$GITHUB_ENV` / `$GITHUB_PATH`, and multiline writes use a random delimiter or a file.
- ❌ FAIL: a value from the fork lands in an env file. The runner blocks only `NODE_OPTIONS`; `BASH_ENV` and `LD_PRELOAD` give code execution in later steps.

**Step 6: Cache trust boundary**
```
grep -rnE --include='*.yml' --include='*.yaml' 'actions/cache|Swatinem/rust-cache|actions-rust-lang/setup-rust-toolchain|actions/setup-go|astral-sh/setup-uv|[[:space:]]cache:[[:space:]]*.?[a-z]|cache-dependency-path|enable-cache|bundler-cache|type=gha|SCCACHE_GHA_ENABLED' .github/
```
- Writers of the same Actions cache include `actions/cache`; any `setup-*` action with a `cache:` input (`actions/setup-go` v4+ caches by default unless `cache: false`); `Swatinem/rust-cache` and `actions-rust-lang/setup-rust-toolchain` (caches through it by default); `astral-sh/setup-uv` (`enable-cache`); `ruby/setup-ruby` with `bundler-cache: true`; Docker `cache-from` / `cache-to: type=gha`; and sccache with `SCCACHE_GHA_ENABLED`. Read any other setup or build action's inputs for a cache option.
- ✅ PASS: release, publish and deploy jobs restore no Actions cache that a default-branch-context job running untrusted code can write. Those writers include `pull_request_target`, `issue_comment`, `issues`, `discussion*`, `workflow_run` and agent jobs.
- ❌ FAIL: a release job restores a cache key that such a job also saves. The 10 GB eviction lets the writer replace existing entries (Ultralytics, Clinejection).

**Step 7: What the privileged job can reach**
- A composite action cannot read `secrets.*`, so any secret it uses arrives as an input value: trace it from the calling step's `with:`. Under `secrets: inherit` the called reusable workflow receives every caller secret without listing any; a workflow it calls in turn gets them only if it passes them on.
- ✅ PASS:
  - deploy, upgrade-authority and publish secrets sit in an `environment:` with required reviewers (since 2025-12-08 branch rules alone do not fence `pull_request_target`);
  - any cloud OIDC trust policy for this repository binds `environment`, `event_name` or `job_workflow_ref`, not `repo:<org>/<repo>:ref:refs/heads/<default>` alone, which comment-, issue- and `workflow_run`-triggered jobs also mint.
- ❌ FAIL: a job from Steps 2–6 holds the deploy keypair, the upgrade authority, a publish token or an OIDC role, with no reviewer gate between it and the fork-controlled input.
- ⚠️ PARTIAL: reviewers or the trust policy are hosted settings the source does not show. Name them for the owner to confirm.

**Overall verdict:**
- ✅: no privileged-trigger job checks out, builds, sources or trusts fork-controlled code, artifacts, env values or caches, and release secrets sit behind required reviewers
- ⚠️: fork content is handled only as data, but a hardening gap remains: a pre-guard checkout pin, a cache shared with a non-release job, unconfirmed reviewers, or an OIDC trust policy that has not been seen
- ❌: a privileged job executes or trusts fork-controlled bytes (checkout, build, artifact, env file or cache) with a write scope, secret, OIDC token or deploy path in reach
- N/A: no `pull_request_target` or `workflow_run` workflow, and no comment-triggered job that fetches PR code
