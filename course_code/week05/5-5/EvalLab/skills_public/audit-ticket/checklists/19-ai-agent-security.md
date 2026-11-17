# 19 — AI Agent Security Checklist (Solana × AI)

> Domain: Autonomous/AI agents that hold keys, sign transactions, use MCP tools, or run in a Solana deploy pipeline
> Severity if missed: CRITICAL (agent hot key drained / malicious upgrade shipped) to MEDIUM (over-scoped delegation)
> References: Trail of Bits agentic-actions-auditor (CI vectors ported below), Solana wallet/signing model, MCP tool-trust model

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

This checklist is NET-NEW: it covers the seam where an AI agent (autonomous trading bot, MCP-driven assistant, or AI coding agent in CI) is given the ability to act on Solana. An agent is *any* non-human actor that can select and submit instructions on behalf of a principal. If the codebase has no such actor, mark §19.1–19.5 `[N/A]`; §19.6 (tracked AI-tooling artifacts) applies to any repository that commits assistant configuration, agent or not.

---

## 19.1 — Agent Wallet Custody

- [ ] **AI-001**: Agent signing key is NEVER stored in plaintext at rest and NEVER passed as a raw env var / CLI arg the agent process can read back — key lives in a KMS/HSM, enclave, or remote signer; the agent holds a handle, not the bytes (grep for `Keypair.fromSecretKey`, `createKeyPairSignerFromBytes`, `PRIVATE_KEY`, `SECRET_KEY`, `*.json` keypair loads inside agent code)
- [ ] **AI-002**: Per-transaction spend cap enforced BEFORE signing — a single agent-signed tx cannot move more than a hard-coded maximum (lamports + per-mint token amount), checked in code, not merely prompted
- [ ] **AI-003**: Per-epoch / rolling-window spend cap enforced — cumulative value signed over a time window (hour/day/epoch) is bounded and persisted across restarts, so an attacker cannot reset it by crashing the process
- [ ] **AI-004**: Program allowlist — the agent may only sign instructions whose `programId` is on an explicit allowlist; any instruction targeting an unknown program is rejected pre-sign
- [ ] **AI-005**: Instruction allowlist — within allowed programs, only specific instruction discriminators/types are signable (e.g., swap + close, NOT `SetAuthority`, `Upgrade`, `Assign`, `CloseAccount` to arbitrary dest)
- [ ] **AI-006**: Destination allowlist — token/SOL transfer and `close`/rent-recipient destinations are constrained to a known set (self, treasury, whitelisted counterparties); arbitrary destinations rejected
- [ ] **AI-007**: The agent hot wallet holds only working capital; the bulk of funds sits in a separate cold/multisig wallet the agent CANNOT sign for (blast radius = hot balance only)

## 19.2 — Signing Discipline

- [ ] **AI-008**: Every transaction is `simulateTransaction`-ed AND decoded (instructions resolved to program + type + amounts) BEFORE a signature is produced — simulation failure or decode-mismatch aborts signing
- [ ] **AI-009**: No blind bulk signing — `signAllTransactions` / batch signing does not sign an opaque array; each element passes the same allowlist + simulation gate individually (grep for `signAllTransactions`)
- [ ] **AI-010**: Human-in-the-loop threshold — transactions above a configured value (or touching authority-changing instructions) require explicit human approval, not agent auto-approval
- [ ] **AI-011**: Simulation result is actually inspected — writable-account deltas / balance changes from the simulation are compared against the agent's intent, not just checked for `err == null`
- [ ] **AI-012**: The signer is the LAST stage and is isolated — the component that holds the key validates the fully-built tx itself and does not trust an upstream "already validated" flag from the LLM/orchestration layer

## 19.3 — MCP Tool Trust

