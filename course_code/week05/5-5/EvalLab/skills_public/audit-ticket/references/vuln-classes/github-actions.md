# Vuln Classes — GitHub Actions: Trigger Trust, Workflow Injection and AI Agents in CI

> **Load when:** the repository has `.github/workflows/*.yml|yaml` or an `action.yml|yaml`, and any of these appear:
> `pull_request_target` · `workflow_run` · `issue_comment` · `pull_request_review_comment` · `pull_request_review` ·
> `discussion_comment` · `issues` (as a trigger) · `allow-unsafe-pr-checkout` · `anthropics/claude-code-action` ·
> `anthropics/claude-code-base-action` · `run-gemini-cli` · `openai/codex-action` · `actions/ai-inference` ·
> `claude -p` · `claude --print` · `codex exec`.
>
> **Purpose:** a workflow file decides who can make the repository run code, and with which credentials, so it is
> access-control logic and gets audited the way an authorization check would be. This playbook covers the shapes
> that let an outside account (anyone who can open a pull request, comment, review or file an issue) reach code
> execution or authority inside a privileged job: comment-triggered commands without per-event author gating (§3,
> KV-139), expression and env-file injection (§4), privileged triggers that run or trust fork-controlled code,
> artifacts or caches (§5, KV-140), and AI coding agents that read attacker text while holding a token (§6, KV-116).
> Supply chain, self-hosted runners and OIDC get pointers (§7). Checklist items: DEP-067..071, DEP-090..096,
> AI-021..035. Locator recipes R1–R8: `discovery/grep-commands.md`, section "GitHub Actions (CI trigger trust)".
>
> **How to use:** §0 before anything else; §1 dates the platform facts this file relies on; §2 classifies every
> trigger in the repository; then the section for each class present; §8 grounds severity in real incidents;
> §10 is the fast pass.
>
> *Credited to getsentry/skills gha-security-review (and cloudflare/security-audit-skill for the persisted-channel map, the hosted-settings rule and resource-selecting inputs); see ATTRIBUTION.md.*

---

## 0. Rules of engagement (read first)

This is a static review of workflow YAML, the scripts it calls and agent configuration. The audit never acts on the
target, because acting on it is exactly what fires the workflows under review:

- **No writes to the target.** Never open issues, pull requests, comments, reviews, discussions or wiki edits on the
  target repository; never push, run `gh workflow run`, re-run or approve a job, fork the target or create
  repositories on its behalf.
- **A PoC is a written trace:** trigger → actor → payload → the line where it expands or executes → the privilege
  reached, each with `file:line`. Running anything needs the user's explicit go-ahead, and then only in a scratch
  repository the auditor owns, with dummy credentials. Without that go-ahead the trace is the deliverable.
- **The clone is untrusted input.** A local checkout carries the target's git hooks and tool configuration
  (`.claude/`, `.mcp.json`, `Anchor.toml` hooks, `package.json` scripts). Handle it per
  [`OUTPUT-RULES.md` Rule 11](../../OUTPUT-RULES.md#rule-11-operating-safety) (11c untrusted git checkouts, 11a
  execution mode) and do not build or test the target to watch a workflow behave.
- **Hosted settings are not in the source.** The default `GITHUB_TOKEN` permission, environment reviewers, branch
  protection, the fork-PR approval policy and Dependabot secrets live in repository settings. Grade any item whose
  verdict depends on one of them `[PARTIAL]` and name the setting the owner has to confirm; never assume the safe value.

---

## 1. Platform facts and their dates

GitHub changed several defaults in 2025–2026; older write-ups and some tools' documentation predate them.

