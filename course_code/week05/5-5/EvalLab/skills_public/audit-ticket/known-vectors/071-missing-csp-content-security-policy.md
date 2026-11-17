---
id: 71
title: "Missing CSP (Content Security Policy)"
severity: 6
category: frontend
---

### 71 — Missing CSP (Content Security Policy)
**Severity: 6** | **Real: Enables all XSS variants to execute**

No Content-Security-Policy header — any injected script runs without restriction.

#### Verification Procedure

**Step 1: Check for CSP header**
```
grep -rn --include="*.ts" --include="*.js" "Content-Security-Policy" apps/backend/ apps/web/next.config*
```
- If found: proceed to check directives
- If not found: ❌ FAIL (no CSP at all)

**Step 2: Check CSP directives**
```
# Key directives to verify:
# script-src: should NOT include 'unsafe-inline' or 'unsafe-eval'
# default-src: should be 'self' or stricter
# img-src: should not be '*'
# connect-src: should whitelist only necessary API domains
grep -rn --include="*.ts" -A5 "Content-Security-Policy" apps/
```
- ✅ PASS: CSP with `script-src 'self'` (no unsafe-inline/eval), strict default-src
- ⚠️ PARTIAL: CSP exists but with `unsafe-inline` (needed for some CSS-in-JS)
- ❌ FAIL: No CSP, or CSP with both `unsafe-inline` and `unsafe-eval`

**Step 3: Check for report-uri / report-to**
```
grep -rn --include="*.ts" "report-uri\|report-to" apps/
```
- ✅ PASS: CSP violations are reported to a monitoring endpoint
- ⚠️ PARTIAL: CSP exists but no violation reporting

**Step 4: Check for CSP in meta tag vs header**
```
grep -rn --include="*.tsx" "meta.*Content-Security-Policy" apps/web/
```
- ✅ PASS: CSP set via HTTP header (not meta tag — meta can be bypassed in some cases)
- ⚠️ PARTIAL: CSP in meta tag (better than nothing)

**Overall verdict:**
- ✅: CSP via HTTP header, no unsafe-inline/eval, violation reporting
- ⚠️: CSP exists with some unsafe directives (common for SSR frameworks)
- ❌: No CSP at all
