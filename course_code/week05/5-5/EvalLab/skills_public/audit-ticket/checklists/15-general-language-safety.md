# 15 — General Language & Framework Safety Checklist

> Domain: Go, Java, C/C++, Ruby, PHP, or any language not covered by checklists 08-14  
> Severity if missed: varies by context  
> Purpose: Universal security principles that apply regardless of language

This checklist covers language-agnostic security patterns. When auditing a repo that uses a language without its own dedicated checklist, apply these items. Items are tagged with which languages they most commonly apply to.

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 15.1 — Input Validation (All Languages)

- [ ] **GL-001**: All external input (HTTP, CLI, file, env) is validated before use — type, length, range, format
- [ ] **GL-002**: No user input directly interpolated into SQL queries — parameterized queries only
- [ ] **GL-003**: No user input directly interpolated into shell commands — use argument lists, not string concatenation
- [ ] **GL-004**: No user input in `eval()`, `exec()`, `Function()`, or language-equivalent dynamic code execution
- [ ] **GL-005**: No user input in template rendering without escaping (server-side template injection)
- [ ] **GL-006**: No user input in file paths without sanitization (path traversal)
- [ ] **GL-007**: No user input in redirect URLs without whitelist validation (open redirect)
- [ ] **GL-008**: No user input in XML parsers without disabling external entities (XXE)
- [ ] **GL-009**: No user input in regular expressions without escaping (ReDoS)
- [ ] **GL-010**: No deserialization of untrusted data without validation (Java ObjectInputStream, PHP unserialize, Python pickle, Ruby Marshal)
- [ ] **GL-011**: HTTP request bodies validated against a schema before processing
- [ ] **GL-012**: Content-Type header validated on incoming requests

## 15.2 — Authentication & Session (All Web Frameworks)

- [ ] **GL-013**: Every mutation endpoint requires authentication
- [ ] **GL-014**: Every authenticated endpoint checks authorization (not just "is logged in" but "is allowed to do X")
- [ ] **GL-015**: Password storage uses bcrypt, argon2, or scrypt with sufficient work factor
- [ ] **GL-016**: Session tokens are unpredictable, rotated on privilege change, invalidated on logout
- [ ] **GL-017**: CSRF protection enabled on state-changing operations
- [ ] **GL-018**: Rate limiting on login/registration/password-reset endpoints
- [ ] **GL-019**: JWT tokens have expiration, issuer validation, and algorithm pinning (`alg: none` rejected)
- [ ] **GL-020**: API keys loaded from environment — never committed to source code
- [ ] **GL-021**: Multi-factor authentication available for admin/sensitive operations
- [ ] **GL-022**: Account enumeration prevented (same response for valid/invalid usernames)

## 15.3 — Cryptography (All Languages)

- [ ] **GL-023**: No MD5 or SHA1 for security-critical hashing (passwords, MACs, signatures)
- [ ] **GL-024**: Symmetric encryption uses AES-256-GCM or ChaCha20-Poly1305 — not ECB, not CBC without HMAC
- [ ] **GL-025**: Random values for security use CSPRNG — not Math.random(), rand(), or predictable sources
- [ ] **GL-026**: Constant-time comparison for secrets and tokens — no early-exit string comparison
- [ ] **GL-027**: TLS 1.2+ enforced — no fallback to SSL/TLS 1.0/1.1
- [ ] **GL-028**: Certificate validation enabled — no `InsecureSkipVerify`, `verify=False`, `NODE_TLS_REJECT_UNAUTHORIZED=0`
- [ ] **GL-029**: Private keys never logged, never in error messages, never in API responses
- [ ] **GL-030**: Key derivation for passwords uses PBKDF2 (10k+ iterations), bcrypt, argon2 — not raw hash

## 15.4 — Error Handling & Logging (All Languages)

- [ ] **GL-031**: No stack traces exposed to end users in production
- [ ] **GL-032**: No sensitive data in log messages (passwords, tokens, PII, private keys)
- [ ] **GL-033**: No empty catch/except blocks that silently swallow errors
- [ ] **GL-034**: Errors return appropriate HTTP status codes — not always 200 or always 500
- [ ] **GL-035**: Unhandled exceptions have a global handler that logs and returns safe error
- [ ] **GL-036**: Panic/abort behavior understood — does it crash the whole process?
- [ ] **GL-037**: Structured logging used — not string concatenation with secrets
- [ ] **GL-038**: Log injection prevented — newlines and control chars stripped from user data in logs

## 15.5 — Memory & Resource Safety

