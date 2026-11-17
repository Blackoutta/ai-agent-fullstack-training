# File Discovery Patterns

> Maps each audit checklist to the exact files/globs that must be scanned.  
> These are defaults. A target with another layout records its in-scope paths at intake (`QUESTIONS.md` Q39, exclusions under Q44, written to `audit_<n>/intake.md` §1) instead of editing this file, which a shared or plugin install overwrites on update.

---

## Repository Layout Assumptions

```
{root}/
├── programs/{program_name}/src/    # Solana program (Anchor)
│   ├── lib.rs                      # Entry point
│   ├── errors.rs                   # Error definitions
│   ├── instructions/               # One file per instruction
│   │   ├── mod.rs
│   │   └── *.rs
│   └── state/                      # Account state structs
│       ├── mod.rs
│       └── *.rs
├── apps/backend/src/               # Backend API server
│   ├── index.ts                    # Server entry
│   ├── middleware/                  # Auth, rate limiting, errors
│   ├── routes/                     # API endpoints
│   ├── services/                   # Business logic
│   ├── lib/                        # Utilities
│   ├── types/                      # TypeScript types
│   └── scripts/                    # Admin/maintenance scripts
├── apps/web/src/                   # Frontend (Next.js)
│   ├── app/                        # Pages (app router)
│   │   ├── api/                    # API routes (proxy)
│   │   └── **/page.tsx             # Page components
│   ├── components/                 # React components
│   ├── contexts/                   # React contexts
│   ├── services/                   # Client services
│   ├── lib/                        # Utilities
│   └── types/                      # TypeScript types
├── packages/                       # Shared packages
├── target/                         # Build output (gitignored)
│   ├── idl/                        # Generated IDL
│   └── types/                      # Generated TS types
├── Anchor.toml                     # Anchor config
├── Cargo.toml                      # Rust workspace
├── package.json                    # Root package.json
└── .env*                           # Environment (gitignored)
```

---

## Checklist → File Mapping

### 01 — Account Validation
```
PRIMARY:
  programs/*/src/instructions/*.rs     # Every instruction's accounts struct
  programs/*/src/state/*.rs            # State definitions (discriminators, sizes)

GREP PATTERNS:
  "AccountInfo"          → Flag deprecated usage (should be UncheckedAccount)
  "/// CHECK:"           → Verify each has real validation
  "UncheckedAccount"     → Verify CHECK comment exists
  "init_if_needed"       → Flag reinitialization risk
  "remaining_accounts"   → Verify validation before use
  "#[account(init"       → Verify space, payer, seeds
  "#[account(close"      → Verify destination constrained
  "#[account(mut, dup)]" → Document intentional duplicates
```

### 02 — Access Control
```
PRIMARY:
  programs/*/src/instructions/*.rs     # Signer checks per instruction
  programs/*/src/lib.rs                # Instruction dispatch (who can call what)
  programs/*/src/state/*.rs            # State structs (look for authority/owner/role fields)

GREP PATTERNS:
  "Signer<'info>"       → Map which instructions have signers
  "has_one ="            → Map account linking
  "require_keys_eq!"    → Map runtime key checks
  "is_signer"           → Manual signer checks (should use Anchor Signer type)
  "pub fn "             → Every handler needs a signer analysis
```

### 03 — Arithmetic Safety
```
PRIMARY:
  programs/*/src/instructions/*.rs     # All instruction logic
  programs/*/src/state/*.rs            # Helper methods on state structs (calculate_*)

GREP PATTERNS:
  " + "                  → Bare addition (flag if on state/user values)
  " - "                  → Bare subtraction
  " * "                  → Bare multiplication
  " / "                  → Bare division
  "checked_add"          → Correct usage
  "checked_sub"          → Correct usage
  "checked_mul"          → Correct usage
  "checked_div"          → Correct usage
  "saturating_"          → Flag on financial paths
  "as u64"               → Truncation risk
  "as u32"               → Truncation risk
  "as u128"              → Widening (correct pattern)
  "MathOverflow"         → Error usage
```