| Effective | Change | Audit consequence |
|-----------|--------|-------------------|
| 2023-02-02 | Repositories and organizations created after this date get a read-only `GITHUB_TOKEN` by default; existing ones keep their setting | A workflow without a `permissions:` block has a scope you cannot read from source → `[PARTIAL]` |
| 2025-12-08 | `pull_request_target` now runs the default branch's copy of the workflow against the default branch, whatever base the PR targets; environment branch rules are evaluated against `GITHUB_REF`, which for `pull_request_target` is the default branch | A stale vulnerable workflow on a side branch no longer fires, but an environment restricted to `main` no longer fences `pull_request_target` jobs; only required reviewers do (§5.6) |
| 2026-03-18 / 2026-04-05 | `anthropics/claude-code-action` v1.0.74 (#1066) restores `.claude/`, `.mcp.json`, `.claude.json`, `.gitmodules` and `.ripgreprc` from the PR base before the CLI starts; v1.0.89 (#1174) adds `CLAUDE.md`, `CLAUDE.local.md` and `.husky` | A PR-modified agent configuration is neutralised only at or above those versions (§6.4) |
| 2026-06-18 / 2026-07-20 | `actions/checkout` v7.0.0 refuses to check out fork-PR code on `pull_request_target`, and on `workflow_run` when the upstream run was a `pull_request*` event, unless the step sets `allow-unsafe-pr-checkout: true`. Backported to v2.8.0, v3.7.0, v4.4.0, v5.1.0 and v6.1.0 (not v1). Floating major tags such as `@v4` picked it up; refs pinned to a SHA, a minor or a patch version did not | The guard does not see `git fetch` / `gh pr checkout`, checkouts of other repositories, or `issue_comment` and other events (§5.1) |

Verify instead of trusting a date: `git ls-remote https://github.com/actions/checkout refs/tags/<tag>` gives the SHA
a tag points to, and the release notes of the pinned version say whether it carries the guard or the restore. Run
`git ls-remote` from a scratch dir outside the checkout, so its repo config does not apply; the `owner/repo` slug must
match `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`.

---

## 2. Threat model and trigger matrix

**2.1 The outside attacker.** Any GitHub account can open a fork PR (title, body, branch name, file names, file
contents and, for `pull_request`, the PR's own copy of every workflow file), comment on issues and PRs, submit
reviews, open issues and discussions, and edit a wiki whose editing is not restricted to collaborators. Also in scope:
maintainers of actions and dependencies whose accounts are taken over (tags repointed, §7), and bot PRs whose bodies
quote third-party text (Dependabot and Renovate copy upstream release notes, changelogs and commit messages).

**2.2 What makes a finding.** Attacker input must reach a privileged action: a write-scoped token, a secret, an OIDC
token, a deploy or upgrade path, a release artifact, or a cache that a release job restores. Broad `permissions:` with
nothing attacker-reachable behind them is a hardening note, not a finding. Chains count: a stolen write-scoped token
can push a branch and dispatch a privileged workflow on it, which is how the Nx compromise reached its npm token (§8).

**2.3 Severity gate.** Before rating anything 7 or above (OUTPUT-RULES Rule 5b), have all five: the entry point, the
payload, the line where it expands or executes, the privilege it reaches, and the written trace from §0.

**2.4 Trigger matrix.**

| Event | Who can fire it (public repo) | `GITHUB_REF` | Secrets / write token | Attacker-controlled text | Author field for a gate |
|-------|-------------------------------|--------------|-----------------------|--------------------------|-------------------------|
| `pull_request` (fork) | any account (first-time contributors may need approval) | PR merge ref | none; read-only token | title, body, branch, files, the PR's own workflow files | — (unprivileged) |
| `pull_request_target` | any account | default branch | yes | `pull_request.title`, `.body`, `.head.ref`, `.head.label`, fork repo name | `pull_request.author_association` (the opener) |
| `issue_comment` | any account, on any issue or PR | default branch | yes | `comment.body`, `issue.title`, `issue.body` | `comment.author_association` |
| `pull_request_review_comment` | any account | PR merge ref | fork PR: none / read-only; same-repo PR: yes, whoever comments | `comment.body` | `comment.author_association` |
| `pull_request_review` | any account | PR merge ref | as above | `review.body` | `review.author_association` |
| `issues` | any account | default branch | yes | `issue.title`, `issue.body` | `issue.author_association` |
| `discussion` / `discussion_comment` | any account, where Discussions are on | default branch | yes | `discussion.title` / `.body`, `comment.body` | `discussion.` / `comment.author_association` |
| `gollum` | collaborators by default; anyone if wiki editing is unrestricted | default branch | yes | `pages[*].page_name`, `pages[*].title` | none (use an API permission check, §2.5) |
| `workflow_run` | indirectly, anyone who can start the upstream run (a fork PR) | default branch | yes, whatever the upstream run had | `workflow_run.head_branch`, `.head_commit.message`, `.display_title`, artifacts, outputs | none; gate on `workflow_run.event` and `head_repository` (§5.3) |
| `push` / `workflow_dispatch` / `schedule` | write access only | pushed ref / chosen ref / default | yes | commit messages, dispatch inputs | outside the external model, unless reached with a stolen write token |

**2.5 Association is not permission.** `author_association` takes `OWNER`, `MEMBER`, `COLLABORATOR`, `CONTRIBUTOR`,
`FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `MANNEQUIN` or `NONE`; only the first three belong in an allowlist, and even
they are coarse. `MEMBER` is any member of the owning organization, with no particular permission on the repository;
`COLLABORATOR` only says the user was invited, and organizations can give outside collaborators the Read role;
`CONTRIBUTOR` means one earlier commit, which a merged typo fix provides (the PyTorch runner research used exactly that
to get past the first-time-contributor approval, §7). For a job that can deploy, publish or upgrade, check the actor's
real permission with `GET /repos/{owner}/{repo}/collaborators/{username}/permission` in the first step and fail unless
`permission` is `admin` or `write`. Members whose org membership is private can show up as `CONTRIBUTOR`; that fails
closed, and the fix is the API check, never adding `CONTRIBUTOR` to the allowlist.

---

## 3. Comment-triggered commands and author gating (KV-139 · DEP-090..092)

A workflow that reacts to text in a comment, review or issue has to ask who wrote that text. With AI agents in CI the
mention is the trigger and the body is the prompt, which makes this the most common privileged shape in agent
workflows.

**3.1 Pair each event with its own author field.** Every webhook object (`comment`, `review`, `issue`,
`pull_request`, `discussion`) carries an `author_association` that describes *its own* author. On `issue_comment`,
`github.event.issue.author_association` is whoever opened the issue, not whoever is commenting.

| Event | Text that triggers | Field that describes that text's author | Field that does not (opener) |
|-------|--------------------|-----------------------------------------|------------------------------|
| `issue_comment` | `comment.body` | `comment.author_association` | `issue.author_association` |
| `pull_request_review_comment` | `comment.body` | `comment.author_association` | `pull_request.author_association` |
| `pull_request_review` | `review.body` | `review.author_association` | `pull_request.author_association` |
| `discussion_comment` | `comment.body` | `comment.author_association` | `discussion.author_association` |
| `issues` | `issue.title` / `issue.body` | `issue.author_association` | — |
| `discussion` | `discussion.title` / `discussion.body` | `discussion.author_association` | — |

**3.2 Five gates that look present but are not.**

1. **Mention or command only.** `contains(github.event.comment.body, '@claude')` or `startsWith(…, '/deploy')` says
   nothing about the author.
2. **One OR across objects.** `comment.author_association == 'MEMBER' || issue.author_association == 'MEMBER'` lets an
   outsider through by commenting under any issue a member opened. Each `github.event_name` branch must pair its own
   body field with its own association field (§3.3).
3. **String-form `contains()`.** A property that is missing from a context resolves to the empty string (Contexts
   docs), and `contains()` with a string first argument is a substring test (Expressions docs); the empty string is a
   substring of everything. So `contains('OWNER,MEMBER,COLLABORATOR', github.event.comment.author_association)` is
   true for every trigger without a `comment` object, such as an `issues` event anyone can fire. Use `==`, or
   `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), …)`, which tests array membership.
4. **Deny-lists.** `!= 'NONE'` or `!contains(fromJSON('["NONE","FIRST_TIMER"]'), …)` admit `CONTRIBUTOR`,
   `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN` and any value nobody listed, and an absent field passes every negative test.
5. **Identity strings.** On PR-family events (`pull_request*`) and `workflow_run`, `github.actor` is whoever last acted
   on the event: a fork PR can be arranged so that Dependabot performs the last push, which makes
   `github.actor == 'dependabot[bot]'` true on an attacker's PR (Synacktiv, 2024). Compare
   `github.event.pull_request.user.login` together with `github.event.pull_request.head.repo.full_name ==
   github.repository`; GitHub's own Dependabot automation docs gate on the PR author for this reason. On
   `issue_comment` the actor is the commenter, so `github.actor == '<maintainer>'` is a sound allowlist there. App
   actors appear as `<slug>[bot]`, while the gh CLI's JSON output writes bot authors as `app/<slug>`; an `if:` that
   compares `github.actor` against `app/<slug>` never matches, so a bot deny-list written that way (as in the
   anza-xyz/claude-skills examples, which carry no licence and are described here, not quoted) excludes nothing.

**3.3 The sound shape.** One branch per event, each pairing its own fields, membership by array:

```yaml
if: |
  (github.event_name == 'issue_comment' &&
   contains(github.event.comment.body, '@claude') &&
   contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)) ||
  (github.event_name == 'pull_request_review' &&
   contains(github.event.review.body, '@claude') &&
   contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.review.author_association)) ||
  (github.event_name == 'issues' &&
   contains(github.event.issue.body, '@claude') &&
   contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.issue.author_association))
