---
id: 64
title: "LocalStorage Token Theft"
severity: 6
category: frontend
---

### 64 — LocalStorage Token Theft
**Severity: 6** | **Real: XSS → token theft chain attack**

Auth tokens in localStorage — any XSS vulnerability instantly steals the token (unlike httpOnly cookies which JS can't read).

#### Verification Procedure

**Step 1: Check what's stored in localStorage/sessionStorage**
```
grep -rn --include="*.ts" --include="*.tsx" "localStorage\.\|sessionStorage\." apps/web/
```
- Record: Everything stored in client-side storage

**Step 2: Check for auth tokens in storage**
```
grep -rn --include="*.ts" --include="*.tsx" -iE "(localStorage|sessionStorage).*(token|jwt|session|auth|key|secret)" apps/web/
```
- ✅ PASS: No auth tokens in localStorage (using httpOnly cookies or wallet-based auth)
- ⚠️ PARTIAL: Refresh token in httpOnly cookie, but access token in localStorage (common pattern)
- ❌ FAIL: Long-lived auth token or JWT in localStorage without XSS protection

**Step 3: If tokens in localStorage, check XSS protection (defense in depth)**
```
# This makes hack #57, #58 more critical
grep -rn --include="*.tsx" "dangerouslySetInnerHTML" apps/web/ | wc -l
```
- ✅ PASS: Zero dangerouslySetInnerHTML and strict CSP (XSS unlikely → localStorage risk acceptable)
- ❌ FAIL: dangerouslySetInnerHTML used AND tokens in localStorage (instant theft via XSS)

**Step 4: Check for Solana wallet auth pattern**
```
grep -rn --include="*.ts" --include="*.tsx" -iE "useWallet|wallet.*sign\|signMessage" apps/web/
```
- ✅ PASS: Authentication via wallet signature (no persistent tokens to steal)
- ⚠️ PARTIAL: Wallet auth but sessions cached in localStorage

**Overall verdict:**
- ✅: No auth tokens in localStorage, or wallet-based auth only
- ⚠️: Short-lived access token in localStorage with good XSS protection
- ❌: Long-lived tokens in localStorage with XSS vulnerabilities present