- [ ] **AI-013**: Every MCP server the agent connects to is pinned by version AND integrity (hash / lockfile / pinned image digest) — not `@latest`, not an unpinned remote URL (inspect `.mcp.json` / MCP client config)
- [ ] **AI-014**: MCP tool *descriptions* are treated as untrusted data — the agent does not auto-execute or auto-sign because a tool's description/annotation instructs it to; descriptions cannot inject control-flow (tool-poisoning defense)
- [ ] **AI-015**: MCP tool *output* is validated/typed before it can influence a signing decision — a tool result is data, never a command; it does not flow unchecked into `eval`, a prompt that then signs, or transaction-construction
- [ ] **AI-016**: MCP server set is allowlisted and least-privilege — the agent cannot silently gain new tools at runtime (no dynamic server discovery that adds signing-capable tools without review)
- [ ] **AI-017**: Sensitive/signing-capable MCP tools require a distinct trust boundary (separate approval, separate credential) from read-only data tools — a poisoned read tool cannot reach the signer

## 19.4 — Injection Surface (On-Chain Data → LLM)

- [ ] **AI-018**: Attacker-controllable on-chain reads — transaction memos, SPL/Metaplex token & NFT metadata (name/symbol/uri and fetched JSON), account data, and program logs — are sanitized / delimited / treated as untrusted before entering the LLM context (grep for memo parsing, `metadata`, `logMessages`, `getParsedTransaction` feeding a prompt)
- [ ] **AI-019**: Retrieved/on-chain data CANNOT alter a tool-call or signing decision without passing a deterministic guardrail (allowlist/cap check) that runs OUTSIDE the LLM — i.e., prompt-injected text can never be the sole authority that triggers a signature
- [ ] **AI-020**: Off-chain content the agent fetches by following on-chain pointers (e.g., an NFT `uri`, a URL in a memo) is fetched in a sandbox and its body is likewise treated as untrusted LLM input, not as instructions

## 19.5 — AI-in-CI (Solana Deploy Pipeline)

> Solana port of Trail of Bits agentic-actions-auditor (9 CI/agent attack vectors), phrased for a program deploy/upgrade pipeline. An AI coding agent (Claude Code Action, Gemini CLI, Codex, etc.) running in CI is the "agent"; attacker-controlled input is PR/issue/comment/commit/log content. Who may trigger the agent job is DEP-090..091 (checklist 13 §13.13); the playbook is `references/vuln-classes/github-actions.md` §6.

