---
id: 61
title: "Sensitive Data in URL Parameters"
severity: 5
category: frontend
---

### 61 — Sensitive Data in URL Parameters
**Severity: 5** | **Real: Leaks via Referrer header, browser history, server logs**

Token, secret, or PII in URL query string — visible in browser history, server access logs, Referrer header to third parties.

#### Verification Procedure

**Step 1: Check for secrets in URLs**
```
grep -rn --include="*.ts" --include="*.tsx" -iE "token=|secret=|key=|password=|apiKey=" apps/web/ | grep -v node_modules
```
- ✅ PASS: No secrets in URL parameters
- ❌ FAIL: Tokens or secrets passed as URL query parameters

**Step 2: Check for API keys in fetch URLs**
```
grep -rn --include="*.ts" --include="*.tsx" -E "fetch\(.*\?" apps/web/ | grep -iE "key|token|secret"
```
- ✅ PASS: API keys in headers (not URL params)
- ❌ FAIL: API keys in URL query parameters (visible in server logs)

**Step 3: Check Referrer-Policy header**
```
grep -rn --include="*.ts" --include="*.js" -iE "Referrer-Policy|referrerPolicy" apps/
```
- ✅ PASS: `Referrer-Policy: strict-origin-when-cross-origin` or stricter
- ⚠️ PARTIAL: No referrer policy set (browser default varies)

**Step 4: Check for PII in navigation URLs**
```
grep -rn --include="*.tsx" "router\.push\|router\.replace\|Link href" apps/web/ | grep -iE "email|wallet|address|name"
```
- ✅ PASS: PII not in URLs, or wallet public key only (which is public by nature)
- ❌ FAIL: Private data (email, phone, private keys) in URL params

**Overall verdict:**
- ✅: No secrets in URLs, referrer policy set, PII not in navigation
- ⚠️: Public key in URL (acceptable) but missing referrer policy
- ❌: Tokens or credentials in URL parameters