### 04 — CPI & PDA Safety
```
PRIMARY:
  programs/*/src/instructions/*.rs     # All CPI calls
  programs/*/src/state/*.rs            # PDA seed definitions

GREP PATTERNS:
  "CpiContext::new("              → Check first arg is Pubkey
  "CpiContext::new_with_signer("  → Check first arg is Pubkey
  "invoke_signed"                 → Check seeds correct
  "invoke("                       → Flag bare invoke (should be invoke_signed for PDA)
  "token::transfer"               → Check from/to/authority
  "token::mint_to"                → Check mint/to/authority
  "token::burn"                   → Check from/authority
  "token::close_account"          → Check destination constrained
  "seeds ="                       → Map all PDA derivations
  "bump ="                        → Verify stored bump reuse
```

### 05 — State Machine
```
PRIMARY:
  programs/*/src/state/*.rs            # State enums (status fields, lifecycle variants)
  programs/*/src/instructions/*.rs     # All instructions (trace state transitions)

GREP PATTERNS:
  "status ="              → State transitions
  "Status::"              → All status enum references (adapt to your enum name)
  "emit!"                 → Event emission
  "#[event]"              → Event definitions
  "close ="               → Account closure (terminal state)
```

### 06 — Economic & Logic
```
PRIMARY:
  ALL programs/*/src/instructions/*.rs  (full instruction understanding required)
  programs/*/src/state/*.rs            # State structs (share/value calculation helpers)

GREP PATTERNS:
  "min_.*_out"           → Slippage protection (adapt field name to your protocol)
  "total_shares\|total_supply" → Share math invariants (adapt to your token/share field names)
  "total_assets\|total_value"  → Asset tracking field (adapt to your protocol)
  "admin_fee\|mgmt_fee"        → Fee configuration fields
  "TREASURY\|treasury"         → Treasury address constants
  "whitelist\|allowlist"       → CPI target allowlist
```

### 07 — OpSec & Governance
```
PRIMARY:
  Anchor.toml                          # Program ID, provider, cluster
  Cargo.toml                           # Dependencies, versions
  programs/*/src/lib.rs                # declare_id!
  .gitignore                           # Secrets exclusion

TERMINAL COMMANDS:
  solana program show <PROGRAM_ID>     # Upgrade authority
  anchor verify <PROGRAM_ID>           # Binary verification (rebuilds the target: Rule 11a mode only)

GREP PATTERNS:
  "declare_id!"          → Program ID
  "unsafe"               → Unsafe Rust (flag all)
  "*const\|*mut"         → Raw pointers (should not exist)
  "Pubkey::new_from_array"  → Hardcoded keys (potential backdoor)
```

### 08 — TypeScript Safety
```
PRIMARY:
  apps/backend/src/**/*.ts
  apps/web/src/**/*.ts
  apps/web/src/**/*.tsx
  packages/**/*.ts

GREP PATTERNS:
  ": any"                → Ban
  "as any"               → Ban
  "catch.*any"           → Ban
  "@coral-xyz/anchor"    → Wrong package
  "require("             → Should use import
  "@ts-ignore"           → Flag all
  "@ts-nocheck"          → Flag all
  "eval("                → Code injection
```

### 09 — Backend Security
```
PRIMARY:
  apps/backend/src/index.ts            # Server setup, CORS, helmet
  apps/backend/src/middleware/*.ts      # Auth, rate limiting, errors
  apps/backend/src/routes/*.ts         # Every route handler
  apps/backend/src/services/*.ts       # Business logic
  apps/backend/src/lib/*.ts            # Utilities
  apps/backend/package.json            # Dependencies

GREP PATTERNS:
  "router.post\|router.put\|router.delete"  → Mutation endpoints (need auth)
  "req.body"             → Input handling (needs zod)
  ".find("               → MongoDB queries (injection risk)
  "origin:"              → CORS config
  "helmet"               → Security headers
  "process.env"          → Env var usage
```

### 10 — Frontend Security
```
PRIMARY:
  apps/web/src/app/api/**/*.ts         # API routes
  apps/web/src/app/**/page.tsx         # Pages
  apps/web/src/components/**/*.tsx     # Components
  apps/web/src/services/**/*.ts        # Services
  apps/web/src/lib/**/*.ts             # Utilities
  apps/web/src/middleware.ts           # Middleware

GREP PATTERNS:
  "dangerouslySetInnerHTML"  → XSS vector
  "NEXT_PUBLIC_"             → Verify no secrets
  "console.log"              → Production logging
  "localStorage"             → Sensitive data storage
  "document.write"           → XSS
  "target=\"_blank\""        → Missing rel=noopener
```