- [ ] **AI-021**: No deploy/upgrade authority in agent reach — the CI AI agent's job/step has NO access to a program deploy keypair or upgrade-authority keypair (no `PROGRAM_DEPLOY_KEY`, `UPGRADE_AUTHORITY`, `id.json` in the agent step's env/secrets/checkout)
- [ ] **AI-022**: Human gate before ship — `solana program deploy`, `anchor deploy`, `anchor upgrade`, `solana program set-upgrade-authority`, and squads/multisig submit steps are NOT reachable from an AI-agent step without an explicit human approval boundary between the agent and the deploy (grep workflows for these commands co-located with an AI action)
- [ ] **AI-023**: (ToB A — Env Var Intermediary) Attacker-controlled event data (`github.event.*.body/title/head_ref`, commit message) does NOT flow through an `env:` block into the agent prompt — prompt cleanliness is not evidence of safety (sources: `references/vuln-classes/github-actions.md` §4.2)
- [ ] **AI-024**: (ToB B — Direct Expression Injection) No `${{ github.event.* }}` expression is interpolated directly into any of the AI agent's prompt fields — `prompt`, the pre-v1 claude-code-action `direct_prompt` / `override_prompt`, `custom_instructions` or `--append-system-prompt` in `claude_args`, Codex `prompt-file`, AI Inference `system-prompt` — judged by the input keys each step actually sets, since old keys can remain after a workflow's `uses:` line moves to `@v1` or a SHA
- [ ] **AI-025**: (ToB C — CLI Data Fetch) Agent prompts do not run `gh issue view` / `gh pr view` / `gh api` (or `solana`/`curl` data fetches) that pull attacker-controlled content into context at runtime — including Dependabot / Renovate PR bodies, which quote upstream release notes and commits (`references/vuln-classes/github-actions.md` §6.5)
- [ ] **AI-026**: (ToB D — `pull_request_target` + Checkout) No `pull_request_target` workflow checks out PR-head code and hands it to an agent that can reach secrets or the deploy pipeline (full check: DEP-093, KV-140)
- [ ] **AI-027**: (ToB E — Error-Log Injection) Build/test/`anchor build` error output and `workflow_dispatch` inputs are not piped into the agent prompt (logs carry attacker payloads from PR code)
- [ ] **AI-028**: (ToB F — Subshell Expansion) Tool allowlists granted to the agent — `--allowedTools` in `claude_args` (space-separated) or the pre-v1 `allowed_tools` input (comma-separated) — do not include commands that permit subshell expansion (`echo $(...)`, backticks) as an exfiltration bypass of the restriction; a `--disallowedTools` / pre-v1 `disallowed_tools` denylist does not compensate
- [ ] **AI-029**: (ToB G — Eval of AI Output) The agent's output is not consumed by a later step via `eval`/`exec`/unquoted `$()` — especially any step that then builds or submits a Solana transaction or deploy command
- [ ] **AI-030**: (ToB H — Dangerous Sandbox) No `danger-full-access`, `--allowedTools Bash(*)` (pre-v1: `allowed_tools: "Bash(*)"`), `--yolo`/`--approval-mode=yolo`, or `safety-strategy: unsafe` on the AI action — these turn prompt injection into RCE on a runner that may hold deploy keys; a `disallowed_tools` / `--disallowedTools` list next to a wildcard `Bash` grant does not make it safe
- [ ] **AI-031**: (ToB I — Wildcard Allowlists) No wildcard trigger allowlist (`allowed_non_write_users: "*"`, `allowed_bots: "*"`, `allow-users: "*"`, `allow-bots: true`) letting any external user or App invoke the agent (`allowed_bots` entries are not permission-checked at all), and on public repositories `include_comments_by_actor` limits whose comments reach the prompt
- [ ] **AI-034**: The authority an AI agent holds in CI is bounded and known — the agent step receives `github_token: ${{ secrets.GITHUB_TOKEN }}` under minimal job `permissions:` (on its default GitHub App path claude-code-action requests no explicit permissions unless `additional_permissions` is set, so the App token carries whatever the Claude App installation grants and the job's `permissions:` block does not limit it), never a personal access token; no publish, deploy or cloud secret sits in an `env:` its shell tool can read; `id-token: write` is present only where the action needs it and no cloud trust policy accepts that job's OIDC subject; and its public outputs (issue / PR edits and comments, commits, workflow logs with `show_full_output`) are reviewed as exfiltration channels (`references/vuln-classes/github-actions.md` §6.3, §6.6)
- [ ] **AI-035**: The agent never starts inside an untrusted PR checkout unless the action first restores agent configuration from the base branch — `anthropics/claude-code-action` ≥ v1.0.89 restores `.claude/`, `.mcp.json`, `.claude.json`, `.gitmodules`, `.ripgreprc`, `CLAUDE.md`, `CLAUDE.local.md` and `.husky` (v1.0.74–v1.0.88 leave the last three PR-controlled: PARTIAL; below v1.0.74, or a custom agent CLI after a PR-head checkout: FAIL); skills and commands come in through the `plugins` / `plugin_marketplaces` inputs rather than copies into the checkout's `.claude/` (the restore deletes them); restored hooks call no PR-controlled entry point (`npm run`, `make`, `Anchor.toml` `[hooks]` / `[scripts]`, `cargo build` → `build.rs`); and the agent job shares no cache or artifact with release or deploy jobs (`references/vuln-classes/github-actions.md` §6.4, §6.8)

## 19.6 — AI Tooling Artifacts in the Repository

- [ ] **AI-032**: Tracked AI-assistant configuration (`.claude/`, `.cursor/`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`) contains no secrets, API keys, internal hostnames or absolute local paths; per-user files (`settings.local.json`, session transcripts) are gitignored, and a repo-hygiene check in CI rejects assistant artifacts that were not intentionally published
- [ ] **AI-033**: Tool-permission allowlists in tracked agent config (`permissions.allow`, `allowedTools`, MCP server lists) do not grant unrestricted shell / network / deploy capability to every contributor's agent by default; commands that change production (`terraform apply`, `solana program deploy`, `gh secret`, `kubectl apply`) are explicitly denied
