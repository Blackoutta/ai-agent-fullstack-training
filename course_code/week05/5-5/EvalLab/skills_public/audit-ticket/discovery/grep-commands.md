# Grep & Terminal Commands Reference

> Consolidated command library for the auditor-skill.  
> Every command uses tools available inside the VS Code agent (grep_search, run_in_terminal).  
> Commands are grouped by **what they detect**.

---

## Quick Reference — Command Categories

| Category | Detects |
|---|---|
| [Type Safety](#type-safety) | `any`, `@ts-ignore`, wrong imports |
| [Account Safety](#account-safety-rust) | `AccountInfo`, missing CHECK, init_if_needed |
| [Arithmetic Safety](#arithmetic-safety-rust) | Bare operators, truncation, missing checked_* |
| [CPI & PDA](#cpi--pda-rust) | CPI targets, invoke vs invoke_signed, seeds |
| [Access Control](#access-control-rust) | Signer mapping, has_one, key checks |
| [State Machine](#state-machine-rust) | Status transitions, events, account closures |
| [Secrets & Keys](#secrets--keys) | Hardcoded keys, env leaks, committed secrets |
| [Backend Security](#backend-security) | Auth gaps, CORS, MongoDB injection, rate limiting |
| [Frontend Security](#frontend-security) | XSS, exposed secrets, unsafe DOM |
| [Supply Chain](#supply-chain) | Compromised packages, audit, publish dates |
| [GitHub Actions](#github-actions-ci-trigger-trust) | Comment-trigger gating, expression / env-file injection, `pull_request_target` / `workflow_run` checkouts, artifacts, AI agents in CI |
| [Infrastructure](#infrastructure) | Build, deploy, upgrade authority |
| [Formal Verification & Testing](#formal-verification--testing-checklist-16) | Fuzz testing, coverage, static analysis, invariants |
| [Logging & Monitoring](#logging-monitoring--incident-response-checklist-17) | Events, logging, monitoring, emergency, DR |
| [Privacy & Compliance](#privacy-compliance--change-management-checklist-18) | PII, GDPR, AI/ML, change management |

---

## Type Safety

### Ban `any` (entire TS codebase)
```
grep_search: ": any"          includePattern: "**/*.ts"
grep_search: "as any"         includePattern: "**/*.ts"
grep_search: ": any"          includePattern: "**/*.tsx"
grep_search: "as any"         includePattern: "**/*.tsx"
```

### Ban wrong package
```
grep_search: "@coral-xyz/anchor"   includePattern: "**/*.ts"
```

### Find ts-ignore / ts-nocheck
```
grep_search: "@ts-ignore|@ts-nocheck"   isRegexp: true   includePattern: "**/*.ts"
```

### Find eval / Function constructor
```
grep_search: "eval(|new Function("   isRegexp: true   includePattern: "**/*.ts"
```

### Find require() (should be import)
```
grep_search: "require("   includePattern: "**/*.ts"
```

---

## Account Safety (Rust)

### Deprecated AccountInfo
```
grep_search: "AccountInfo<"   includePattern: "programs/**/*.rs"
```

### CHECK comments (must exist for every UncheckedAccount)
```
grep_search: "UncheckedAccount"   includePattern: "programs/**/*.rs"
grep_search: "/// CHECK:"         includePattern: "programs/**/*.rs"
```
> Cross-reference: every UncheckedAccount MUST have a CHECK comment on the preceding line.

### Reinitialization risk
```
grep_search: "init_if_needed"   includePattern: "programs/**/*.rs"
```

### remaining_accounts usage
```
grep_search: "remaining_accounts"   includePattern: "programs/**/*.rs"
```

### Account close targets
```
grep_search: "close ="   includePattern: "programs/**/*.rs"
```

### init with space calculation
```
grep_search: "#[account(init"   includePattern: "programs/**/*.rs"
```

---

## Arithmetic Safety (Rust)

### Bare operators on financial values
```bash
# Terminal: Find bare +, -, *, / in instruction files (manual review needed)
grep -n '[^_]+ [0-9]\|[0-9] +[^_]' programs/*/src/instructions/*.rs
grep -n '\* [0-9]\|[0-9] \*' programs/*/src/instructions/*.rs
grep -n '/ [0-9]\|[0-9] /' programs/*/src/instructions/*.rs
grep -n '- [0-9]\|[0-9] -' programs/*/src/instructions/*.rs
```

### Verify checked_* usage
```
grep_search: "checked_add|checked_sub|checked_mul|checked_div"   isRegexp: true   includePattern: "programs/**/*.rs"
```

### Dangerous saturating on financial paths
```
grep_search: "saturating_"   includePattern: "programs/**/*.rs"
```

### Truncation casts
```
grep_search: "as u64|as u32|as u16|as u8"   isRegexp: true   includePattern: "programs/**/*.rs"
```

### MathOverflow error usage
```
grep_search: "MathOverflow"   includePattern: "programs/**/*.rs"
```

### Division before multiplication
```bash
# Terminal: Find potential div-before-mul patterns (manual review)
grep -n '\.checked_div.*\.checked_mul\|/ .*\*' programs/*/src/instructions/*.rs
```

---

## CPI & PDA (Rust)

### All CPI calls
```
grep_search: "CpiContext::new"   includePattern: "programs/**/*.rs"
```

### invoke vs invoke_signed
```
grep_search: "invoke("           includePattern: "programs/**/*.rs"
grep_search: "invoke_signed("    includePattern: "programs/**/*.rs"
```
> Any `invoke(` from a PDA authority is a bug — should be `invoke_signed`.

### Token operations
```
grep_search: "token::transfer|token::mint_to|token::burn|token::close_account"   isRegexp: true   includePattern: "programs/**/*.rs"
```

### PDA seeds
```
grep_search: "seeds ="   includePattern: "programs/**/*.rs"
```

### Bump storage
```
grep_search: "bump ="   includePattern: "programs/**/*.rs"
grep_search: "bump"     includePattern: "programs/*/src/state/*.rs"
```

---

## Access Control (Rust)

### Signer mapping
```
grep_search: "Signer<'info>"   includePattern: "programs/**/*.rs"
```

### has_one constraints
```
grep_search: "has_one ="   includePattern: "programs/**/*.rs"
```

### Runtime key checks
```
grep_search: "require_keys_eq!"   includePattern: "programs/**/*.rs"
```

### Hardcoded pubkeys (backdoor risk)
```
grep_search: "Pubkey::new_from_array"   includePattern: "programs/**/*.rs"
```

---

## State Machine (Rust)

### Status enums and transitions
```
# Adapt the enum names below to match your program's actual status types
grep_search: "Status::"             includePattern: "programs/**/*.rs"
grep_search: "status ="             includePattern: "programs/**/*.rs"
```

### Events
```
grep_search: "#[event]"   includePattern: "programs/**/*.rs"
grep_search: "emit!"      includePattern: "programs/**/*.rs"
```

### Account closure
```
grep_search: "close ="   includePattern: "programs/**/*.rs"
```

---

## Secrets & Keys

### Hardcoded secrets in code
```
grep_search: "private_key|secret_key|mnemonic|seed_phrase"   isRegexp: true   includePattern: "**/*.ts"
grep_search: "-----BEGIN"   includePattern: "**/*"
```

### API keys in code
```
grep_search: "api_key|apiKey|api-key"   isRegexp: true   includePattern: "**/*.ts"
```

### Env var usage
```
grep_search: "process.env"   includePattern: "**/*.ts"
```

### NEXT_PUBLIC_ exposure
```
grep_search: "NEXT_PUBLIC_"   includePattern: "apps/web/**/*.ts"
grep_search: "NEXT_PUBLIC_"   includePattern: "apps/web/**/*.tsx"
```

### Committed env/key files
```bash
# Terminal (OUTPUT-RULES Rule 11c flags):
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  ls-files | grep -iE "\.env|keypair|delegate\.json|\.pem|\.key"
find . -name "*.env*" -not -path "./node_modules/*" -not -path "./.git/*"
find . -name "*keypair*" -not -path "./node_modules/*" -not -path "./.git/*"
```

### Git history secrets
```bash
# Terminal (OUTPUT-RULES Rule 11c flags; a pickaxe search runs the repo's textconv drivers unless
# --no-textconv is given). -S also matches files a committed .gitattributes marks -diff or binary;
# -G and patch output (-p) skip their content unless --text is given:
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  log --all --no-textconv --no-ext-diff -S "private" --oneline | head -20
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  log --all --no-textconv --no-ext-diff -S "secret" --oneline | head -20
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  log --all --no-textconv --no-ext-diff -S "BEGIN RSA" --oneline | head -20
```

---

## Backend Security

### Mutation endpoints without auth
```
grep_search: "router.post|router.put|router.delete|router.patch"   isRegexp: true   includePattern: "apps/backend/src/routes/*.ts"
```
> Cross-reference each with auth middleware.

### Input validation (must have zod)
```
grep_search: "req.body"   includePattern: "apps/backend/src/routes/*.ts"
grep_search: "z.object"   includePattern: "apps/backend/src/routes/*.ts"
```

### MongoDB injection risk
```
grep_search: ".find(|.findOne(|.updateOne(|.deleteOne("   isRegexp: true   includePattern: "apps/backend/**/*.ts"
```

### CORS configuration
```
grep_search: "origin:"   includePattern: "apps/backend/src/index.ts"
grep_search: "cors("     includePattern: "apps/backend/src/index.ts"
```

### Rate limiting
```
grep_search: "rateLimit|rateLimiter|limiter"   isRegexp: true   includePattern: "apps/backend/**/*.ts"
```

### Security headers
```
grep_search: "helmet"   includePattern: "apps/backend/**/*.ts"
```

### Hosted auth & API-key gating (BE-104..BE-117)
```
grep_search: "clerkMiddleware|createRouteMatcher|isPublicRoute|authorizedParties|tokenType"   isRegexp: true   includePattern: "apps/**/*.ts"
grep_search: "x-api-key|key_hash|keyPrefix|key_prefix|scopes"   isRegexp: true   includePattern: "apps/**/*.ts"
```
> Every non-public route must resolve to a credential-type check AND a scope check; list the public-route allowlist verbatim in the report.

### Next.js proxy / server actions (FE-077..FE-082)
```
grep_search: "use server"   includePattern: "apps/**/*.{ts,tsx}"
grep_search: "matcher:"   includePattern: "apps/**/{middleware,proxy}.ts"
grep_search: "remotePatterns|hostname: '\*\*'"   isRegexp: true   includePattern: "**/next.config.*"
```

### External data providers (BE-118..BE-123)
```
grep_search: "coingecko|birdeye|webacy|helius|jup\.ag"   isRegexp: true   includePattern: "apps/**/*.ts"
grep_search: "safeParse|\.parse\(|Schema\.decode"   isRegexp: true   includePattern: "apps/**/lib/**/*.ts"
```
> Pair each provider client with its schema; a client with no schema hit is a BE-118 finding.

### Token registry & risk-signal consumers (KV-132 / KV-133)
```
grep_search: "getTokenBySymbol|bySymbol|tokenlist|token_list|assetId|canonical|primaryVariant|coingeckoId|tokens\.xyz"   isRegexp: true   includePattern: "**/*.{ts,tsx,rs,py}"
grep_search: "riskScore|risk_score|trustTier|liquidityTier|isVerified|rugcheck|webacy|goplus"   isRegexp: true   includePattern: "**/*.{ts,tsx,rs,py}"
```
> Any hit that reaches a swap / send / collateral / listing decision loads `references/methodologies/token-registry-risk.md`.

### Transaction v1 readiness (KV-135 / KV-136, TS-061..064, BE-127..131, RS-018..021)
```
grep_search: "getTransaction|getBlock|blockSubscribe|get_transaction_with_config|get_block_with_config"   isRegexp: true   includePattern: "**/*.{ts,rs,py,go}"
grep_search: "maxSupportedTransactionVersion|max_supported_transaction_version"   isRegexp: true   includePattern: "**/*.{ts,rs,py,go}"
grep_search: "ComputeBudget|SetComputeUnitPrice|computeUnitPrice|micro.?lamports"   isRegexp: true   includePattern: "**/*.{ts,rs,py,go}"
grep_search: "feePayer|fee_payer|sponsor|paymaster|gasless|partialSign"   isRegexp: true   includePattern: "apps/**/*.{ts,rs,py}"
grep_search: "load_instruction_at|get_instruction_relative"   isRegexp: true   includePattern: "programs/**/*.rs"
```
> Every read site must carry the opt-in; every ComputeBudget scan must have a v1 `transactionConfig` branch; every fee-payer service must detect version on the raw bytes (`0x81`) before its cap; every program introspection must not gate on ComputeBudget instructions.

### Terraform / IaC hygiene (DEP-080..DEP-086)
```
# Terminal (OUTPUT-RULES Rule 11c flags on git):
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  ls-files | grep -E "\.tfstate|tfplan|\.terraform/"
grep -rn -E "allUsers|allAuthenticatedUsers|0\.0\.0\.0/0|roles/(editor|owner)|ingress.*all" terraform/
```

---

## Frontend Security

### XSS vectors
```
grep_search: "dangerouslySetInnerHTML"   includePattern: "apps/web/**/*.tsx"
grep_search: "document.write"            includePattern: "apps/web/**/*.ts"
```

### Console logging in production
```
grep_search: "console.log|console.warn|console.error"   isRegexp: true   includePattern: "apps/web/src/**/*.ts"
```

### Sensitive data in localStorage
```
grep_search: "localStorage|sessionStorage"   isRegexp: true   includePattern: "apps/web/**/*.ts"
```

### Missing rel=noopener
```
grep_search: "target=\"_blank\""   includePattern: "apps/web/**/*.tsx"
```

---

## Supply Chain

> Every package-manager or cargo command in this section reads the target's `.npmrc`, `.cargo/config*` and `rust-toolchain*` when started inside its tree. Run them from a scratch dir OUTSIDE the target tree, on copies of the manifest + lockfile with the toolchain pinned (OUTPUT-RULES Rule 11a; FULL-AUDIT Step 3.2).

### Check for compromised packages
```bash
# Terminal:
grep -E "axios.*1\.14\.1|axios.*0\.30\.4" package-lock.json
# from a scratch dir OUTSIDE the target tree holding copies of package.json + the lockfile (OUTPUT-RULES Rule 11a)
npm audit
```

### Package publish dates (14-day quarantine)
```bash
# Terminal: Check publish date for critical packages
npm info @anchor-lang/core time --json | tail -5
npm info express time --json | tail -5
npm info next time --json | tail -5
```

### Outdated packages
```bash
# Terminal:
npm outdated
cargo outdated  # if cargo-outdated installed
```

### License check
```bash
# Terminal:
npx license-checker --summary
```

---

## GitHub Actions (CI trigger trust)

> Locators for `references/vuln-classes/github-actions.md`, KV-080, KV-116, KV-139, KV-140, DEP-067..071 / DEP-090..096 and AI-021..035. A hit is a place to read, not a finding: open the whole workflow, then trace trigger → actor → payload → sink → privilege. Every recipe is recursive with `--include` and fully single-quoted where it contains `$` or `!`, so it runs unchanged in bash and zsh and never trips on an unmatched glob. Point the same commands at any `action.yml` / `action.yaml` outside `.github/` (composite actions at the repo root). `scripts/tests/test-gha-recipes.sh` runs R1–R8 exactly as written here, plus the KV-116 Step 1, KV-139 Step 1 and KV-140 Step 6 locators, against `scripts/tests/fixtures/gha/`, and fails if a known vector's copy of R1–R5 or R7 differs from this file by a byte.

```bash
# R1 — files with a comment / review / issue / discussion trigger that never mention author_association
grep -rlE --include='*.yml' --include='*.yaml' '^[[:space:]]*-?[[:space:]]*(issue_comment|pull_request_review_comment|pull_request_review|discussion_comment|discussion|issues):?[[:space:]]*(#.*)?$|^[[:space:]]*(issue_comment|pull_request_review_comment|pull_request_review|discussion_comment|discussion|issues):[[:space:]]*\{|^on:.*(issue_comment|pull_request_review|discussion|issues)' .github/ | xargs -r grep -L 'author_association'
```
> Works per file: a file that gates one job and leaves another open is not listed, so read every job's `if:` (DEP-090, KV-139). A job id named like an event can show up as noise.

```bash
# R2 — association read from the opener object (correct only on that object's own event branch)
grep -rnE --include='*.yml' --include='*.yaml' 'github\.event\.(issue|pull_request|discussion)\.author_association' .github/
```
> On a comment or review branch these fields describe whoever opened the issue, PR or discussion, not the commenter. A hit is fine only inside the `issues`, `pull_request_target` or `discussion` branch (DEP-090).

```bash
# R3 — unsound gate comparisons: string contains(), deny-lists, untrusted association values, app/<slug> strings, actor gates
grep -rnE --include='*.yml' --include='*.yaml' -e "contains\([[:space:]]*'[^']*(OWNER|MEMBER|COLLABORATOR)" -e 'author_association[[:space:]]*!=' -e '![[:space:]]*contains\([[:space:]]*from(JSON|Json)' -e 'github\.(actor|triggering_actor)[[:space:]]*[!=]=' -e 'contains\(.*github\.(actor|triggering_actor)' -e "[\"'](CONTRIBUTOR|FIRST_TIMER|FIRST_TIME_CONTRIBUTOR|MANNEQUIN)[\"']" -e "app/[A-Za-z0-9_-]+'" .github/
```
> An actor comparison is a sound allowlist on `issue_comment` (the actor is the commenter) and unsound on PR-family and `workflow_run` events (DEP-091). `contains(github.actor, …)` is a substring test and unsound on every event. Function names are case-insensitive, so `fromJson` counts the same as `fromJSON`.

```bash
# R4 — workflow_run consumers: head fields and artifact downloads
grep -rnE --include='*.yml' --include='*.yaml' 'workflow_run\.(head_branch|head_sha|head_commit|head_repository|display_title|pull_requests)|download-artifact|downloadArtifact|listWorkflowRunArtifacts|gh run download|run-id:' .github/
```
> DEP-094, KV-140.

```bash
# R5 — env-file and PATH writes, including tee -a and the github-script core helpers
grep -rnE --include='*.yml' --include='*.yaml' '(>>|tee[[:space:]]+(-a|--append))[[:space:]]*"?\$\{?GITHUB_(ENV|PATH|OUTPUT)|core\.(exportVariable|addPath)' .github/
```
> DEP-095. For each hit, find where the written value comes from.

```bash
# R6 — attacker-controlled expressions (confirm the sink: run:, script:, an agent prompt field, an env file)
grep -rnE --include='*.yml' --include='*.yaml' '\$\{\{.*(github\.event\.[a-z_.]*(body|default_branch|email|head_ref|label|message|name|page_name|ref|title|head_branch|display_title)|github\.head_ref|github\.event\.(commits|pages)\[|to(JSON|Json)\(github(\)|\.event[).]))' .github/
```
> Matches inside `env:` are the safe shell pattern but still taint agent prompts and env files (DEP-069, AI-023/024). Whole-context dumps count: `toJSON(github)` and `toJson(github.event…)` carry every attacker-controlled field.

```bash
# R7 — checkouts and fetches of PR or run heads, and the checkout-guard opt-out
grep -rnE --include='*.yml' --include='*.yaml' 'ref:[[:space:]]*.?\$\{\{[[:space:]]*(github\.event\.(pull_request\.(head\.(sha|ref)|merge_commit_sha)|workflow_run\.head_(sha|branch))|github\.head_ref|steps\.[A-Za-z0-9_-]+\.outputs\.head_(sha|ref)|from(JSON|Json)\(steps\.[A-Za-z0-9_-]+\.outputs\.[A-Za-z0-9_]+\)\.head\.(sha|ref))|repository:[[:space:]]*.?\$\{\{[[:space:]]*github\.event\.pull_request\.head\.repo\.full_name|refs/pull/|gh pr checkout|git (fetch|pull|checkout)[^#]*(pull/|head_ref|head\.ref|head\.sha)|allow-unsafe-pr-checkout' .github/
```
> DEP-092 (the commit that was approved) and DEP-093 (privileged triggers). Quoted expressions match too, and so do checkouts of a step output: `steps.<id>.outputs.head_sha` / `head_ref` and `fromJSON(steps.<id>.outputs.result).head.sha`. For a `ref:` fed by any other step output, read the step that sets it.

```bash
# R8 — AI agents in CI, their gates, and pre-v1 claude-code-action input names
grep -rnE --include='*.yml' --include='*.yaml' 'anthropics/claude-code-(base-)?action|run-gemini-cli|gemini-cli-action|openai/codex-action|actions/ai-inference|claude (-p|--print)|@anthropic-ai/claude-code|codex exec|gemini -p|allowed_non_write_users|allowed_bots|allow-users|allow-bots|include_comments_by_actor|direct_prompt|override_prompt|custom_instructions|allowed_tools|disallowed_tools|allowedTools|show_full_output|additional_permissions' .github/
```
> AI-023..031, AI-034..035, KV-116. Pre-v1 names (`direct_prompt`, `override_prompt`, `custom_instructions`, `allowed_tools`, `disallowed_tools`) can remain after a workflow's `uses:` line moves to `@v1` or a SHA, so judge each step by the keys it sets.

**Tool cross-check (optional, static).** `zizmor --offline --persona=auditor .github/workflows/` and CodeQL's `actions` language cover template injection, env-file writes, dangerous triggers and bot conditions. Neither replaces R1–R3, R7 or R8: on fixtures 01–17 in `scripts/tests/fixtures/gha/`, zizmor 1.30.1 did not flag a mention-only gate, the cross-object OR, a deny-list, event text in an agent prompt input, `allowed_non_write_users: "*"` or `allow-unsafe-pr-checkout: true` (details in `references/vuln-classes/github-actions.md` §9).

---

## Infrastructure

### Program upgrade authority
```bash
# Terminal:
solana program show <PROGRAM_ID> --url mainnet-beta
```

### Anchor build verification
```bash
# Terminal — builds the target (build.rs, proc-macros): only in the OUTPUT-RULES Rule 11a mode recorded at intake
anchor build 2>&1 | tail -20
```

### Test suite
```bash
# Terminal — runs the target's tests and Anchor.toml [scripts]: only in the OUTPUT-RULES Rule 11a mode recorded at intake
anchor test --validator legacy 2>&1 | tail -30
```

### Binary hash verification
```bash
# Terminal — rebuilds the target from source: only in the OUTPUT-RULES Rule 11a mode recorded at intake
anchor verify <PROGRAM_ID> --provider-url mainnet-beta
```

---

## Using These Commands

### From SKILL.md / Agent Invocation
The auditor agent should use `grep_search` tool calls with these patterns.  
For terminal commands, use `run_in_terminal`.

### Manual Execution
Copy-paste terminal commands into a system terminal.

### Batch Execution
When running a FULL audit (see FULL-AUDIT.md), execute commands per phase:
- Phase 1 (On-chain): Account Safety + Arithmetic + CPI/PDA + Access Control + State Machine
- Phase 2 (Off-chain): Type Safety + Backend Security + Frontend Security
- Phase 3 (DevOps): Secrets + Supply Chain + Infrastructure
- Phase 4 (Verification/Monitoring/Compliance): Formal Verification + Logging + Privacy

---

## Formal Verification & Testing (Checklist 16)

### Property-based / Fuzz testing
```
grep_search: "proptest|quickcheck|fast-check|hypothesis|fuzzing|fuzz_target"   isRegexp: true   includePattern: "**/*"
```

### Static analysis config
```
grep_search: "clippy|eslint|semgrep|slither|mythril"   isRegexp: true   includePattern: "**/*"
```

### Coverage tooling
```
grep_search: "coverage|lcov|tarpaulin|istanbul|c8|nyc"   isRegexp: true   includePattern: "**/*"
```

### Test quality indicators
```
grep_search: "describe\(|it\(|test\(|#\[test\]|#\[tokio::test\]"   isRegexp: true   includePattern: "**/*test*"
```

### Panic-prone code (Rust)
```
grep_search: ".unwrap()"   includePattern: "programs/**/*.rs"
grep_search: ".expect("    includePattern: "programs/**/*.rs"
```

### Suppressed type checking
```
grep_search: "@ts-ignore|@ts-nocheck|#\\[allow\\(clippy"   isRegexp: true   includePattern: "**/*"
```

### Swallowed errors
```
grep_search: "catch {}|catch(e) {}|catch (_) {}"   isRegexp: true   includePattern: "**/*.ts"
```

### Documented invariants
```
grep_search: "INVARIANT|invariant|conservation|SAFETY:"   isRegexp: true   includePattern: "**/*"
```

---

## Logging, Monitoring & Incident Response (Checklist 17)

### On-chain event emission
```
grep_search: "emit!|emit_cpi|#\\[event\\]"   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "msg!"   includePattern: "programs/**/*.rs"
```

### Backend logging
```
grep_search: "logger\.|winston|pino|console.log|console.error"   isRegexp: true   includePattern: "apps/backend/**/*.ts"
```

### Monitoring services
```
grep_search: "sentry|datadog|grafana|prometheus|newrelic"   isRegexp: true   includePattern: "**/*"
```

### Secrets in logs (vulnerability)
```
grep_search: "log.*password|log.*secret|log.*private|log.*mnemonic"   isRegexp: true   includePattern: "**/*.ts"
```

### Emergency mechanisms
```
grep_search: "pause|freeze|emergency|circuit.?breaker"   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "pause|freeze|emergency|circuit.?breaker"   isRegexp: true   includePattern: "apps/backend/**/*.ts"
```

### Backup & disaster recovery
```
grep_search: "backup|snapshot|restore|recovery"   isRegexp: true   includePattern: "**/*"
```

### Health check endpoints
```
grep_search: "health|readiness|liveness"   isRegexp: true   includePattern: "apps/backend/**/*.ts"
```

---

## Privacy, Compliance & Change Management (Checklist 18)

### PII fields
```
grep_search: "email|phone|ssn|dob|passport|kyc|firstName|lastName|address"   isRegexp: true   includePattern: "apps/**/*.ts"
```

### Encryption of data at rest
```
grep_search: "encrypt|decrypt|cipher|bcrypt|argon|scrypt"   isRegexp: true   includePattern: "apps/**/*.ts"
```

### Privacy / GDPR implementation
```
grep_search: "gdpr|privacy|consent|retention|deletion|anonymize"   isRegexp: true   includePattern: "**/*"
```

### AI/ML integration
```
grep_search: "openai|anthropic|llm|gpt|completion|embedding|prompt"   isRegexp: true   includePattern: "**/*.ts"
```

### Change management controls
```bash
# Terminal: Check branch protection (OUTPUT-RULES Rule 11c flags)
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false remote -v
# Terminal: Check for PR templates
find .github -name "*pull_request*" -o -name "CODEOWNERS" 2>/dev/null
```

### Deployment approval gates
```
grep_search: "approval|deploy.*gate|manual.*trigger"   isRegexp: true   includePattern: ".github/workflows/*.yml"
```

---

## Token, Sysvar & Modern On-Chain (v4.4 — KV-101..108)

### SPL Token & Token-2022 extensions (KV-105, KV-107, KV-108)
```
grep_search: "token_2022|spl_token_2022|token_interface|TokenInterface|InterfaceAccount"   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "permanent_delegate|default_account_state|transfer_fee|confidential|interest_bearing|close_authority|get_extension"   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "transfer_checked|mint_to_checked|burn_checked"   isRegexp: true   includePattern: "programs/**/*.rs"
```
> Flag plain `token::transfer` where `transfer_checked` should bind decimals/mint. Flag arbitrary-mint acceptance without extension inspection.

### Associated Token Account assumptions (KV-107)
```
grep_search: "associated_token|get_associated_token_address|getAssociatedTokenAddress"   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "getOrCreateAssociatedTokenAccount|createAssociatedTokenAccount"   isRegexp: true   includePattern: "apps/**/*.ts"
```
> Verify `associated_token::mint`/`authority`/`token_program` constraints — not a bare `Account<TokenAccount>` where the canonical ATA is assumed.

### Token decimals / cross-mint amount confusion (KV-108)
```
grep_search: "decimals|10u64\\.pow|10\\.pow|1_000_000|1e6|1e9"   isRegexp: true   includePattern: "programs/**/*.rs"
```
> Flag hardcoded decimals constants and raw cross-mint amount math.

### Sysvar spoofing (KV-101)
```
grep_search: "Clock::get|Rent::get"   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "UncheckedAccount.*[Cc]lock|AccountInfo.*[Cc]lock|Sysvar<'info,"   isRegexp: true   includePattern: "programs/**/*.rs"
```
> Time/rent must come from syscalls or `Sysvar<'info, T>` — never an unchecked passed account.

### Precompile signature introspection (KV-102)
```
grep_search: "load_instruction_at|get_instruction_relative|instructions_sysvar|ed25519_program|secp256k1_program|load_current_index"   isRegexp: true   includePattern: "programs/**/*.rs"
```
> Verify program-ID check + message/pubkey/offset binding + replay protection.

### Address Lookup Table & positional trust (KV-103)
```
grep_search: "remaining_accounts|accounts\\[[0-9]+\\]"   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "lookupTable|AddressLookupTable|compileToV0Message"   isRegexp: true   includePattern: "apps/**/*.ts"
```

### PDA bump canonicalization (KV-104)
```
grep_search: "create_program_address|find_program_address"   isRegexp: true   includePattern: "programs/**/*.rs"
```
> Any user-supplied bump fed to `create_program_address` is a finding. Bumps must be canonical, stored, and reused.

### Account revival after close (KV-106)
```
grep_search: "close = |CLOSED_ACCOUNT_DISCRIMINATOR|try_borrow_mut_lamports|\\*\\*lamports|init_if_needed"   isRegexp: true   includePattern: "programs/**/*.rs"
```
> Manual closes must zero the discriminator AND drain all lamports; guard `init_if_needed` against revival with stale state.

### Native / Pinocchio / p-token (KV-109)
```
grep_search: "pinocchio|p-token|p_token|no_std"   isRegexp: true   includePattern: "**/Cargo.toml"
grep_search: "entrypoint!|program_entrypoint!|fn process_instruction"   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "is_signer|is_writable|\\.owner\\(\\)|owner =="   isRegexp: true   includePattern: "programs/**/*.rs"
grep_search: "unsafe|get_unchecked|from_raw_parts|\\.add\\(|unsafe-account-resize"   isRegexp: true   includePattern: "programs/**/*.rs"
```
> No Anchor safety net: every owner/signer/mut/length/discriminator check is manual. Bounds-check zero-copy reads; validate `unsafe-account-resize` size; for p-token, diff against canonical `spl-token` edge cases.

---

## v5.0 — Solana × AI + Off-Chain Rust (KV-110..117, checklists 19-20)

### MCP server configuration (KV-114)
```
grep_search: "mcpServers|command|args|transport|stdio|sse"   isRegexp: true   includePattern: "**/.mcp.json"
grep_search: "mcpServers|@modelcontextprotocol|StdioServerTransport|SSEServerTransport"   isRegexp: true   includePattern: "**/*.{json,ts,js,py}"
```
> Every MCP server grants tool access to the agent. Verify each server is trusted, pinned, and scoped — an untrusted server = arbitrary tool execution + prompt-injection surface. Flag secrets embedded in `.mcp.json` (keys belong in `.env`).

### Agent signer allowlists & spend caps (KV-110, KV-113)
```
grep_search: "allowlist|allowList|whitelist|allowedPrograms|allowedTargets|allowedMints"   isRegexp: true   includePattern: "**/*.{ts,js,py,rs}"
grep_search: "spend.?cap|spendLimit|maxSpend|maxLamports|daily.?limit|per.?tx.?limit|budget"   isRegexp: true   includePattern: "**/*.{ts,js,py,rs}"
```
> Autonomous agents that sign transactions MUST enforce a program/target allowlist AND a spend cap. Missing either = an LLM-controlled key with unbounded on-chain authority.

### Secret zeroization on key material (KV-112)
```
grep_search: "zeroize|Zeroizing|ZeroizeOnDrop|secrecy::Secret|SecretString"   isRegexp: true   includePattern: "**/*.rs"
grep_search: "Keypair|private_key|secret_key|seed|mnemonic|signing_key"   isRegexp: true   includePattern: "**/*.rs"
```
> Secret-bearing types (keypairs, seeds, mnemonics) held in long-running off-chain services must be wrapped in `Zeroizing`/`zeroize` so they are scrubbed on drop — not left in freed heap for memory-dump exfiltration.

### Off-chain Rust services outside programs/ (checklist 20, KV-112)
```bash
# Terminal: locate off-chain Rust (geyser plugins, indexers, keeper/liquidator bots, signer services)
find . -name "*.rs" -not -path "./programs/*" -not -path "./target/*" -not -path "*/node_modules/*"
grep -rnE "geyser|GeyserPlugin|yellowstone|carbon|substreams|indexer|keeper|liquidator|crank|bot" --include="*.rs" -l . | grep -v "/programs/"
```
> Any `.rs` outside `programs/` is off-chain infra with a different threat model (network input, RPC trust, long-lived keys). Route it through checklist 20, not the on-chain checklists.

### Panic on network / untrusted input (RS-001..RS-005)
```
grep_search: "\\.unwrap\\(\\)|\\.expect\\("   isRegexp: true   includePattern: "**/*.rs"
```
> In off-chain services, `unwrap()`/`expect()` on RPC responses, websocket frames, or deserialized network payloads is a remote DoS — a malformed message crashes the indexer/keeper. Cross-reference hits against `.rs` files outside `programs/`.

### Blind bulk transaction signing (KV-113, AI-009)
```
grep_search: "signAllTransactions|signAll|sign_all|partialSign|signMessage"   isRegexp: true   includePattern: "**/*.{ts,js}"
grep_search: "signTransaction|sign_transaction|sign\\("   isRegexp: true   includePattern: "**/*.{ts,js,py,rs}"
```
> Verify each transaction is inspected (program IDs, instructions, amounts) BEFORE `signAllTransactions`. An agent or backend that blind-signs a batch handed to it by an untrusted caller can be drained via a smuggled instruction.
