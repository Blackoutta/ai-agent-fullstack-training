---
id: 95
title: "Insecure Randomness"
severity: 7
category: devops
---

### 95 — Insecure Randomness
**Severity: 7** | **Real: Predictable tokens, session IDs, or nonces**

`Math.random()` for security-sensitive values — it's not cryptographically secure, attacker can predict output.

#### Verification Procedure

**Step 1: Find all randomness generation**
```
grep -rn --include="*.ts" "Math\.random\|Math\.floor.*Math\.random" apps/backend/ | head -10
```
- Record: Where is Math.random used?

**Step 2: Classify usage**
```
# For each Math.random usage:
# SAFE: UI animations, jitter, non-security purposes
# UNSAFE: Session tokens, nonces, CSRF tokens, passwords, IDs used for auth
grep -rn --include="*.ts" -B3 "Math\.random" apps/backend/ | grep -iE "token|nonce|session|secret|id|key|random.*string" | head -5
```
- ✅ PASS: Math.random not used for any security purpose
- ❌ FAIL: Math.random used for tokens, nonces, or security-sensitive values

**Step 3: Check for crypto.randomBytes / crypto.getRandomValues**
```
grep -rn --include="*.ts" "crypto\.randomBytes\|crypto\.getRandomValues\|randomUUID\|crypto\.random" apps/ | head -10
```
- ✅ PASS: Security-sensitive randomness uses `crypto.randomBytes()` or `crypto.getRandomValues()`
- ❌ FAIL: No use of cryptographic randomness (Math.random for everything)

**Step 4: Check frontend nonce/state generation**
```
grep -rn --include="*.tsx" --include="*.ts" "Math\.random" apps/web/src/ | head -5
```
- ✅ PASS: No Math.random for security-sensitive values in frontend
- ⚠️ PARTIAL: Math.random for UI purposes only (acceptable)

**Overall verdict:**
- ✅: crypto.randomBytes for all security values, Math.random only for non-sensitive
- ⚠️: No security-sensitive randomness needed (wallet-based auth)
- ❌: Math.random used for tokens, nonces, or session IDs
