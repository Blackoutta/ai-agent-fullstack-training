---
id: 35
title: "JWT Algorithm Confusion"
severity: 8
category: backend
---

### 35 — JWT Algorithm Confusion
**Severity: 8** | **Real: Auth0 bypass, many Node.js apps using jsonwebtoken**

Server accepts `alg: "none"` or attacker changes RS256→HS256 (uses public key as HMAC secret) — forges any JWT.

#### Verification Procedure

**Step 1: Find JWT usage**
```
grep -rn --include="*.ts" -iE "jwt|jsonwebtoken|jose|verify.*token|sign.*token" apps/backend/
```
- If no JWT: N/A
- If JWT: proceed

**Step 2: Check algorithm is explicitly specified on verify**
```
grep -rn --include="*.ts" -A5 "jwt.verify\|jwtVerify\|verify(" apps/backend/ | grep -iE "algorithm\|alg"
```
- ✅ PASS: `jwt.verify(token, secret, { algorithms: ['HS256'] })` — explicit algorithm whitelist
- ❌ FAIL: `jwt.verify(token, secret)` without algorithms option (accepts any alg)

**Step 3: Check for "none" algorithm acceptance**
```
grep -rn --include="*.ts" -iE "algorithms.*none\|alg.*none" apps/backend/
```
- ✅ PASS: Zero results, and algorithms whitelist doesn't include "none"
- ❌ FAIL: "none" algorithm accepted

**Step 4: Check JWT secret strength**
```
grep -rn --include="*.ts" "JWT.*SECRET\|JWT.*KEY\|process\.env.*JWT" apps/backend/
```
- ✅ PASS: JWT secret comes from env var, is at least 256 bits / 32 chars
- ❌ FAIL: Hardcoded JWT secret or weak secret (e.g., "secret")

**Step 5: Check token expiration**
```
grep -rn --include="*.ts" "expiresIn\|exp[^o]" apps/backend/ | grep -i jwt
```
- ✅ PASS: Tokens have expiration (e.g., `expiresIn: '1h'`)
- ❌ FAIL: No expiration on JWT tokens (valid forever)

**Overall verdict:**
- ✅: Explicit algorithm whitelist, strong secret from env, token expiration
- ⚠️: Algorithm is explicit but other issues (weak secret, no expiration)
- ❌: No algorithm restriction on verify (accepts `none` or `HS256` with RS256 public key)
- N/A: No JWT used