- [ ] **GL-039**: [C/C++] No buffer overflows — bounds checking on all array/buffer access
- [ ] **GL-040**: [C/C++] No use-after-free — ownership/lifetime tracking
- [ ] **GL-041**: [C/C++] No format string vulnerabilities — `printf(user_input)` without format spec
- [ ] **GL-042**: [Go] No goroutine leaks — all goroutines have exit conditions
- [ ] **GL-043**: [Go] No race conditions — `go vet -race` clean
- [ ] **GL-044**: [Java] No resource leaks — try-with-resources for closeable resources
- [ ] **GL-045**: [Ruby/PHP] No memory leaks in long-running processes
- [ ] **GL-046**: [All] File handles, DB connections, network sockets closed after use
- [ ] **GL-047**: [All] Timeouts configured for all external calls (HTTP, DB, RPC)
- [ ] **GL-048**: [All] Request/response size limits enforced — no unbounded allocation from user input

## 15.6 — Concurrency & Race Conditions

- [ ] **GL-049**: Financial operations are atomic — no TOCTOU (time-of-check-time-of-use) bugs
- [ ] **GL-050**: Database operations use transactions for multi-step updates
- [ ] **GL-051**: Shared mutable state protected by locks/mutexes/channels
- [ ] **GL-052**: No deadlocks from nested lock acquisition (consistent lock ordering)
- [ ] **GL-053**: Optimistic concurrency (version fields) used where appropriate
- [ ] **GL-054**: Rate limiters work correctly under concurrent requests (atomic counters)

## 15.7 — API & Network Security

- [ ] **GL-055**: CORS allows only specific trusted origins — not `*`
- [ ] **GL-056**: Security headers set: CSP, X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy
- [ ] **GL-057**: HTTP → HTTPS redirect in production
- [ ] **GL-058**: Response does not leak server version (X-Powered-By, Server header)
- [ ] **GL-059**: GraphQL: depth/complexity limits set if applicable
- [ ] **GL-060**: WebSocket connections authenticated and rate-limited
- [ ] **GL-061**: Outbound HTTP requests validate response (don't trust external API blindly)
- [ ] **GL-062**: DNS rebinding protection if applicable (validate Host header)

## 15.8 — Infrastructure & Configuration

- [ ] **GL-063**: Debug mode disabled in production
- [ ] **GL-064**: Default credentials changed (database, admin panels, third-party tools)
- [ ] **GL-065**: Unnecessary ports/services disabled
- [ ] **GL-066**: Dependency versions pinned — lockfile committed
- [ ] **GL-067**: No `sudo` or root privileges unless required
- [ ] **GL-068**: Docker images use non-root user, minimal base image, no secrets in layers
- [ ] **GL-069**: Environment variables validated at startup — fail fast if critical ones missing
- [ ] **GL-070**: Health check endpoint does not expose sensitive internal state

## 15.9 — Language-Specific Quick Checks

### Go
- [ ] **GL-071**: `err` return values always checked — no `_, _ = someFunc()`
- [ ] **GL-072**: No `unsafe` package usage without justification
- [ ] **GL-073**: `context.Context` used for cancellation/timeouts on all I/O
- [ ] **GL-074**: `defer` used for cleanup — not relying on manual close calls

### Java/Kotlin
- [ ] **GL-075**: No `Runtime.exec()` with string concatenation — use `ProcessBuilder` with arg list
- [ ] **GL-076**: Deserialization restricted — `ObjectInputFilter` configured or avoided entirely
- [ ] **GL-077**: Spring Security configured — default deny, explicit allow
- [ ] **GL-078**: No `@CrossOrigin("*")` on controllers

### Ruby
- [ ] **GL-079**: Rails `strong_parameters` used — no `params.permit!`
- [ ] **GL-080**: No `send()` with user input — `public_send()` at minimum
- [ ] **GL-081**: `Brakeman` scan clean
- [ ] **GL-082**: Gems version-pinned in Gemfile.lock

### PHP
- [ ] **GL-083**: No `include($user_input)` — file inclusion vulnerability
- [ ] **GL-084**: `display_errors = Off` in production
- [ ] **GL-085**: PDO with prepared statements — no `mysql_query()` or string concatenation
- [ ] **GL-086**: `htmlspecialchars()` used on all output — XSS prevention
- [ ] **GL-087**: No prototype pollution — user input not used as dynamic property key (`obj[userKey] = value`) without `__proto__`/`constructor` check
- [ ] **GL-088**: No user-controlled values in HTTP response headers — strip newlines and control characters (header injection / response splitting)

---

## How to Use This Checklist

1. **Identify languages** in the target repository
2. **Skip N/A sections** — mark entire subsections N/A if the language doesn't apply
3. **Apply GL-001 through GL-070** to every language found
4. **Apply language-specific sections** (GL-071+) only for matching languages
5. If a language has a **dedicated checklist** (08-TypeScript, 14-Python), use that instead — don't double-check