```

**3.4 Bind the commit that was approved (TOCTOU).** Gating the author does not gate the code. If the job runs PR code,
the PR author can push between the approval and the run, and a job that resolves `refs/pull/<n>/head`, `head_ref` or a
branch name at run time executes the new commit. Bind per event:

| Approval event | Commit to bind |
|----------------|----------------|
| `pull_request_review` | `github.event.review.commit_id`, the commit the review was submitted on |
| labeled `pull_request_target` | `github.event.pull_request.head.sha`, fixed when the label event was created |
| `issue_comment` | none in the payload: there is no `pull_request` object, so `github.event.pull_request.head.sha` is empty. Require the SHA inside the command, check out exactly that SHA, and fail unless it is still the PR head |

```yaml
- name: Bind the SHA named in the approving comment
  id: bind
  env:
    BODY: ${{ github.event.comment.body }}
    PR: ${{ github.event.issue.number }}
    GH_TOKEN: ${{ github.token }}
  run: |
    want=$(printf '%s\n' "$BODY" | tr -d '\r' | sed -nE 's#^/test ([0-9a-f]{40})$#\1#p' | head -n 1)
    head=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR" --jq .head.sha)
    if [ -z "$want" ] || [ "$want" != "$head" ]; then echo "SHA missing or no longer the PR head"; exit 1; fi
    echo "sha=$want" >> "$GITHUB_OUTPUT"
