# 09 — Backend Security Checklist

> Domain: Express.js / Next.js route-handler backends (apps/backend/, apps/api/)  
> Severity if missed: HIGH to MEDIUM  
> References: OWASP Top 10, project backend-security instructions

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 9.1 — Authentication & Wallet Verification

- [ ] **BE-001**: Every POST/PUT/DELETE endpoint verifies wallet ownership via signature — not just trusting `walletAddress` from body
- [ ] **BE-002**: Signature verification headers present: `x-wallet`, `x-signature`, `x-timestamp`
- [ ] **BE-003**: Signed-message binding, one format across all endpoints: every message a wallet signs for this backend carries Sign-In-With-Solana-style fields — domain, cluster or chain ID, a single-use server-issued nonce, issued-at and expiry, plus the method and path for per-request signatures — and the server verifies each field and consumes the nonce before it accepts the signature (PASS: every field present and checked server-side; FAIL: a message without the domain, the cluster or a server nonce, e.g. `${method}:${path}:${timestamp}`, or a field the server does not check)
- [ ] **BE-004**: Verification library: `tweetnacl` or `@noble/ed25519` — correct usage of `sign.detached.verify()`
- [ ] **BE-005**: Replay protection: timestamp checked — reject if > 5 minutes old
- [ ] **BE-006**: Timestamp is compared against server time, not client-supplied time
- [ ] **BE-007**: Nonce or idempotency key used for critical mutations (prevent duplicate submissions)
- [ ] **BE-008**: Admin routes have ADDITIONAL auth beyond wallet signature (IP allowlist, admin wallet list)
- [ ] **BE-009**: No endpoint trusts `req.body.walletAddress` without signature verification for identity
- [ ] **BE-010**: Auth middleware is applied to ALL protected routes — no route accidentally unprotected

## 9.2 — Input Validation & Injection Prevention

- [ ] **BE-011**: Every request body passes through a zod schema before processing
- [ ] **BE-012**: MongoDB queries never use raw user input in `.find()` — validate format first
- [ ] **BE-013**: MongoDB: reject objects/arrays where strings are expected (NoSQL injection: `{ "$gt": "" }` in string fields)
- [ ] **BE-014**: MongoDB: use `$eq` explicitly instead of bare value matching for user-supplied fields
- [ ] **BE-015**: No `eval()`, `Function()`, or dynamic code execution with user input
- [ ] **BE-016**: No path traversal: file paths from user input are sanitized (no `../`)
- [ ] **BE-017**: No command injection: no `child_process.exec()` with user input
- [ ] **BE-018**: No SSRF: no HTTP requests to user-supplied URLs without allowlist
- [ ] **BE-019**: URL parameters validated — no open redirect via unvalidated redirect URLs
- [ ] **BE-020**: Content-Type header validated — only accept `application/json` for JSON endpoints

## 9.3 — On-Chain Verification

- [ ] **BE-021**: Trade records: transaction `signature` is verified as a real confirmed transaction via `connection.getTransaction()`
- [ ] **BE-022**: Trade verification: check that the transaction actually does what it claims (correct program, correct accounts)
- [ ] **BE-023**: Withdrawal records: verify the investor actually signed the withdrawal transaction
- [ ] **BE-024**: Deposit records: verify the deposit transaction signature on-chain before recording in database
- [ ] **BE-025**: Bridge deposits (if applicable): verify EVM transaction receipt via RPC before recording
- [ ] **BE-026**: No trust of off-chain data without on-chain verification for financial records
- [ ] **BE-027**: Transaction confirmation: use `confirmed` or `finalized` commitment — not `processed`
- [ ] **BE-028**: Handle transaction verification failures gracefully — don't record unverified transactions

## 9.4 — Rate Limiting

- [ ] **BE-029**: Rate limiting is enabled in ALL environments (not just production)
- [ ] **BE-030**: Global rate limit exists (e.g., 100 req/min per IP)
- [ ] **BE-031**: Per-endpoint rate limits for financial endpoints: swap, withdraw, trade (5-10 req/hour)
- [ ] **BE-032**: Per-wallet rate limits in addition to per-IP
- [ ] **BE-033**: Rate limit headers returned (`X-RateLimit-Remaining`, `Retry-After`)
- [ ] **BE-034**: Rate limiting cannot be bypassed via proxy/spoofed headers (X-Forwarded-For)
- [ ] **BE-035**: Rate limit store: in-memory works for single instance, Redis for multi-instance

