---
id: 39
title: "Rate Limiting Bypass"
severity: 6
category: backend
---

### 39 — Rate Limiting Bypass
**Severity: 6** | **Real: Credential stuffing, brute force, scraping**

No rate limit, or bypassable via X-Forwarded-For spoofing — brute force passwords/OTPs or spam endpoints.

#### Verification Procedure

**Step 1: Check for rate limiting library**
```
grep -rn --include="*.ts" -iE "rateLimit|rate.limit|express-rate-limit|limiter" apps/backend/
```
- If no rate limiting library: ❌ FAIL immediately

**Step 2: Verify rate limiting is applied to all routes**
```
grep -rn --include="*.ts" "rateLimit\|rateLimiter" apps/backend/src/routes/ | wc -l
grep -rn --include="*.ts" "router\.\(get\|post\|put\|delete\)" apps/backend/src/routes/ | wc -l
```
- Compare counts — rate limiting should cover all or most routes
- ✅ PASS: Rate limiting on ALL routes (global middleware or per-route)
- ⚠️ PARTIAL: Rate limiting on some routes but not all
- ❌ FAIL: No rate limiting on critical routes (login, swap, withdraw)

**Step 3: Check rate limiter configuration**
```
grep -rn --include="*.ts" -A10 "rateLimit\|new.*Limiter" apps/backend/src/
```
- ✅ PASS: Reasonable limits (e.g., 100 req/15min for general, 10 req/min for mutations)
- ❌ FAIL: Limits too high (>1000/min) or too low (blocks legitimate use)

**Step 4: Check for IP trust settings**
```
grep -rn --include="*.ts" -iE "trust proxy\|X-Forwarded-For\|keyGenerator" apps/backend/src/
```
- ✅ PASS: Trust proxy configured correctly for the deployment (Render, Vercel, etc.)
- ❌ FAIL: `trust proxy` set to true without understanding implications (spoofable X-Forwarded-For)

**Step 5: Check if rate limit applies in all environments**
```
grep -rn --include="*.ts" "NODE_ENV\|production\|development" apps/backend/src/ | grep -i "rate"
```
- ✅ PASS: Rate limiting active in ALL environments
- ❌ FAIL: Rate limiting disabled in development (and env flag might be wrong in prod)

**Overall verdict:**
- ✅: Global rate limiting, reasonable limits, correct trust proxy, all environments
- ⚠️: Rate limiting present but not on all routes or limits are questionable
- ❌: No rate limiting or easily bypassable