### 11 — Supply Chain
```
PRIMARY:
  package.json                         # Root
  apps/backend/package.json            # Backend
  apps/web/package.json                # Frontend
  packages/*/package.json              # Shared
  package-lock.json                    # Lock file
  Cargo.toml                           # Rust workspace
  Cargo.lock                           # Rust lock file

TERMINAL COMMANDS (from a scratch dir OUTSIDE the target tree, on copies of the manifest +
lockfile, toolchain pinned — OUTPUT-RULES Rule 11a, FULL-AUDIT Step 3.2):
  npm audit                            # Known vulnerabilities
  cargo audit                          # Rust vulnerabilities
  npm info <pkg> time                  # Publish date check
  npm outdated                         # Outdated packages
```

### 12 — Secrets & Key Management
```
PRIMARY:
  .gitignore                           # Must exclude secrets
  .env*                                # Should not exist in repo
  apps/backend/src/index.ts            # Env var validation
  apps/web/src/app/api/**/*.ts         # Proxied API calls

SCAN TARGETS (entire repo):
  **/*.ts
  **/*.tsx
  **/*.json
  **/*.rs
  **/*.env*
  **/*.pem
  **/*keypair*
  **/*delegate*

TERMINAL COMMANDS (git with the OUTPUT-RULES Rule 11c prefix):
  GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
    ls-files | grep -i ".env"          # Committed env files
  GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
    log --all --no-textconv --no-ext-diff -S "private" --oneline   # Secrets in git history
  find . -name "*keypair*.json"        # Key files in repo
```

### 13 — Deployment & Infrastructure
```
PRIMARY:
  Anchor.toml                          # Build/deploy config
  <your-deploy-config>.yaml            # Deploy config (render.yaml, fly.toml, docker-compose.yml, etc.)
  apps/web/next.config.*               # Next.js config
  apps/backend/tsconfig.json           # TS config
  turbo.json                           # Monorepo config
  scripts/                             # Build/deploy scripts
  .github/workflows/                   # CI/CD (if exists)

TERMINAL COMMANDS (they run target code: only in the OUTPUT-RULES Rule 11a mode recorded at intake):
  anchor build 2>&1 | tail -20        # Build verification
  anchor test 2>&1 | tail -30         # Test run
```

### 14 — Python Safety
```
PRIMARY:
  **/*.py                              # All Python files
  requirements.txt                     # Pip dependencies
  pyproject.toml                       # Modern Python config
  setup.py / setup.cfg                 # Legacy config
  Pipfile / Pipfile.lock               # Pipenv
  poetry.lock                          # Poetry

FRAMEWORK-SPECIFIC:
  settings.py / settings/*.py          # Django settings
  wsgi.py / asgi.py                    # Django entrypoints
  app.py / main.py                     # Flask/FastAPI entrypoints
  manage.py                            # Django management

GREP PATTERNS:
  "eval("                → Code injection
  "exec("                → Code injection
  "os.system("           → Command injection
  "subprocess.*shell=True" → Command injection
  "pickle.load"          → Deserialization attack
  "yaml.load"            → Unsafe YAML (needs SafeLoader)
  "DEBUG = True"         → Debug in production
  "SECRET_KEY"           → Hardcoded secrets
  "verify=False"         → TLS bypass
  "import random"        → Weak PRNG (should be secrets)
  "password"             → Hardcoded credentials
  "__import__"           → Dynamic import risk

TERMINAL COMMANDS:
  pip audit                            # Known vulnerabilities
  safety check                         # Dependency audit
  bandit -r .                          # Static security analysis
```

