---
id: 60
title: "OAuth State Forgery (CSRF via OAuth)"
severity: 7
category: frontend
---

### 60 — OAuth State Forgery (CSRF via OAuth)
**Severity: 7** | **Real: OAuth CSRF on social logins, account linking attacks**

Missing `state` parameter in OAuth flow — attacker forces victim to link attacker's social account to their app account.

#### Verification Procedure

**Step 1: Check for OAuth flows**
```
grep -rn --include="*.ts" --include="*.tsx" -iE "oauth|/auth/.*callback|authorize\?|social.*login|google.*login|github.*login" apps/
```
- If no OAuth: N/A
- If OAuth: proceed

**Step 2: Verify state parameter generation**
```
grep -rn --include="*.ts" -iE "state.*crypto\|randomBytes\|crypto\.random\|generateState" apps/
```
- ✅ PASS: Random `state` parameter generated before redirect to OAuth provider
- ❌ FAIL: No state parameter or static/predictable state

**Step 3: Verify state validation on callback**
```
grep -rn --include="*.ts" -A10 "callback\|redirect" apps/ | grep -iE "state.*===\|state.*!==\|verifyState"
```
- ✅ PASS: Callback validates state matches the one sent to provider
- ❌ FAIL: Callback ignores state parameter

**Step 4: Verify PKCE (if using OAuth 2.0)**
```
grep -rn --include="*.ts" -iE "code_verifier|code_challenge|pkce" apps/
```
- ✅ PASS: PKCE used for additional security
- ⚠️ PARTIAL: State parameter only (still secure for CSRF, but PKCE adds auth code protection)

**Overall verdict:**
- ✅: Random state generated, validated on callback, PKCE used
- ⚠️: State validated but no PKCE
- ❌: No state parameter in OAuth flow
- N/A: No OAuth
