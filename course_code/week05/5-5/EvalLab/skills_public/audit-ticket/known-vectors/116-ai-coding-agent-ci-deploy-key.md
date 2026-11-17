---
id: 116
title: "AI Coding Agent in CI Holds Deploy / Upgrade Keys"
severity: 9
category: ai-agent
---

### 116 — AI Coding Agent in CI Holds Deploy / Upgrade Keys

**Severity: 9** | **Real: Solana port of Trail of Bits agentic-actions-auditor — an AI coding agent (Claude Code Action / Gemini CLI / Codex / GitHub AI Inference) running in a CI pipeline that can reach a program deploy or upgrade-authority keypair; a prompt-injected PR/issue/comment makes the pipeline push a malicious program upgrade**

Solana programs are mutable by their upgrade authority. If an AI agent runs in CI with that authority (or a deploy keypair) in reach, prompt injection stops being a code-review nuisance and becomes a supply-chain compromise: the attacker opens a PR / issue / comment whose text steers the agent, and the agent — running with pipeline secrets — builds and ships an attacker-controlled upgrade to a live program. This is the ToB agentic-actions model (attacker input → AI agent with elevated CI permissions) pointed at `solana program deploy` / `anchor upgrade` / a multisig submit.

This vector fuses two conditions that must BOTH be false: (a) the agent can reach deploy/upgrade keys, and (b) attacker input can reach the agent. The nine ToB CI vectors below are the concrete injection paths.

> Cross-ref: checklist 19 §19.5 (AI-021..031 the ToB vectors, AI-034 agent authority, AI-035 configuration restore); checklist 13 §13.13 (DEP-090..091 who may trigger the agent job, DEP-093 privileged triggers, DEP-096 caches); KV-139 (comment-triggered gating); KV-140 (`workflow_run` / `pull_request_target` pwn request); KV-080; `references/vuln-classes/github-actions.md` §6; recipe R8 in `discovery/grep-commands.md`.

#### Verification Procedure

**Step 1: Inventory workflows and locate AI agent steps**
```
ls -la .github/workflows/ 2>/dev/null
grep -rn -iE "anthropics/claude-code-(base-)?action|run-gemini-cli|gemini-cli-action|openai/codex-action|actions/ai-inference|claude (-p|--print)|@anthropic-ai/claude-code|codex exec|gemini -p" .github/workflows/
```
- Record: each workflow, its `on:` triggers, and every AI-agent step, including agent CLIs started from a `run:` step (they have no built-in actor check)

**Step 2: Does an AI-agent step reach deploy / upgrade key material?**
```
grep -rn -iE "PROGRAM_DEPLOY|UPGRADE_AUTHORITY|DEPLOY_KEY|id\.json|keypair|ANCHOR_WALLET|SOLANA_KEYPAIR|secrets\." .github/workflows/
```
- Work out how secrets reach called code, because the called file on its own does not show it:
  - **Composite action:** `secrets.*` is not readable inside one, so a secret it really uses arrives as an input value (`inputs.*`). Trace it from the calling step's `with:` block.
  - **Reusable workflow:** under `secrets: inherit` the callee receives every secret its caller holds without listing any, so an empty `on.workflow_call.secrets` proves nothing. A workflow the callee calls in turn gets them only if the callee passes them on.
- ✅ PASS: The AI-agent job/step has NO deploy/upgrade keypair in its `env`/`secrets`/checked-out files; deploy secrets live only in a separate job the agent cannot influence
- ❌ FAIL: A deploy/upgrade key or `id.json` is available in the same job/step as the AI agent

**Step 3: Is deploy/upgrade reachable from the agent without a human gate?**
```
grep -rn -iE "solana program deploy|anchor deploy|anchor upgrade|solana program set-upgrade-authority|squads|multisig.*submit" .github/workflows/
```
- ✅ PASS: These commands sit behind an explicit human-approval boundary (manual `environment` gate, separate approval job) and are NOT invocable by an AI-agent step or by a step consuming AI output
- ❌ FAIL: An AI-agent step (or a step eval-ing its output) can trigger deploy/upgrade

**Step 4: Nine ToB CI injection vectors (Solana port of Trail of Bits agentic-actions-auditor)**

claude-code-action renamed its inputs at v1: `direct_prompt` / `override_prompt` became `prompt`, `custom_instructions` became `--append-system-prompt` in `claude_args`, and `allowed_tools` / `disallowed_tools` became `--allowedTools` / `--disallowedTools`. A workflow can keep the old keys after its `uses:` line moves to `@v1` or a SHA, so judge each step by the input keys it actually sets, never by the version after `@`. The tool lists use different separators: commas in the old input, spaces inside `claude_args`.
- **A. Env-var intermediary** — `github.event.*.body/title/head_ref` or commit message flows through an `env:` var into the agent prompt (prompt has no `${{ }}`, still tainted).
  ```
  grep -rn -iE "env:" .github/workflows/ ; grep -rn -iE "github.event.*(body|title|head_ref|message)" .github/workflows/
  ```