### 15 — General Language Safety
```
AUTO-DETECT by file extension:
  .go          → Go sections (GL-071 through GL-074)
  .java / .kt  → Java/Kotlin sections (GL-075 through GL-078)
  .rb          → Ruby sections (GL-079 through GL-082)
  .php         → PHP sections (GL-083 through GL-086)
  any other    → Universal sections only (GL-001 through GL-070)

UNIVERSAL GREP PATTERNS (apply to any language):
  "eval("                → Code injection
  "exec("                → Code injection
  "password"             → Hardcoded credentials
  "secret"               → Hardcoded secrets
  "private.key\|private_key" → Key exposure
  "TODO.*security\|FIXME.*security" → Security debt markers
  "http://"              → Insecure protocol (should be https)
  "verify.*false\|skip.*verify" → TLS bypass

GO-SPECIFIC:
  "unsafe."              → Unsafe package usage
  "_ ="                  → Ignored error returns
  "exec.Command("        → Command injection risk

JAVA-SPECIFIC:
  "Runtime.exec"         → Command injection
  "ObjectInputStream"    → Deserialization
  "@CrossOrigin(\"*\")"  → Open CORS
  "PreparedStatement"    → Verify parameterized (good)
  "Statement.execute"    → Raw SQL (bad)

RUBY-SPECIFIC:
  "params.permit!"       → Mass assignment
  "send("                → Arbitrary method call
  "system("              → Command injection
  "eval("                → Code injection

PHP-SPECIFIC:
  "include($"            → File inclusion
  "mysql_query"          → Legacy SQL (injection risk)
  "display_errors"       → Error exposure
  "htmlspecialchars"     → Verify escaping (good)
```

### 16 — Formal Verification & Testing Quality
```
PRIMARY (CI/CD & Testing):
  .github/workflows/*.yml              # CI pipelines (static analysis, tests)
  Makefile* / scripts/*.sh             # Build/test scripts
  tests/ / **/*test* / **/*spec*       # Test files
  **/*.fuzz.* / **/fuzz_targets/       # Fuzz targets

PROJECT CONFIG:
  .clippy.toml                         # Rust linter config
  .eslintrc* / eslint.config.*         # TypeScript linter config
  .prettierrc*                         # Formatter config
  codecov.yml / .coveragerc            # Coverage config
  pyproject.toml [tool.pytest]         # Python test config

GREP PATTERNS:
  "proptest\|quickcheck\|fast-check\|hypothesis" → Property-based testing
  "fuzz\|fuzzing\|fuzzer"             → Fuzz testing
  "coverage\|lcov\|tarpaulin\|istanbul" → Coverage measurement
  "clippy\|eslint\|semgrep\|slither"  → Static analysis
  "INVARIANT\|invariant\|conservation" → Documented invariants
  ".unwrap()"                          → Panic-prone code in Rust
  "catch {}\|catch(e) {}"             → Swallowed errors
  "@ts-ignore\|@ts-nocheck"           → Suppressed type checks
```

### 17 — Logging, Monitoring & Incident Response
```
PRIMARY (Event Emission):
  programs/*/src/instructions/*.rs     # On-chain events (emit! / msg!)
  programs/*/src/state/*.rs            # Event struct definitions

PRIMARY (Backend Logging):
  apps/backend/src/middleware/*.ts      # Error/logging middleware
  apps/backend/src/index.ts            # Logger setup
  apps/backend/src/services/*.ts       # Business logic logging

PRIMARY (Monitoring):
  .github/workflows/*.yml              # CI alerting
  docker-compose*.yml                  # Monitoring services
  <your-deploy-config>.yaml            # Hosted monitoring config (render.yaml, fly.toml, etc.)

PRIMARY (IR & DR):
  INCIDENT*.md / RUNBOOK*.md           # Incident response docs
  docs/*disaster* / docs/*recovery*    # DR documentation

GREP PATTERNS:
  "emit!\|emit_cpi\|msg!"             → On-chain event emission
  "logger\.\|winston\|pino\|console.log" → Backend logging
  "sentry\|datadog\|grafana\|prometheus" → Monitoring setup
  "log.*password\|log.*secret\|log.*key" → Secrets in logs (BAD)
  "pause\|freeze\|emergency"           → Emergency mechanisms
  "backup\|snapshot\|restore"          → DR procedures
```

