---
id: 51
title: "Account Enumeration"
severity: 5
category: backend
---

### 51 — Account Enumeration
**Severity: 5** | **Real: Credential stuffing enabled, OSINT**

Login says "user not found" vs "wrong password" — attacker knows which accounts exist.

#### Verification Procedure

**Step 1: Find authentication endpoints**
```
grep -rn --include="*.ts" -iE "login|register|signup|auth|forgot.*password|reset.*password" apps/backend/src/routes/
```
- Record: All auth-related endpoints

**Step 2: Check error messages for differential responses**
```
grep -rn --include="*.ts" -A5 "401\|403\|Unauthorized\|not found\|invalid" apps/backend/src/routes/ | grep -iE "user\|account\|email\|password"
```
- ✅ PASS: Same error message for all auth failures (e.g., "Invalid credentials")
- ❌ FAIL: Different messages for "user not found" vs "wrong password"

**Step 3: Check response timing**
```
# Both "user not found" and "wrong password" should take approximately same time
# If using bcrypt: hash a dummy password when user not found to equalize timing
grep -rn --include="*.ts" "bcrypt\|compare\|hash" apps/backend/src/ | grep -i "login\|auth"
```
- ✅ PASS: Dummy hash comparison when user not found (constant-time response)
- ⚠️ PARTIAL: Same message but timing differs (early return for missing user)

**Step 4: Check registration endpoint**
```
grep -rn --include="*.ts" -A10 "register\|signup" apps/backend/src/routes/ | grep -iE "exists\|already\|taken"
```
- ✅ PASS: Registration doesn't reveal if email/username exists (e.g., "Check your email for a link")
- ❌ FAIL: "This email is already registered" (confirms existence)

**Overall verdict:**
- ✅: Generic error messages, constant-time responses, no existence leakage
- ⚠️: Same messages but timing differences
- ❌: Different error messages revealing account existence
