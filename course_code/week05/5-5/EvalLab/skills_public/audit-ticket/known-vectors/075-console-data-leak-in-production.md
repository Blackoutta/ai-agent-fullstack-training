---
id: 75
title: "Console Data Leak in Production"
severity: 4
category: frontend
---

### 75 — Console Data Leak in Production
**Severity: 4** | **Real: Internal data exposed in browser DevTools**

`console.log(userData)`, `console.log(apiResponse)` in production — visible to anyone who opens browser DevTools.

#### Verification Procedure

**Step 1: Count console statements in production code**
```
grep -rn --include="*.tsx" --include="*.ts" "console\.\(log\|warn\|debug\|info\)" apps/web/src/ | grep -v node_modules | wc -l
```
- Record: Total count

**Step 2: Check for sensitive data in console statements**
```
grep -rn --include="*.tsx" --include="*.ts" "console\." apps/web/src/ | grep -iE "token|key|secret|password|wallet|balance|user"
```
- ✅ PASS: Zero results — no sensitive data in console statements
- ❌ FAIL: Console statements logging tokens, keys, or user data

**Step 3: Check for console stripping in build**
```
grep -rn --include="*.js" --include="*.ts" -iE "drop_console|removeConsole|terser.*console" apps/web/next.config* apps/web/package.json
```
- ✅ PASS: Build config strips console.log in production
- ⚠️ PARTIAL: No console stripping but console statements are minimal/non-sensitive

**Step 4: Check for error boundary logging**
```
grep -rn --include="*.tsx" "console.error\|componentDidCatch\|ErrorBoundary" apps/web/src/
```
- ✅ PASS: Error boundaries log to monitoring service, not console
- ⚠️ PARTIAL: console.error for errors (acceptable but not ideal)

**Overall verdict:**
- ✅: Console stripped in build, or no sensitive data logged, monitoring service used
- ⚠️: Some console.log but no sensitive data
- ❌: Sensitive data in console statements in production

---

## DevOps / Supply Chain Hacks (76-100)
