---
id: 83
title: "Missing Rate Limiting on Critical Endpoints"
severity: 7
category: devops
---

### 83 — Missing Rate Limiting on Critical Endpoints
**Severity: 7** | **Real: Brute-force login, API abuse, resource exhaustion**

No rate limiting → attacker hammers login endpoint with password lists, or abuses expensive API endpoints.

#### Verification Procedure

**Step 1: Check for rate limiting middleware**
```
grep -rn --include="*.ts" -iE "rate.*limit|rateLimit|express-rate-limit|@nestjs/throttler" apps/backend/
```
- If none: ❌ FAIL (no rate limiting at all)
- If found: proceed

**Step 2: Check rate limit configuration**
```
grep -rn --include="*.ts" -A10 "rateLimit\|RateLimit" apps/backend/ | head -40
```
- ✅ PASS: Rate limits configured with reasonable windows and max requests
- ⚠️ PARTIAL: Rate limiting exists but very permissive (e.g., 10000 req/min)

**Step 3: Verify rate limiting on sensitive endpoints**
```
# These endpoints MUST have rate limiting:
# - Authentication / wallet verification
# - Swap execution
# - Withdrawal
# - Fund creation
grep -rn --include="*.ts" -iE "swap|withdraw|login|auth|create.*fund" apps/backend/src/routes/ | head -10
```
- ✅ PASS: All mutation/sensitive endpoints have rate limiting
- ❌ FAIL: Sensitive endpoints without rate limiting

**Step 4: Check per-endpoint vs global rate limiting**
```
# Global rate limiting is a start but per-endpoint is better
# (login should be more restrictive than read endpoints)
grep -rn --include="*.ts" "app\.use.*rateLimit" apps/backend/ | wc -l
grep -rn --include="*.ts" "router\.\(post\|put\|delete\).*rateLimit\|rateLimit.*router\.\(post\|put\|delete\)" apps/backend/ | wc -l
```
- ✅ PASS: Per-endpoint rate limits on sensitive routes
- ⚠️ PARTIAL: Global rate limit only (same limit for all routes)

**Step 5: Check for IP-based vs key-based limiting**
```
grep -rn --include="*.ts" "keyGenerator\|key.*req\.\|identifier" apps/backend/ | head -5
```
- ✅ PASS: Rate limiting by wallet address or API key (not just IP — NAT users share IP)
- ⚠️ PARTIAL: IP-based only (functional but imprecise)

**Overall verdict:**
- ✅: Per-endpoint rate limiting, wallet-keyed, reasonable limits on all mutations
- ⚠️: Global rate limiting present, covers sensitive endpoints
- ❌: No rate limiting, or sensitive endpoints unprotected