```

Check out `steps.bind.outputs.sha` afterwards. Binding decides *which* code runs; it does not make running PR code in a
job that holds secrets safe (§5).

**3.5 Commands that pick a target.** After the gate, arguments that select an environment, a cluster
(`/deploy mainnet` versus `devnet`), a package or a version are still free text: read them through an `env:` variable
and match them against a fixed allowlist before they choose anything.

**3.6 Agent mention triggers.** `anthropics/claude-code-action` checks the actor's write access itself, but inside the
job, after the job's secrets, its OIDC permission and every earlier step already exist; an agent CLI started from
`run:` (`claude -p`, `npx @anthropic-ai/claude-code`, `gemini -p`, `codex exec`) checks nothing. The workflow-level
`if:` gate is required either way (DEP-090); action-level gates are §6.2.

**3.7 Bot-authored PRs carry third-party text.** A Dependabot or Renovate PR body quotes the dependency's own release
notes, changelog and commit messages; treat it like any other attacker text before it reaches a shell or an agent.

---

## 4. Expression and env-file injection (DEP-069 · DEP-095)

**4.1 Sinks.** `${{ … }}` is substituted into the text before the step runs, so attacker text inside it becomes code in
a `run:` script, an `actions/github-script` `script:`, a composite action's `run:` step (Ultralytics' sink sat in a
composite action, one file away from the workflow), an argument handed to a script, or an agent prompt input (§6).

**4.2 Sources.** GitHub's guidance on untrusted input singles out event fields whose names end in `body`,
`default_branch`, `email`, `head_ref`, `label`, `message`, `name`, `page_name`, `ref` or `title`. Values derived from
them are just as tainted: file names returned by changed-file actions, step and job outputs computed from event data,
`matrix.*` values when the matrix is built from event data (`fromJSON(needs.<job>.outputs.<x>)` over changed paths or
labels), artifact names and contents, `workflow_run.head_branch` / `.head_commit.message` / `.display_title`,
`github.event.commits[*].message` and author emails, and whole-object dumps such as `toJSON(github.event.issue)`.

**4.3 The fix and where it stops.** Move the value into `env:` and use it as a double-quoted shell variable (`"$TITLE"`),
or pass it to an action as an input. That stops shell injection only; the same variable still carries attacker text
into an agent prompt (ToB vector A, AI-023) and into anything written to an env file.

**4.4 Env-file injection.** A value written to `$GITHUB_ENV` that contains a newline defines extra variables for every
later step in the job; a value written to `$GITHUB_PATH` puts a directory in front of `PATH`. The runner rejects only
`NODE_OPTIONS` through `$GITHUB_ENV` (the block list in `FileCommandManager.cs`) and the documentation forbids
overwriting the default `GITHUB_*` and `RUNNER_*` variables; everything else lands, including the live payloads
`BASH_ENV` (bash sources it before each later non-interactive bash step) and `LD_PRELOAD`. The same sinks hide behind
`tee -a "$GITHUB_ENV"` and behind `core.exportVariable` / `core.addPath` in github-script or JavaScript actions. A
multiline `name<<DELIMITER` write is only safe when the delimiter cannot occur in the value; for arbitrary text
generate a random delimiter per run, or keep the value in a file and pass the path.

**4.5 Argument and file-name injection.** Quoting stops word splitting but not option injection: a branch or file name
that starts with `-` becomes a flag to `git`, `xargs` or a linter, and a file name holding `$(…)` executes when a loop
expands it unquoted (the HackerBot Claw campaign tried this against DataDog's scanner; StepSecurity rates the
execution as likely rather than confirmed, §8).

**4.6 Check.** Recipes R5 and R6. PASS: no tainted value reaches a shell, a script, an agent prompt or an env file in
an externally triggerable workflow; otherwise FAIL, with the expansion line and the token scope.

---

## 5. Privileged triggers: `pull_request_target`, `workflow_run`, artifacts and caches (KV-140 · DEP-092..094 · DEP-096)

**5.1 `pull_request_target`** runs with the base repository's secrets and token, from the default branch (§1). The
classic pwn request checks out the PR head and then runs anything from it. A guarded `actions/checkout` refuses that
unless the step opts out with `allow-unsafe-pr-checkout: true`, which should be read as a confession. The guard does
not cover `git fetch origin pull/<n>/head`, `gh pr checkout`, `git pull origin ${{ github.head_ref }}`, checking out
the fork through `repository: ${{ github.event.pull_request.head.repo.full_name }}`, pins older than the guard, or
`issue_comment` jobs that fetch PR code. Grading (DEP-093): a job that checks out only the base ref passes, and is
`[PARTIAL]` if it pins `actions/checkout` below the guard; a privileged job that checks out or executes PR code
FAILs.

**5.2 Code that runs during a build of a PR checkout.** "We only build it" is execution:
- `npm` / `yarn` / `pnpm install` lifecycle scripts (SC-045, SC-048);
- `pip install`, and `pip download` of a source distribution, which runs the package's build backend to read its
  metadata even with `--no-deps` (pip 26.2.1);
- `cargo build` / `cargo build-sbf`, which compile and run every `build.rs` and procedural macro;
- `anchor build` / `anchor test`, which run the `[hooks]` commands in `Anchor.toml` (`anchor test` also runs its
  `[scripts] test` command);
- `make`, `go run` / `go generate`, and `uses: ./.github/actions/<x>` loaded from the checkout;
- agent CLIs that read project configuration from the working directory (§6.4).

For Solana the rule is: `solana-verify build`, `anchor build --verifiable`, IDL upload and `solana program deploy` never
share a job with PR code, PR artifacts or a cache that PR jobs can write.

**5.3 `workflow_run`** runs on the default branch with the base repository's secrets and write token, whatever the
upstream run had. The upstream is usually a `pull_request` run, which executes the PR's own copy of the upstream
workflow, so the PR author can rewrite it and control its artifacts, outputs and branch name (GitHub Security Lab,
Part 4). In a privileged consumer, never check out `workflow_run.head_branch` or `head_sha`; download artifacts into
`$RUNNER_TEMP` rather than the workspace and parse them as data with validation (Security Lab, Part 1); never execute,
`source` or unpack them over the checkout or write their content to an env file; and gate on
`github.event.workflow_run.event` plus `github.event.workflow_run.head_repository.full_name == github.repository`.
`head_branch == 'main'` is satisfied by a fork branch named `main`, and `github.repository` is always the base
repository on this trigger. claude-code-action checks the upstream run's actor as well as the workflow actor here.

```yaml
- uses: actions/download-artifact@v4   # pin to a full SHA in real use (DEP-067)
  with:
    name: pr-number
    path: ${{ runner.temp }}/pr
    run-id: ${{ github.event.workflow_run.id }}
    github-token: ${{ github.token }}
