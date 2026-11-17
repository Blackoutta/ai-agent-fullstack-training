---
id: 62
title: "Client-Side Auth Bypass"
severity: 7
category: frontend
---

### 62 — Client-Side Auth Bypass
**Severity: 7** | **Real: Countless SPAs with client-only auth**

Frontend checks `if (!loggedIn) redirect('/login')` — but API has no auth. Attacker calls API directly, bypasses UI guards.

#### Verification Procedure

**Step 1: Find client-side auth guards**
```
grep -rn --include="*.tsx" -iE "isAuthenticated|isLoggedIn|loggedIn|user\?\.|!user\b|!wallet" apps/web/
```
- Record: All frontend auth checks

**Step 2: Cross-reference with backend auth**
```
# For each frontend-protected page:
# 1. What API endpoints does it call?
# 2. Do those endpoints ALSO have server-side auth?
```
- ✅ PASS: Every API endpoint behind a frontend guard ALSO has backend auth middleware
- ❌ FAIL: Frontend-only protection — API accessible without auth

**Step 3: Check for API routes without auth middleware**
```
grep -rn --include="*.ts" "router\.\(get\|post\|put\|delete\)" apps/backend/src/routes/ | wc -l
grep -rn --include="*.ts" "verifySignature\|authMiddleware\|authenticate" apps/backend/src/routes/ | wc -l
```
- Compare: mutation route count vs auth middleware count
- ✅ PASS: All mutation routes have auth
- ❌ FAIL: Mutation routes without auth (relying on frontend to hide them)

**Step 4: Test by calling API directly**
```
# Mentally trace: can I call POST /api/swap without wallet signature?
# Can I call GET /api/fund/private-data without auth?
```
- ✅ PASS: Unauthenticated API calls return 401
- ❌ FAIL: API returns data or processes request without auth

**Overall verdict:**
- ✅: Backend enforces auth on all mutations, frontend is just UX
- ⚠️: Most backend routes authed, but some read endpoints leak data
- ❌: Backend relies on frontend for access control