## 9.5 — Error Handling

- [ ] **BE-036**: Custom error classes used: `AppError`, `AuthError`, `ValidationError` (not bare `Error`)
- [ ] **BE-037**: No stack traces exposed in production responses
- [ ] **BE-038**: Error responses use standard format: `{ error: string, code?: string }`
- [ ] **BE-039**: Status codes are correct: 400 validation, 401 auth, 403 forbidden, 404 not found, 429 rate limit, 500 internal
- [ ] **BE-040**: 500 errors are logged with full context (wallet, endpoint, timestamp, stack trace) but NOT returned to client
- [ ] **BE-041**: No `catch (e) { }` empty catch blocks — flag every occurrence
- [ ] **BE-042**: Global error handler (`app.use((err, req, res, next) => ...)`) catches all unhandled errors
- [ ] **BE-043**: Async route handlers wrapped with error-catching middleware (or use express-async-errors)
- [ ] **BE-044**: Database connection errors handled gracefully — don't crash the server

## 9.6 — HTTP Security Headers

- [ ] **BE-045**: Helmet middleware enabled with appropriate CSP
- [ ] **BE-046**: HSTS header: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- [ ] **BE-047**: X-Frame-Options: `DENY` or `SAMEORIGIN`
- [ ] **BE-048**: X-Content-Type-Options: `nosniff`
- [ ] **BE-049**: Content-Security-Policy: restrictive, no `unsafe-eval` or `unsafe-inline` unless necessary
- [ ] **BE-050**: Referrer-Policy: `strict-origin-when-cross-origin` or stricter

## 9.7 — CORS Configuration

- [ ] **BE-051**: CORS does NOT use `origin: true` (allows any origin)
- [ ] **BE-052**: CORS does NOT use `origin: '*'` (allows any origin)
- [ ] **BE-053**: CORS uses an explicit allowlist of origins
- [ ] **BE-054**: CORS `credentials: true` only with specific origins (not wildcard)
- [ ] **BE-055**: CORS `methods` restricted to necessary HTTP methods
- [ ] **BE-056**: CORS `allowedHeaders` restricted to necessary headers

## 9.8 — Database Security (MongoDB / Postgres / ClickHouse)

- [ ] **BE-057**: Database connection string does NOT contain credentials in code (uses env var)
- [ ] **BE-058**: Database uses authentication (not anonymous access)
- [ ] **BE-059**: Database user has minimum required permissions (not admin)
- [ ] **BE-060**: Database is not publicly accessible (firewall/security group)
- [ ] **BE-061**: Sensitive data is not logged in debug/info level
- [ ] **BE-062**: Database indexes exist for frequently queried fields (performance + DoS prevention)
- [ ] **BE-063**: No raw string concatenation in MongoDB queries — use parameterized queries
- [ ] **BE-064**: Document size limits enforced (prevent stored DoS via huge documents)
- [ ] **BE-124**: SQL / ClickHouse queries use parameter binding (`$1` in pg, `{name:Type}` in ClickHouse, prepared statements) — no string interpolation of user input into `query()` / `command()`; `ORDER BY` / column names taken from input go through an allowlist
- [ ] **BE-125**: Analytics and reporting paths (ClickHouse, read replicas) use a *read-only* database role; the public API's runtime role has no DDL and cannot reach admin / ingest tables
- [ ] **BE-126**: Schema migrations are versioned, forward-only, reviewed in PR, and applied by the deploy pipeline with a dedicated migration role — the application runtime user cannot run migrations

## 9.9 — Environment & Configuration

- [ ] **BE-065**: All required env vars validated at startup — fail fast if missing
- [ ] **BE-066**: No default values for secrets (no `process.env.SECRET || "default"`)
- [ ] **BE-067**: `.env` file is in `.gitignore`
- [ ] **BE-068**: No secrets in `package.json`, `tsconfig.json`, or any config file
- [ ] **BE-069**: Node environment is set correctly: `NODE_ENV=production` in production
- [ ] **BE-070**: Debug endpoints disabled in production (`/debug`, `/test`, `/dev`)

