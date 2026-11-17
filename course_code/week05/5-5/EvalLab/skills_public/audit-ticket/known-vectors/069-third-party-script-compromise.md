---
id: 69
title: "Third-Party Script Compromise"
severity: 7
category: frontend
---

### 69 — Third-Party Script Compromise
**Severity: 7** | **Real: Magecart ($billions credit card theft), analytics script hijacks**

Analytics/chat/tracking script compromised — silently exfiltrates user data from every page.

#### Verification Procedure

**Step 1: Inventory all third-party scripts**
```
grep -rn --include="*.tsx" --include="*.ts" -iE "gtag|analytics|hotjar|intercom|crisp|mixpanel|segment|amplitude|sentry" apps/web/
```
- Record: Complete list of third-party scripts

**Step 2: Check for script necessity**
- For each third-party script: is it actually needed?
- ✅ PASS: Only essential third-party scripts loaded (analytics, error tracking)
- ⚠️ PARTIAL: Multiple third-party scripts, some questionable necessity

**Step 3: Check for CSP restrict on third-party scripts**
```
grep -rn --include="*.ts" "script-src" apps/ | head -5
```
- ✅ PASS: CSP `script-src` whitelists only known third-party domains
- ❌ FAIL: CSP allows `'unsafe-eval'` or no CSP at all

**Step 4: Check for third-party script sandboxing**
```
grep -rn --include="*.tsx" "sandbox\|allow-scripts\|iframe" apps/web/ | grep -i "third\|analytics\|track"
```
- ✅ PASS: Third-party scripts loaded in sandboxed iframes where possible
- ⚠️ PARTIAL: Scripts loaded directly but from well-known providers

**Step 5: Check for data available to third-party scripts**
```
# Can third-party scripts access wallet data, tokens, or private keys?
grep -rn --include="*.tsx" "window\.\|global\.\|document\.cookie" apps/web/ | grep -v node_modules | head -10
```
- ✅ PASS: Sensitive data not on window/global scope where third-party scripts could read it
- ❌ FAIL: Wallet keys or auth tokens accessible on window object

**Overall verdict:**
- ✅: Minimal third-party scripts, CSP restricted, no sensitive data exposed globally
- ⚠️: Third-party scripts present with adequate CSP
- ❌: Many third-party scripts, no CSP, sensitive data on window
