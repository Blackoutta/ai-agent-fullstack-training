---
id: 96
title: "Missing Security Headers"
severity: 5
category: devops
---

### 96 — Missing Security Headers
**Severity: 5** | **Real: Various attacks enabled by missing headers**

Missing headers like X-Content-Type-Options, X-XSS-Protection, Permissions-Policy — multiple attack vectors enabled.

#### Verification Procedure

**Step 1: Check for helmet or security headers middleware**
```
grep -rn --include="*.ts" -iE "helmet|securityHeaders|security.*headers" apps/backend/ apps/web/next.config* | head -5
```
- ✅ PASS: Helmet.js or equivalent security headers middleware in use
- ❌ FAIL: No security headers middleware

**Step 2: Verify specific headers**
```
# Must have:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY (or SAMEORIGIN)
# Referrer-Policy: strict-origin-when-cross-origin
# Content-Security-Policy: ...
# Permissions-Policy: camera=(), microphone=(), geolocation=()
grep -rn --include="*.ts" -iE "nosniff|X-Content-Type\|X-Frame-Options\|Referrer-Policy\|Permissions-Policy" apps/backend/ apps/web/ | head -10
```
- ✅ PASS: All key security headers configured
- ⚠️ PARTIAL: Some headers set (e.g., helmet defaults)
- ❌ FAIL: No security headers at all

**Step 3: Check Next.js security headers**
```
grep -rn --include="*.js" --include="*.ts" -A20 "headers" apps/web/next.config* | head -30
```
- ✅ PASS: Next.js config includes security headers for all routes
- ❌ FAIL: No custom headers in Next.js config

**Overall verdict:**
- ✅: All major security headers configured via middleware and Next.js config
- ⚠️: Helmet defaults only (covers most but not all)
- ❌: No security headers
