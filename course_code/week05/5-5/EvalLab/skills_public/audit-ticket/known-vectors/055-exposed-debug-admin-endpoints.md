---
id: 55
title: "Exposed Debug/Admin Endpoints"
severity: 7
category: backend
---

### 55 — Exposed Debug/Admin Endpoints
**Severity: 7** | **Real: Django admin exposure, Express debug routes, exposed /health with internal data**

`/debug`, `/admin`, `/test` endpoints active in production — attacker accesses internal state.

#### Verification Procedure

**Step 1: Find all route definitions**
```
grep -rn --include="*.ts" "router\.\(get\|post\|put\|delete\|use\)" apps/backend/src/routes/ | grep -iE "debug|test|dev|admin|internal|metrics|health|status"
```
- Record: Any debug/test/admin endpoints

**Step 2: Check if debug endpoints are production-gated**
```
grep -rn --include="*.ts" -B5 -A5 "debug\|/test\|/dev\|/admin" apps/backend/src/routes/ | grep "NODE_ENV\|production"
```
- ✅ PASS: Debug endpoints are behind `NODE_ENV !== 'production'` check
- ❌ FAIL: Debug endpoints accessible in all environments

**Step 3: Check health/status endpoints for data leakage**
```
grep -rn --include="*.ts" -A10 "health\|status\|metrics" apps/backend/src/routes/
```
- ✅ PASS: Health endpoint returns only `{ status: 'ok' }` — no internal details
- ❌ FAIL: Health endpoint reveals database status, env vars, version numbers, or internal IPs

**Step 4: Check for development-only middleware**
```
grep -rn --include="*.ts" "morgan\|debugger\|errorHandler\|stackTrace" apps/backend/src/
```
- ✅ PASS: Verbose logging/error middleware only in development
- ❌ FAIL: Development middleware (stack traces, verbose errors) active in all environments

**Overall verdict:**
- ✅: No debug endpoints in production, health is clean, verbose logging dev-only
- ⚠️: Debug endpoints exist but behind auth
- ❌: Debug/admin endpoints accessible in production without auth

---

## Frontend / Client-Side Hacks (56-75)