- name: Read the artifact as data
  id: pr
  run: |
    n=$(head -c 16 "$RUNNER_TEMP/pr/number.txt")
    case "$n" in ''|*[!0-9]*) echo "not a PR number"; exit 1 ;; esac
    echo "number=$n" >> "$GITHUB_OUTPUT"
```

A forged number can only point the follow-up comment at a different PR, acceptable for a comment and not for anything
that deploys.

**5.4 Caches.** GitHub scopes caches by ref. A cache saved by a `pull_request` run is tied to the PR's merge ref, and
nothing except a re-run of that same PR reads it back, so poisoning needs attacker code running in default-branch
context: a `pull_request_target`, `issue_comment`, `issues`, `discussion*` or `workflow_run` job, an agent job, or a
compromised dependency on the default branch. That job saves into the scope every release job restores from, and the
per-repository size limit (10 GB by default) evicts the least recently used entries, so an attacker can flood the
cache, wait for the eviction and re-create the keys a release job uses (Khan, 2024). Release, publish and deploy jobs
should not restore caches such jobs can write; that is the Ultralytics and Clinejection chain (§8).

**5.5 Map the persisted channels.** For each protected workflow, list everything that crosses into it from an untrusted
one: cache keys, artifacts, shared workspaces or volumes, step and job outputs, release assets. Each crossing needs an
identity the attacker cannot reuse (a digest, a SHA, a run id plus a producer check) and a reason to trust its
producer; a crossing that has neither is the finding.

**5.6 What the job can reach.**
- **Composite actions** cannot read `secrets.*`; any secret one uses was handed in as an input value. Trace it from the
  `with:` block of the calling step, because the action's own file never names the secret.
- **`secrets: inherit`** gives the called reusable workflow every secret its caller holds, with no declaration needed
  on the callee's side. A workflow that the callee calls in turn receives them only if the callee passes them on.
- **Environments.** Environment branch rules now evaluate the default branch for `pull_request_target`, so deploy,
  publish and upgrade-authority secrets belong in an environment with **required reviewers**; a branch filter alone is
  not enough.
- **OIDC subjects.** A job that names no environment and runs on a comment, issue, discussion or `workflow_run` event
  has the default branch as its ref, so it requests the same OIDC subject as a push to that branch
  (`repo:<org>/<repo>:ref:refs/heads/<default>`). A cloud trust policy (a KMS signer holding a deploy key, say) must
  also bind `environment`, `event_name` or `job_workflow_ref`. The policy is hosted: grade it `[PARTIAL]` until it has
  been seen.

---

## 6. AI coding agents in CI (KV-116 · AI-021..035)

**6.1 Relationship to the ToB vectors.** Trail of Bits' agentic-actions-auditor (vendored; its "Analyze for Attack
Vectors" step lists vectors A–I) is already ported as AI-023..031 and KV-116. This section adds what those vectors do
not cover: who may start the agent, what it holds, what it reads on startup and where its output goes.

**6.2 Gates.** claude-code-action verifies the actor's write access for issue, PR, comment and review events, and on
`workflow_run` it also checks the upstream run's actor. `allowed_non_write_users` switches that check off for the listed
users, `allowed_bots` entries are not permission-checked at all, and `include_comments_by_actor` limits whose comments
are fed into the prompt. Gemini CLI's action has no user allowlist of its own (ToB action profiles), and agent CLIs
started from `run:` check nothing. The workflow-level gate of §3 is therefore always required (DEP-090); wildcard
inputs are AI-031.

**6.3 What the agent holds.** On its default GitHub App path, claude-code-action exchanges an OIDC token for an App
token and, unless `additional_permissions` is set, sends no permission list with that request (`src/github/token.ts`).
The token therefore carries whatever the Claude App's installation grants on the repository (the action's security
notes list read-write on contents, pull requests and issues), and the job's `permissions:` block does not narrow it.
To bound it, pass
`github_token: ${{ secrets.GITHUB_TOKEN }}` under minimal job permissions, and never a long-lived PAT, which repeated
prompt injection can leak piece by piece. The App path needs `id-token: write`, and any step in
that job can request OIDC tokens for any audience, so no cloud trust policy may accept that job's subject (§5.6). Keep
publish, deploy and cloud secrets out of every `env:` the agent's shell tool can read (AI-034).

**6.4 Working directory and configuration.**
- **What the CLI reads.** In non-interactive mode the Claude CLI reads `.mcp.json` and `.claude/settings*.json` from the
  working directory ahead of its tool-permission checks: it can run hooks, set variables such as `NODE_OPTIONS`,
  `LD_PRELOAD` or `PATH`, run `apiKeyHelper`, and approve MCP servers from those files.
- **The restore.** claude-code-action deletes these paths and restores them from the PR base on PR events, including
  `pull_request` (versions in §1). Because it deletes first, skills or commands a workflow copies into the checkout's
  `.claude/` disappear before the CLI starts; install them with the `plugins` / `plugin_marketplaces` inputs instead.
- **Privileged triggers.** For `pull_request_target` and `workflow_run`, the action's guidance is to keep the base
  checkout at the workspace root and put the PR head in a subdirectory passed with `--add-dir`.
- **What the restore misses.** A restored base-branch hook that calls a PR-controlled entry point still runs PR code:
  `npm run`, a `Makefile` target, `Anchor.toml` hooks, or `cargo build` reaching `build.rs`. Treat any agent CLI that
  loads project-local configuration the same way (AI-035).

**6.5 Injection without `${{ }}`.** The agent's tools read the PR diff, comments, commit messages, file contents and bot
PR bodies; a prompt field with no expressions proves nothing (ToB vector C, generalised).

**6.6 Output channels.** Whatever the agent can write, an injection can write: issue and PR edits and comments, commits,
and workflow logs, which are public on a public repository. claude-code-action warns that `show_full_output` puts tool
output, secrets included, into those logs. The PromptPwnd research (Aikido, 2025) showed an issue-triage agent being
steered to write tokens into the issue body through its `gh issue edit` tool; it was a proof of concept on a private
fork with test credentials, and no real token was exposed.

**6.7 Audit agents run what they audit.** A dependency-review agent that downloads package sources with `pip download`
executes their build backend (§5.2), and one that fetches the PR title and body with `gh pr view` pulls attacker text
into its context (AI-025). Fetch archives as bytes and unpack them, use `--only-binary`, and run the analysis in a job
that holds no secrets.

**6.8 Agent → cache → release.** An agent job in default-branch context that installs or runs PR-supplied code can
poison the cache a nightly or release job restores: the Clinejection chain (§8). Agent jobs share no cache or artifact
with release or deploy jobs (AI-035, DEP-096).

**6.9 Pre-v1 claude-code-action inputs.** v1 renamed `direct_prompt` and `override_prompt` to `prompt`, moved
`custom_instructions` to `--append-system-prompt` in `claude_args`, and replaced `allowed_tools` / `disallowed_tools`
with `--allowedTools` / `--disallowedTools`. A workflow can keep the old keys after its `uses:` line moves to `@v1` or a
SHA, so judge a step by the input keys it actually sets, never by the version after `@`. The tool lists also use
different separators: commas in the old input, spaces inside `claude_args` (from the upstream ToB skill's 2026-08
revision).

**6.10 Solana rule.** The agent proposes and a human or a multisig disposes (AI-021, AI-022). An agent job never holds a
deploy keypair, an upgrade authority, a Squads member key, or an SDK's npm or crates.io publish token.

---

## 7. Pointers: pinning, supply chain, runners, permissions

- **Pinning (DEP-067, DEP-070).** Every action is pinned to a full SHA with a `# vX.Y.Z` comment, and the SHA resolves to
  a tag or branch of the named repository (`git ls-remote https://github.com/<owner>/<repo>` lists it; run it from a
  scratch dir outside the checkout, so its repo config does not apply, and only for an `owner/repo` slug, the first two
  segments of the `uses:` value, that matches `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`): a commit that exists only in a fork
  can still be referenced through the parent's `owner/repo` slug, an "impostor commit" (Chainguard, 2023). Pins are
  kept current by a Dependabot or Renovate `github-actions` updater, because an old pin keeps fixed bugs (§1). Tag
  repointing is not hypothetical: tj-actions/changed-files and reviewdog in 2025, trivy-action in 2026 (§8).