## 9.10 — Logging & Monitoring

- [ ] **BE-071**: Structured logging (JSON format) for machine-parsable logs
- [ ] **BE-072**: Log rotation configured (don't fill disk)
- [ ] **BE-073**: Sensitive data NOT logged: private keys, passwords, full request bodies with secrets
- [ ] **BE-074**: Request logging includes: method, path, wallet (if authed), status code, response time
- [ ] **BE-075**: Failed auth attempts logged with IP and wallet address
- [ ] **BE-076**: Anomaly detection: alerts on >X failed auth attempts from same IP/wallet

## 9.11 — IDOR & Mass Assignment

- [ ] **BE-077**: Every endpoint returning user-specific data verifies the authenticated user owns that resource (no IDOR)
- [ ] **BE-078**: Resource IDs in URLs/params cannot be enumerated to access other users' data (test with another user's ID)
- [ ] **BE-079**: Request body fields are explicitly picked before DB write — never `db.update(req.body)` or spread `...body`
- [ ] **BE-080**: No mass assignment: sending `{ isAdmin: true }` or `{ role: "admin" }` in body has no effect
- [ ] **BE-081**: API responses don't leak fields from other users (verify query filters include auth user constraint)

## 9.12 — BaaS Security (Supabase / Firebase / Appwrite)

- [ ] **BE-082**: If using Supabase: RLS (Row Level Security) is ENABLED on every single table — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- [ ] **BE-083**: RLS policies use `auth.uid() = user_id` (not just role check `authenticated`) — user can only see own rows
- [ ] **BE-084**: RLS policies exist for ALL operations: SELECT, INSERT, UPDATE, DELETE — not just SELECT
- [ ] **BE-085**: `service_role` / admin SDK key is NEVER in client-side code or `NEXT_PUBLIC_` env vars
- [ ] **BE-086**: Supabase Storage bucket policies restrict upload MIME types (no `.html`, `.svg`, `.js` unless intentional)
- [ ] **BE-087**: Database functions marked `security definer` are audited — they bypass RLS
- [ ] **BE-088**: If using Firebase: Firestore/RTDB security rules exist and are not `allow read, write: if true`
- [ ] **BE-089**: Firebase Storage rules validate file type and size — not open to all authenticated users
- [ ] **BE-090**: BaaS anon key (public) can only perform operations explicitly allowed by RLS/rules — test with curl

## 9.13 — Advanced Injection & Protocol Safety

- [ ] **BE-091**: No ReDoS — user-controlled strings not used in regex patterns, or safe regex library used with length limits
- [ ] **BE-092**: GraphQL: introspection disabled in production; query depth and complexity limits enforced
- [ ] **BE-093**: WebSocket connections require authentication on connect; unauthenticated sockets rejected immediately
- [ ] **BE-094**: Webhook endpoints validate cryptographic signatures (e.g., Stripe `constructEvent()`, GitHub HMAC)
- [ ] **BE-095**: Body parser has explicit size limits: `express.json({ limit: '1mb' })` — no unbounded payload acceptance
- [ ] **BE-096**: No XML parsing of user input, or if needed, external entities disabled (XXE prevention: `noent: false`, `dtd: false`)
- [ ] **BE-097**: HTTP response headers don't reflect user input (header injection / response splitting prevention)
- [ ] **BE-098**: Session tokens regenerated after authentication (session fixation prevention)
- [ ] **BE-099**: Login/signup responses don't reveal whether an account exists (consistent timing and messages for enumeration prevention)
- [ ] **BE-100**: No `JSON.parse` on user input used to construct objects with `__proto__` or `constructor` (prototype pollution via deserialization)

## 9.14 — Custody, Fund-Moving Auth & Off-Chain/On-Chain Consistency

- [ ] **BE-101**: Balance/inventory mutations on a shared resource use an atomic conditional update / row-lock (optimistic version or compare-and-set), never a read-modify-write split across an `await` boundary where two concurrent requests both read the old value (Aurory $830K TOCTOU)
- [ ] **BE-102**: Fund-moving endpoints require step-up authorization (fresh signature / 2FA / withdrawal-address allowlist) beyond a valid bearer session token — a leaked session cookie alone must NOT authorize a withdrawal (Thunder Terminal $240K, Banana Gun $3M: leaked session == custody)
- [ ] **BE-103**: Backends that sign an on-chain action after an off-chain check pair the atomic DB claim WITH an on-chain replay/nonce guard as defense-in-depth — a single logical claim cannot execute twice even if the DB row and the chain disagree (cross-ref VC-35; games/airdrops double-claim)

