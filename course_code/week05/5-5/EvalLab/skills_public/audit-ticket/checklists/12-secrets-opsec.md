# 12 — Secrets & Key Management Checklist

> Domain: Secrets handling, environment variables, key storage  
> Severity if missed: CRITICAL (exposed private key) to MEDIUM (leaked API key)  
> References: Project secrets-safety instructions, OWASP secrets management

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 12.1 — No Hardcoded Secrets

- [ ] **SEC-001**: `grep -rn "private" --include="*.ts" --include="*.tsx" --include="*.json"` — no private keys in source
- [ ] **SEC-002**: `grep -rn "secret" --include="*.ts" --include="*.json" --include="*.env*"` — check all matches
- [ ] **SEC-003**: `grep -rn "mnemonic\|seed phrase" --include="*.ts"` — zero results
- [ ] **SEC-004**: `grep -rn "password" --include="*.ts" --include="*.json"` — only refs to env vars
- [ ] **SEC-005**: No base58-encoded private keys in any file (44-character strings starting with specific patterns)
- [ ] **SEC-006**: No JSON keypair files committed (`.json` files with 64-element integer arrays)
- [ ] **SEC-007**: No Solana keypair files in repo (check for `id.json`, `*-keypair.json`, `*-delegate.json`)
- [ ] **SEC-008**: No `.env` files committed to git — check `GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false log --all --no-textconv --name-only | grep -i ".env"` (OUTPUT-RULES Rule 11c flags)
- [ ] **SEC-009**: No API keys hardcoded — check for patterns like `sk-`, `api_`, `key_`, long hex/base64 strings
- [ ] **SEC-010**: No RPC URLs with API keys hardcoded (check for `rpc.helius.xyz`, `rpc.ankr.com` with keys in URL)

## 12.2 — Environment Variable Handling

- [ ] **SEC-011**: All secrets loaded from `process.env.VARIABLE_NAME`
- [ ] **SEC-012**: Startup validation: all required env vars checked at application boot — fails fast if missing
- [ ] **SEC-013**: No default fallback values for secrets: `process.env.SECRET || "default"` is FORBIDDEN
- [ ] **SEC-014**: `NEXT_PUBLIC_` prefix — list all: verify NONE are secrets (these are exposed to browser)
- [ ] **SEC-015**: Backend `.env` variables NOT prefixed with `NEXT_PUBLIC_`
- [ ] **SEC-016**: `.env.example` or `.env.template` exists with variable names but NO actual values
- [ ] **SEC-017**: Different env vars for dev/staging/production — verify no cross-contamination

## 12.3 — Git Hygiene

- [ ] **SEC-018**: `.gitignore` includes: `.env`, `.env.*`, `*.pem`, `*-keypair.json`, `*-delegate.json`, `id.json`
- [ ] **SEC-019**: `.gitignore` includes: `node_modules/`, `target/`, `.anchor/`, `test-ledger/`
- [ ] **SEC-020**: Run `GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false log --all --no-textconv --diff-filter=A --name-only` (OUTPUT-RULES Rule 11c flags) — check if secrets were EVER committed (even if now deleted)
- [ ] **SEC-021**: If any secret was ever committed — it MUST be rotated (deleting from git history is not sufficient)
- [ ] **SEC-022**: Pre-commit hooks: is there a secret detection hook? (gitleaks, detect-secrets, etc.)
- [ ] **SEC-023**: No `.env` in any branch (check all branches, not just current)
- [ ] **SEC-024**: Commit messages don't contain secrets or API keys

## 12.4 — RPC & API Key Safety

- [ ] **SEC-025**: Solana RPC URL uses dedicated provider (Helius, Triton, QuickNode) — not `api.mainnet-beta.solana.com`
- [ ] **SEC-026**: RPC API key is in backend `.env` — not exposed in frontend
- [ ] **SEC-027**: If RPC is needed in frontend — proxied through backend API route
- [ ] **SEC-028**: Jupiter API key (`x-api-key` header) — stored in backend env var, not frontend
- [ ] **SEC-029**: MongoDB connection string — in env var, not in code
- [ ] **SEC-030**: Any third-party API keys — all in env vars with startup validation
- [ ] **SEC-031**: API keys are scoped to minimum required permissions (e.g., read-only where possible)
- [ ] **SEC-032**: API key rotation schedule documented (quarterly minimum)

## 12.5 — Wallet & Program Key Safety

- [ ] **SEC-033**: Program deploy keypair — NOT stored on dev machine for mainnet
- [ ] **SEC-034**: Program deploy keypair — on hardware wallet (Ledger) or multisig for mainnet
- [ ] **SEC-035**: Program authority keypair — separate from deploy keypair (defense-in-depth)
- [ ] **SEC-036**: Backend service wallet — holds minimum SOL (only for gas), no other tokens
- [ ] **SEC-037**: Backend service wallet — private key in env var, not in file
- [ ] **SEC-038**: Manager wallets — hardware wallet recommended for production
- [ ] **SEC-039**: Treasury wallet — multisig or hardware wallet
- [ ] **SEC-040**: Test wallets — separate from production, devnet only

## 12.6 — Server & Infrastructure Secrets

- [ ] **SEC-041**: Server SSH keys — key-based auth, password auth disabled
- [ ] **SEC-042**: Server access — 2FA enabled for all admin accounts
- [ ] **SEC-043**: Database credentials — unique per service, not shared
- [ ] **SEC-044**: TLS certificates — valid and auto-renewed (Let's Encrypt or provider-managed)
- [ ] **SEC-045**: Secrets manager used (AWS SSM, Vault, Doppler) or env vars in hosting platform (Render, Vercel)
- [ ] **SEC-046**: No secrets in CI/CD logs — build processes don't echo env vars
- [ ] **SEC-047**: Docker images (if used) — no secrets baked into image layers

## 12.7 — Key Rotation & Incident

- [ ] **SEC-048**: Process exists for emergency key rotation
- [ ] **SEC-049**: If a key is suspected compromised — documented steps for rotation
- [ ] **SEC-050**: After key rotation — all services updated atomically (no partial deployment with mixed keys)
- [ ] **SEC-051**: Revoked/rotated keys are actually deactivated (not just removed from source but still valid)
- [ ] **SEC-052**: Key rotation doesn't break dependent services (graceful transition)

## 12.8 — Signing-Key Generation & Signing-Service Integrity

- [ ] **SEC-053**: Signing keys are generated with a CSPRNG (never predictable or derived from transaction material / timestamps / counters); any custom signing service is reviewed for ECDSA/EdDSA nonce reuse and side-channels, or replaced with a vetted HSM/MPC signer (Upbit $36.8M — private key back-calculated from on-chain signature material)