- **Self-hosted runners.** Fork-PR jobs do not run on persistent self-hosted runners in public repositories. The PyTorch
  research (Stawinski and Khan, 2024) turned a merged typo fix into contributor status, ran on a self-hosted runner and
  reached release credentials.
- **Permissions.** Declare `permissions:` explicitly per workflow or job (KV-080 step 5); repositories created before
  2023-02-02 may still default to read-write (`[PARTIAL]` until the setting is seen).
- **OIDC and cloud deploys.** DEP-084 and §5.6. **Secrets in logs.** DEP-071 and SEC-046; the tj-actions payload printed
  secrets into public logs.

---

## 8. Incidents

| When | Target | Entry → mechanism | Source |
|------|--------|-------------------|--------|
| Dec 2024 | Ultralytics (PyPI) | `pull_request_target` workflow; a branch name expanded inside a composite action's shell step → runner secrets and a poisoned Actions cache → 8.3.41/8.3.42 published through Trusted Publishing; 8.3.45/8.3.46 through an unrevoked API token | PyPI post-mortem, 2024-12-11 (analysis by W. Woodruff) |
| Mar 2025 | tj-actions/changed-files, reviewdog/action-setup | maintainer credentials compromised → version tags repointed to a commit that dumped runner secrets into workflow logs (public on public repos); Unit 42 traced the chain back to a `pull_request_target` workflow that leaked a maintainer token, and to an initial target of coinbase/agentkit | GHSA-mrrh-fwg8-r2c3 (CVE-2025-30066), GHSA-qmg3-hpqr-gqvc (CVE-2025-30154); Unit 42, 2025-03-20 |
| Aug 2025 | Nx ("s1ngularity") | `pull_request_target` PR-title check echoed the title into a shell → write-scoped token → dispatched the publish workflow on an attacker branch → npm token → packages whose install script also tried local AI CLIs | Nx post-mortem, 2025-09-05 |
| Sep 2025 | GhostAction (327 accounts, 817 repositories) | compromised maintainer accounts pushed workflows that sent repository secrets to an attacker endpoint (3,325 secrets) | GitGuardian disclosure, 2025-09-05 |
| Feb 2026 | Cline ("Clinejection") | `issues`-triggered claude-code-action triage open to any user (`allowed_non_write_users: "*"`), shell tools, issue title in the prompt → `npm install` of an attacker commit → cache flooded and re-poisoned → nightly publish job held the marketplace and npm tokens; an unauthorized `cline@2.3.0` followed on 2026-02-17 | Adnan Khan disclosure, 2026-02-09 |
| Feb 21 – Mar 2, 2026 | HackerBot Claw (awesome-go, project-akri, trivy and others) | automated campaign: `pull_request_target` checkouts running Go `init()`, an unauthenticated `/version` comment command running a PR-modified script (akri), PAT theft and repository takeover (trivy); an AI reviewer refused a poisoned `CLAUDE.md` | StepSecurity analysis, 2026-03-01 |
| Mar 2026 | aquasecurity/trivy | the rotation after the February compromise was not atomic, which the advisory says could have let a still-valid token keep access → malicious v0.69.4 release, 76 of 77 trivy-action tags and every setup-trivy tag repointed | GHSA-69fq-xp46-6x23 (CVE-2026-33634) |