- **B. Direct expression injection** — `${{ github.event.* }}` interpolated directly into an agent prompt field (`prompt`, pre-v1 `direct_prompt` / `override_prompt`, `custom_instructions` / `--append-system-prompt`, Codex `prompt-file`, AI Inference `system-prompt`).
  ```
  grep -rn -iE -A 8 '^[[:space:]]*(prompt|direct_prompt|override_prompt|custom_instructions|system-prompt|prompt-file):' .github/workflows/ | grep -E '\$\{\{ *github\.event'
  ```
  (`-A 8` reaches into `prompt: |` block scalars; also read `claude_args` for `--append-system-prompt`.)
- **C. CLI data fetch** — prompt runs `gh issue view` / `gh pr view` / `gh api` (or `curl`) to pull attacker content at runtime.
  ```
  grep -rn -iE "gh (issue|pr) view|gh api|curl " .github/workflows/
  ```
- **D. `pull_request_target` + checkout of PR head** — untrusted PR code runs with secrets in reach of the agent.
  ```
  grep -rn -iE "pull_request_target" .github/workflows/
  ```
- **E. Error-log injection** — `anchor build`/test error output or `workflow_dispatch` inputs piped into the agent prompt.
- **F. Subshell expansion** — a "restricted" tool allowlist still permits `echo $(...)` / backticks, bypassing the restriction to read secrets.
- **G. Eval of AI output** — a later step passes `steps.<ai>.outputs.*` through `eval`/`exec`/unquoted `$()`, especially into a deploy/tx command.
  ```
  grep -rn -iE "eval |exec |\$\(.*outputs" .github/workflows/
  ```
- **H. Dangerous sandbox** — `danger-full-access`, `--allowedTools Bash(*)` (pre-v1: `allowed_tools: "Bash(*)"`), `--yolo`/`--approval-mode=yolo`, `safety-strategy: unsafe`.
  ```
  grep -rn -iE "danger-full-access|Bash\(\*\)|--yolo|approval-mode=yolo|safety-strategy:\s*unsafe|allowed_tools:|disallowed_tools:" .github/workflows/
  ```
- **I. Wildcard allowlist** — `allowed_non_write_users: "*"` / `allowed_bots: "*"` / `allow-users: "*"` / `allow-bots: true` lets any external user or App invoke the agent.
  ```
  grep -rn -iE "allowed_non_write_users:\s*[\"']?\*|allowed_bots:\s*[\"']?\*|allow-users:\s*[\"']?\*|allow-bots:\s*true" .github/workflows/
  ```
- ✅ PASS: None of A–I present on any AI-agent step that shares a job with deploy/upgrade capability
- ❌ FAIL: Any of A–I provides an injection path into an agent that can reach the deploy pipeline

**Step 5: Permissions & least privilege on the agent job**
- ✅ PASS: Agent job declares minimal `permissions:` (`contents: read`), no `id-token`/write scopes it doesn't need, and cannot escalate to deploy
- ❌ FAIL: Default/broad permissions on a job that also holds deploy secrets

**Step 6: Who can start the agent, what it holds, what it reads on startup**
```
grep -rnE --include='*.yml' --include='*.yaml' 'author_association|allowed_non_write_users|allowed_bots|include_comments_by_actor|github_token:|additional_permissions|show_full_output|plugins:|plugin_marketplaces:|add-dir' .github/
```
- **Gate.** The job-level `if:` gates on the triggering object's own `author_association`, paired per event (DEP-090..091, KV-139). The action's built-in write check runs only after the job has started, and an agent CLI started from `run:` has none.
- **Token.** On its default GitHub App path claude-code-action requests no explicit permissions (only `additional_permissions` adds a list), so the App token carries whatever the Claude App installation grants and the job's `permissions:` block does not limit it. A bounded setup passes `github_token: ${{ secrets.GITHUB_TOKEN }}` under minimal permissions and never a personal access token (AI-034).
- **Configuration restore.** With a PR checkout as the working directory, the action must be at v1.0.89 or later, which restores `.claude/`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`, `CLAUDE.md`, `CLAUDE.local.md` and `.husky` from the base branch. v1.0.74–v1.0.88 restore only the first five. Skills come in through `plugins` / `plugin_marketplaces`, not copies into `.claude/` (AI-035).
- ✅ PASS: gated per event, bounded token, configuration restored (or no PR checkout as the working directory), no shared cache or artifact with release jobs
- ⚠️ PARTIAL: action between v1.0.74 and v1.0.88 on a PR checkout, or a hosted setting (OIDC trust policy, environment reviewers) the source does not show
- ❌ FAIL: mention-only gate, wildcard allowlist, PAT, or an agent CLI / pre-v1.0.74 action started inside an untrusted PR checkout

**Overall verdict:**
- ✅: Agent job has no deploy/upgrade key, deploy is human-gated, no A–I injection path reaches it, least-privilege permissions, author-gated trigger and restored configuration
- ⚠️: Deploy is separated but a co-located injection vector (one of A–I) exists on a lower-privilege agent step, or the configuration restore is partial
- ❌: AI agent shares a job with deploy/upgrade authority AND an A–I path lets attacker input reach it — prompt-injected malicious program upgrade

*(Vectors A–I credited to the Trail of Bits agentic-actions-auditor plugin, its "Analyze for Attack Vectors" step; the pre-v1 input names and the composite / `secrets: inherit` boundary follow that skill's 2026-08 revision of its foundations and cross-file-resolution references. Phrased here for a Solana program deploy/upgrade pipeline.)*
