---
id: 70
title: "Open Redirect"
severity: 5
category: frontend
---

### 70 — Open Redirect
**Severity: 5** | **Real: Phishing via trusted domain redirect**

`/redirect?url=evil.com` — attacker uses your trusted domain to redirect to phishing page.

#### Verification Procedure

**Step 1: Find all redirect endpoints**
```
grep -rn --include="*.ts" -iE "redirect\(|res\.redirect|location.*=.*req|302|301" apps/backend/
```
- Record: All redirect operations

**Step 2: Check for user-controlled redirect URL**
```
# For each redirect: does the destination URL come from user input?
grep -rn --include="*.ts" -B3 "redirect" apps/backend/ | grep "req\.\|body\.\|query\.\|params\."
```
- ✅ PASS: All redirects to hardcoded URLs or server-controlled destinations
- ❌ FAIL: User-controlled redirect URL without validation

**Step 3: If user-controlled, check allowlist**
```
grep -rn --include="*.ts" -iE "allowed.*url|valid.*redirect|whitelist.*redirect" apps/backend/
```
- ✅ PASS: Redirect URL validated against allowlist of permitted domains/paths
- ❌ FAIL: No validation — user can redirect to any URL

**Step 4: Check for relative URL enforcement**
```
# Redirect should only accept relative paths (e.g., /dashboard), not full URLs
grep -rn --include="*.ts" -A5 "redirect" apps/backend/ | grep -iE "startsWith.*\/|relative|hostname"
```
- ✅ PASS: Only relative paths accepted, or URL hostname validated
- ❌ FAIL: Full URLs accepted including external domains

**Step 5: Check frontend redirects**
```
grep -rn --include="*.tsx" "window\.location\|router\.push\|router\.replace" apps/web/ | grep "req\.\|params\.\|search"
```
- ✅ PASS: No user-controlled frontend redirects, or validated
- ❌ FAIL: `window.location = searchParams.get('redirect')` without validation

**Overall verdict:**
- ✅: All redirects hardcoded or allowlisted, no user-controlled destinations
- ⚠️: User-controlled but relative-only enforcement
- ❌: User-controlled redirect without validation
