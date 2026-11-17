---
id: 50
title: "Session Fixation"
severity: 7
category: backend
---

### 50 — Session Fixation
**Severity: 7** | **Real: Session-based auth hijacking**

Attacker sets a known session ID → user logs in with that session → attacker uses the pre-set session.

#### Verification Procedure

**Step 1: Check for session usage**
```
grep -rn --include="*.ts" -iE "express-session|session\(|cookie-session|connect.sid" apps/backend/
```
- If no sessions: N/A (token-based auth like JWT is not vulnerable)
- If sessions: proceed

**Step 2: Check for session regeneration on authentication**
```
grep -rn --include="*.ts" "req.session.regenerate\|regenerate(" apps/backend/
```
- ✅ PASS: Session regenerated on login/authentication
- ❌ FAIL: Session ID unchanged after authentication (fixation possible)

**Step 3: Check session cookie attributes**
```
grep -rn --include="*.ts" -A10 "session(" apps/backend/ | grep -iE "httpOnly|secure|sameSite"
```
- ✅ PASS: `httpOnly: true`, `secure: true`, `sameSite: 'strict'` or `'lax'`
- ❌ FAIL: Missing any of these cookie security attributes

**Overall verdict:**
- ✅: Session regenerated on auth, secure cookie attributes
- ⚠️: Cookie attributes correct but no explicit regeneration
- ❌: No session regeneration and weak cookie attributes
- N/A: Token-based auth (no sessions)
