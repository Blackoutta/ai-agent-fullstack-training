---
id: 38
title: "IDOR (Insecure Direct Object Reference)"
severity: 7
category: backend
---

### 38 — IDOR (Insecure Direct Object Reference)
**Severity: 7** | **Real: OWASP #1 category, constant exploitation**

Change `userId=123` to `userId=124` in request — access/modify another user's resources.

#### Verification Procedure

**Step 1: Find all routes that accept resource identifiers**
```
grep -rn --include="*.ts" "req\.params\.\|req\.query\.\|req\.body\." apps/backend/src/routes/ | grep -iE "id|address|wallet|fund|user"
```
- Record: Every endpoint that accepts an ID or address

**Step 2: For each endpoint, verify ownership check**
```
# For each route: after receiving the ID, does it verify the authenticated user owns that resource?
# Pattern: get wallet from auth → fetch resource → verify resource.owner == wallet
```
- ✅ PASS: Every resource access includes ownership verification against authenticated user
- ❌ FAIL: Any endpoint that fetches a resource by ID without verifying the requester owns it

**Step 3: Check wallet address authentication**
```
grep -rn --include="*.ts" -iE "walletAddress|wallet.*verified|auth.*middleware\|verifySignature" apps/backend/src/routes/
```
- ✅ PASS: Wallet address comes from verified signature, NOT from request body
- ❌ FAIL: Backend trusts `req.body.walletAddress` without signature verification

**Step 4: Check for authorization middleware**
```
grep -rn --include="*.ts" "middleware\|auth\|protect\|guard" apps/backend/src/routes/ | head -20
```
- ✅ PASS: Auth middleware extracts user identity from cryptographic proof
- ❌ FAIL: No auth middleware, or identity from unverified header/body field

**Step 5: Check for horizontal privilege escalation**
```
# Can user A's wallet access user B's fund data by knowing the fund address?
# Each data endpoint should filter by the authenticated wallet
grep -rn --include="*.ts" -B5 "find(" apps/backend/src/routes/ | grep -iE "walletAddress\|manager\|investor"
```
- ✅ PASS: All queries include the authenticated wallet as a filter condition
- ❌ FAIL: Queries filter only by the resource ID (any authenticated user can access any resource)

**Overall verdict:**
- ✅: Signature-based auth, ownership checks on all resources, wallet in query filter
- ⚠️: Auth present but some endpoints missing ownership check
- ❌: Resource access without ownership verification