### 18 — Data Privacy, Compliance & Change Management
```
PRIMARY (Privacy):
  apps/backend/src/routes/*.ts         # API endpoints handling user data
  apps/backend/src/services/*.ts       # Data processing services
  apps/web/src/app/**/page.tsx         # Pages collecting user data

PRIMARY (Compliance):
  docs/*compliance* / docs/*privacy*   # Compliance documentation
  TERMS*.md / PRIVACY*.md             # Legal documents
  .github/CODEOWNERS                   # Code ownership

PRIMARY (Change Management):
  .github/workflows/*.yml              # CI/CD pipelines
  .github/CHANGELOG.md                 # Change tracking
  scripts/                             # Deployment scripts
  .github/pull_request_template.md     # PR process

PRIMARY (AI/ML):
  **/*ai* / **/*llm* / **/*ml*         # AI components
  apps/backend/src/services/*ai*.ts    # AI services

GREP PATTERNS:
  "email\|phone\|ssn\|dob\|passport\|kyc" → PII fields
  "encrypt\|decrypt\|cipher"           → Encryption of data at rest
  "gdpr\|privacy\|consent\|retention"  → Privacy implementation
  "openai\|anthropic\|llm\|gpt\|completion" → AI/ML integration
  "approve\|review\|merge.*protect"    → Change management controls
```

### 19 — AI Agent Security
```
PRIMARY (MCP & tool wiring):
  .mcp.json                            # MCP server allowlist (tool-access surface)
  **/mcp*.{ts,js,py}                   # MCP client/server setup
  **/agent*.{ts,js,py}                 # Agent SDK entrypoints / orchestration loops
  **/tools/*.{ts,js,py}                # Tool/function definitions exposed to the LLM

PRIMARY (Signing & guardrails):
  **/signer*.{ts,js,py,rs}             # Where the agent's key signs transactions
  **/*allowlist* / **/*policy*         # Program/target allowlists, spend caps, budgets

PRIMARY (CI with deploy keys):
  .github/workflows/*.yml              # Workflows holding deploy/mainnet keys or agent creds

GREP PATTERNS:
  "mcpServers"           → MCP servers granted to the agent (trust each one)
  "allowlist\|allowedPrograms\|whitelist" → CPI/target allowlist for autonomous signing
  "spend.?cap\|spendLimit\|maxLamports\|budget" → Spend caps on agent-signed txns
  "signAllTransactions\|signTransaction" → Blind-signing surface (inspect before sign)
  "openai\|anthropic\|prompt\|systemPrompt" → Prompt-injection surface
  "api_key\|apiKey\|SECRET"            → Secrets embedded in .mcp.json / agent config
```

### 20 — Rust Off-Chain Services
```
PRIMARY (all .rs OUTSIDE programs/):
  **/*.rs  EXCLUDING programs/**       # Off-chain infra: different threat model
  services/**/*.rs / crates/**/*.rs    # Standalone service crates
  bin/**/*.rs / src/bin/*.rs           # Binary entrypoints (bots, daemons)

TARGET SERVICE TYPES:
  geyser plugins        → "geyser\|GeyserPlugin\|yellowstone\|carbon"
  indexers              → "indexer\|substreams\|getProgramAccounts\|onLogs\|onAccountChange"
  keeper / liquidator bots → "keeper\|liquidator\|crank\|bot\|loop"
  signer services       → "Keypair\|sign_transaction\|signing_key"

TERMINAL COMMANDS:
  find . -name "*.rs" -not -path "./programs/*" -not -path "./target/*"  # Enumerate off-chain Rust

GREP PATTERNS:
  ".unwrap()\|.expect("  → Panic on network/RPC/deserialized input (remote DoS)
  "zeroize\|Zeroizing\|ZeroizeOnDrop" → Secret scrubbing on long-lived keys
  "reqwest\|tokio_tungstenite\|PubsubClient\|RpcClient" → Network/RPC trust boundaries
  "from_slice\|deserialize\|serde_json::from" → Untrusted-input parsing (needs bounds/error handling)
  "std::env\|dotenv\|Keypair::read" → Where long-lived signing keys are loaded
```

---

## Porting to New Repository

When auditing a different repository:

1. **Copy** the entire `.github/skills/auditor-skill/` folder
2. **Update** this file's "Repository Layout Assumptions" to match the target
3. **Update** the glob patterns above if directories differ
4. The checklists themselves are **generic** — they work for any Solana/Anchor program
5. Checklists 08-13 work for any TypeScript/Express/Next.js project
6. Checklist 14 works for any Python project
7. Checklist 15 works for Go, Java, Ruby, PHP, or any other language
8. Checklists 16-18 are **universal** — apply to every project regardless of stack
9. Add new checklists for frameworks not covered (e.g., if target uses Actix instead of Express)