## 9.15 — Hosted Auth Providers (Clerk / Auth0 / WorkOS / NextAuth)

- [ ] **BE-104**: Routes distinguish credential *type*, not just validity — a Clerk / Auth0 session token and a machine / API-key token are checked for the expected `tokenType` / audience before access is granted; a route meant for browser sessions rejects API keys and vice-versa (a valid credential of the wrong kind is a 401, not a pass)
- [ ] **BE-105**: Issuer, audience and `authorizedParties` (Clerk) / allowed origins are pinned in server config — the provider SDK does not accept a session minted for another app, another instance (dev vs prod), or an arbitrary origin
- [ ] **BE-106**: Route protection is deny-by-default — the middleware / proxy matcher covers every API path and the *public-route allowlist* is an explicit, minimal list; each allowlisted prefix is reviewed for over-matching (a public `/api/v1/assets` prefix must not also expose `/api/v1/assets/admin`, trailing-slash or case variants)
- [ ] **BE-107**: Provider webhooks (`user.created`, `session.ended`, org membership changes) verify the delivery signature (Svix / HMAC + timestamp) before any user-sync write; sync scripts (`sync-*-profiles`) never ingest unsigned payloads
- [ ] **BE-108**: Roles / org membership / custom claims are re-read from the provider (or a short-TTL cache) on each privileged request — a role revoked in the provider dashboard cannot keep working for the life of a long session; session lifetime and revocation propagation are documented
- [ ] **BE-109**: Provider *secret* key (`CLERK_SECRET_KEY`, `AUTH0_CLIENT_SECRET`, `WORKOS_API_KEY`) is server-only and per-environment; only the publishable key reaches the client; development-instance keys are rejected by production config validation

## 9.16 — API-Key Issuance (When You Are the Provider)

- [ ] **BE-110**: Issued keys are stored as a strong hash (SHA-256 / HMAC, or Argon2 for low-entropy keys) plus a non-secret prefix for lookup — never in plaintext; the raw key is shown to the owner once at creation
- [ ] **BE-111**: If a "reveal again" feature stores the raw key encrypted, the encryption key lives in a KMS / Secret Manager with access separate from the database, ciphertexts carry a key version for rotation, and every reveal is authenticated, rate-limited and written to an audit log
- [ ] **BE-112**: Key lookup is prefix → constant-time hash compare; the hash is never used as a query filter on user-supplied input in a way that leaks timing or key existence
- [ ] **BE-113**: Scopes are enforced per route *in code* — each handler declares the scope it requires (e.g. `assets:read` vs `assets:risk:read`) and returns 403 on a missing scope; no handler falls back to "any valid key is enough"
- [ ] **BE-114**: Revocation is honored immediately — `revoked_at` (or equivalent) is checked on every request, and any key-lookup cache has a short TTL or explicit invalidation on revoke
- [ ] **BE-115**: Keys are bound to a project / owner; regeneration atomically deactivates the previous key (or the overlap grace window is explicit and documented); keys are revoked when the owning project or user is deleted
- [ ] **BE-116**: Rate limits and quotas are enforced server-side per key / project (429 + `Retry-After`), `last_used_at` is recorded for stale-key review, and per-key usage is metered separately from anonymous traffic
- [ ] **BE-117**: Keys never appear in logs, traces, error payloads or analytics — request logging redacts `x-api-key` / `Authorization`; a request id (`x-request-id`) is echoed instead for support correlation

## 9.17 — External Data Providers & Market-Data Integrity