---

## 9. Tool cross-check

CodeQL's `actions` language (queries such as `actions/untrusted-checkout/*`, `actions/untrusted-checkout-toctou/*`,
`actions/code-injection/*`, `actions/envvar-injection/*`, `actions/envpath-injection/*`, `actions/artifact-poisoning/*`,
`actions/cache-poisoning/*`, `actions/improper-access-control`) and zizmor (`template-injection`, `dangerous-triggers`,
`github-env`, `bot-conditions`, `unsound-contains`, `artipacked`, `cache-poisoning`, `impostor-commit` in online mode)
cover part of §3–§5. Neither replaces this file. Run with `--offline --persona=auditor` over
fixtures 01–17 in `scripts/tests/fixtures/gha/`, zizmor 1.30.1 did not flag:
- a mention-only gate (fixtures 01, 10);
- the cross-object OR (02);
- an array deny-list (17) or an `app/<slug>` deny-list (13);
- event text in an agent prompt input (08, 14);
- `allowed_non_write_users: "*"` (08);
- `allow-unsafe-pr-checkout: true` with a `pull/<n>/head` fetch on `issue_comment` (11).

It rated string-form `contains()` Informational (03) and did flag `bot-conditions` (12), `template-injection` in `run:`
(07, 16), `github-env` (06, 07, 15) and `dangerous-triggers` (05–07, 12, 15). A clean tool run does not close §3 or §6.

