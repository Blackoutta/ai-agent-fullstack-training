---
id: 59
title: "Clickjacking"
severity: 6
category: frontend
---

### 59 — Clickjacking
**Severity: 6** | **Real: Facebook likejacking, one-click fund transfers**

Page loaded in invisible iframe on attacker's site — user clicks their button but actually clicks yours.

#### Verification Procedure

**Step 1: Check for X-Frame-Options header**
```
grep -rn --include="*.ts" -iE "X-Frame-Options|frame-options" apps/backend/
```
- ✅ PASS: `X-Frame-Options: DENY` or `SAMEORIGIN` set
- ❌ FAIL: No X-Frame-Options header

**Step 2: Check for CSP frame-ancestors**
```
grep -rn --include="*.ts" "frame-ancestors" apps/backend/
```
- ✅ PASS: `Content-Security-Policy: frame-ancestors 'none'` or `'self'`
- ❌ FAIL: No frame-ancestors directive

**Step 3: Check Next.js security headers**
```
grep -rn --include="*.ts" --include="*.js" -iE "headers|securityHeaders|frame" apps/web/next.config*
```
- ✅ PASS: Next.js config sets X-Frame-Options and frame-ancestors
- ❌ FAIL: No security headers in Next.js config

**Step 4: Check for JavaScript frame-busting (defense in depth)**
```
grep -rn --include="*.tsx" -iE "self.*top\|top.*self\|frameElement\|window\.top" apps/web/src/
```
- ✅ PASS: JavaScript frame-busting as additional layer (not relied upon alone)
- ⚠️ PARTIAL: Only JS frame-busting (bypassable without HTTP headers)

**Overall verdict:**
- ✅: X-Frame-Options + CSP frame-ancestors + JS frame-busting
- ⚠️: Headers set in backend but not in Next.js config
- ❌: No frame protection at all
