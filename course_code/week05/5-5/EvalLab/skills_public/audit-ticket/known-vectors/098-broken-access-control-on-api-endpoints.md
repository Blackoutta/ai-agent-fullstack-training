---
id: 98
title: "Broken Access Control on API Endpoints"
severity: 8
category: devops
---

### 98 — Broken Access Control on API Endpoints
**Severity: 8** | **Real: OWASP #1 vulnerability (2021-2025), IDOR and privilege escalation**

User A can access/modify User B's data by changing an ID parameter. Or regular user accesses admin endpoints.

#### Verification Procedure

**Step 1: Find all endpoints that take user/fund identifiers**
```
grep -rn --include="*.ts" "params\.\|req\.params\.\|req\.body.*[Ii]d\|req\.body.*address\|req\.body.*wallet" apps/backend/src/routes/ | head -20
```
- Record: All endpoints with user-provided resource IDs

**Step 2: Check authorization on each endpoint**
```
# For each endpoint that takes an ID:
# Does it verify the authenticated user owns/has access to that resource?
grep -rn --include="*.ts" -A10 "router\.\(get\|post\|put\|delete\)" apps/backend/src/routes/ | grep -iE "walletAddress.*===\|owner.*===\|authorize\|belongs" | head -10
```
- ✅ PASS: Every endpoint verifies authenticated user has access to the requested resource
- ❌ FAIL: Endpoints return data based solely on provided ID (IDOR)

**Step 3: Check for admin endpoint protection**
```
grep -rn --include="*.ts" -iE "admin|manager|owner" apps/backend/src/routes/ | grep -iE "require\|check\|verify" | head -5
```
- ✅ PASS: Admin actions require admin role verification
- ❌ FAIL: No role-based access control (anyone can call admin endpoints)

**Step 4: Check for wallet ownership verification**
```
# Can any wallet claim to be an admin/manager?
grep -rn --include="*.ts" "walletAddress\|managerAddress\|fundManager" apps/backend/src/routes/ | grep -iE "verify\|sign\|signature" | head -10
```
- ✅ PASS: Wallet address verified by signature check (can't impersonate)
- ❌ FAIL: Wallet address taken from request body without signature verification

**Step 5: Test for horizontal privilege escalation**
```
# Can I pass "fundId: someone-elses-fund" and get their data?
# Can I pass "walletAddress: someone-elses-wallet" and act as them?
# Mentally trace each mutation endpoint
```
- ✅ PASS: Signature verification + ownership check on all mutations
- ❌ FAIL: Resource access based only on provided IDs

**Overall verdict:**
- ✅: Signature-verified wallet, ownership checks on all resources, role-based admin
- ⚠️: Signature verification but some read endpoints leak data across users
- ❌: IDOR vulnerabilities, no ownership verification, wallet address from body without signature