---

## 10. Fast pass

- [ ] Every comment, review, issue, discussion and wiki trigger listed with its gate, the gate paired per event, and an API permission check for deploy-capable jobs (DEP-090, KV-139)
- [ ] No string-form `contains()`, deny-list, untrusted association value or PR-family `github.actor` in a gate (DEP-091)
- [ ] A job that runs PR code after a comment, review or label binds the approved commit (DEP-092)
- [ ] No privileged-trigger job checks out or builds fork code; the checkout carries the guard and no opt-out (DEP-093)
- [ ] `workflow_run` consumers treat artifacts as data and gate on `event` + `head_repository` (DEP-094)
- [ ] No tainted value in `run:`, `script:`, env files or `PATH` (DEP-069, DEP-095)
- [ ] Release jobs restore no cache a default-branch-context job running untrusted code can write (DEP-096)
- [ ] Each cache, artifact or output that crosses from an untrusted workflow into a protected one is bound to a digest, SHA or run id and comes from a producer you can vouch for (§5.5)
- [ ] Agents: token bounded, no PAT, no deploy or publish secret in reach, outputs treated as channels (AI-034); config restored or no PR checkout as working directory (AI-035); ToB A–I (AI-023..031)
- [ ] Pins are full SHAs that resolve in the named repository and are kept current (DEP-067); hosted settings graded `[PARTIAL]`

---

Sources (public): GitHub docs (events that trigger workflows, contexts, expressions, workflow commands, secure use,
dependency caching, OIDC, reusing workflows, wiki permissions, repository roles, REST collaborators); GitHub changelogs
of 2023-02-02, 2025-11-07 (effective 2025-12-08) and 2026-06-18; actions/checkout releases and `action.yml`;
actions/runner `src/Runner.Worker/FileCommandManager.cs`; anthropics/claude-code-action `docs/security.md`,
`action.yml`, `src/github/token.ts`, `src/github/operations/restore-config.ts` and releases v1.0.74 / v1.0.89; GitHub
Security Lab, "Keeping your GitHub Actions and workflows secure", parts 1 and 4; Synacktiv, "GitHub Actions
exploitation: Dependabot" (2024); Adnan Khan on Actions cache poisoning (2024-05-06) and Clinejection (2026-02-09);
Chainguard on impostor commits (2023-03-08); Stawinski and Khan on PyTorch (2024-01-11); Aikido, PromptPwnd
(2025-12-04); and the advisories and post-mortems in §8.