- [ ] **BE-118**: Every upstream response (price, OHLCV, risk score, token metadata, news) is parsed through a schema (zod / valibot / Effect Schema) before use — an unexpected shape is an error, never passed through to clients or persisted
- [ ] **BE-119**: Security-relevant signals fail *closed* — when a risk / price / holder-analysis provider is down or rate-limited the API returns "unknown / unavailable", never a default of "safe", score 0, or a cached "clean"; clients can distinguish *unavailable* from *no issues found*
- [ ] **BE-120**: Upstream provider credentials (Birdeye, CoinGecko, Webacy, Helius, Jupiter, …) are server-side, one per service / environment, rotatable, and not shared between the public API and internal jobs (a leak from one surface must not burn the other)
- [ ] **BE-121**: Market data is sanitized before storage or serving — non-finite, negative, out-of-order or future-timestamped candles / prices are rejected, outlier bounds are applied, and data age is surfaced (`stale` flag or `as_of` timestamp) rather than silently served
- [ ] **BE-122**: Provider-supplied URLs (logo, website, socials, metadata `uri`) are validated (`https:` only, host allowlist, or an image proxy that sniffs content-type and strips SVG scripts) — token metadata is attacker-controlled and is both an SSRF and a stored-XSS vector
- [ ] **BE-123**: Response caches (Redis / ISR / `revalidate`) are keyed on *normalized* input — user-controlled key parts (query strings, headers) cannot poison a shared entry; stale-while-revalidate windows for financial data are documented and bounded

## 9.18 — Fee Sponsorship, Paymasters & Co-Signing (Transaction v1 aware)

> A service that signs as fee payer or adds a second signature to a client-built transaction holds custody: whatever policy it enforces before signing is the only thing between the sponsor key and an attacker. Transaction v1 (SIMD-0385) moved compute limits and the priority fee from `ComputeBudgetProgram` instructions into the message config, so any policy that scans instructions binds nothing on v1. See `references/vuln-classes/transaction-v1.md` and KV-135.

- [ ] **BE-127**: The sponsor decodes the **exact bytes** the client submitted with a v1-capable library and branches on the version first (wire byte 0 `== 0x81` ⇒ v1); an unrecognised version, a decode failure, or a size above the version's limit is a hard reject — the service never falls through to a legacy / v0 parse and never re-serialises a parsed model to sign
- [ ] **BE-128**: Fee and resource caps read the right source per version — v1: `transactionConfig` (`priorityFee`, `computeUnitLimit`, `loadedAccountsDataSizeLimit`, `heapSize`); legacy / v0: the ComputeBudget scan — and no-op ComputeBudget instructions inside a v1 transaction are ignored, neither trusted nor required
- [ ] **BE-129**: The priority-fee cap compares like units: v1 `priorityFee` is a **total in lamports**, v0 `SetComputeUnitPrice` is micro-lamports **per CU** (`price × limit ÷ 1e6`); the enforced ceiling is `5_000 × required_signatures + priority` in lamports, and an absent v1 field is treated as the runtime treats it (0), not as a v0 default
- [ ] **BE-130**: Program-id, instruction and destination allowlists evaluate **every** instruction (up to 64) and **every** inline account (up to 64) — no "first N instructions", no 1,232-byte assumption, no address-lookup-table resolution step; the sponsor key appears only as fee payer (never writable elsewhere, never an instruction signer)
- [ ] **BE-131**: The exact base64 bytes are simulated with the same config before signing; the request is rejected on `MaxLoadedAccountsDataSizeExceeded`, on any sponsor-balance delta beyond the computed fee, or on a simulation error; a per-key and per-user daily lamport budget is enforced independently of the per-transaction check (defense in depth with BE-102)

## 9.19 — Slot-Derived Time in Keepers, Bots & APIs (SIMD-0525)

> Off-chain services inherit the on-chain mistake: a keeper that computes "grace ends in N slots" or an API that converts slots to seconds with a hardcoded 400 ms now fires its safety windows at half the wall-clock. See KV-138.

- [ ] **BE-132**: Backend, keeper and bot time math never derives wall-clock from slots with a hardcoded slot duration (`slot * 400`, `slots_remaining * 0.4`, `216_000` as "a day", `150 * 400` as the blockhash lifetime); liquidation grace, auction end, order expiry, settlement deadlines and user-facing countdowns use `getBlockTime` / on-chain `unix_timestamp` or the live slot rate (`getRecentPerformanceSamples`). (PASS: timestamp-based, or slot rate fetched at runtime; FAIL: a keeper liquidates, sweeps or settles before the protocol's documented grace elapsed because its window was counted in 400 ms slots, or a signing service assumes a 60 s blockhash lifetime that is now ~30 s and re-broadcasts a stale message.)
