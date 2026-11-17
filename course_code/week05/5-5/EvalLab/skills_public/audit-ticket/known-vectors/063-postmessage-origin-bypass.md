---
id: 63
title: "PostMessage Origin Bypass"
severity: 6
category: frontend
---

### 63 — PostMessage Origin Bypass
**Severity: 6** | **Real: Cross-origin data theft from iframes, wallet adapter exploits**

`addEventListener('message', handler)` without checking `event.origin` — attacker's page sends fake messages.

#### Verification Procedure

**Step 1: Find postMessage listeners**
```
grep -rn --include="*.tsx" --include="*.ts" "addEventListener.*message\|onmessage" apps/web/
```
- If none: N/A
- If found: proceed

**Step 2: Check for origin validation in handler**
```
grep -rn --include="*.tsx" --include="*.ts" -A10 "addEventListener.*message" apps/web/ | grep "origin"
```
- ✅ PASS: Handler checks `event.origin === 'https://expected-domain.com'` before processing
- ❌ FAIL: Handler processes message without origin check

**Step 3: Check for postMessage sends**
```
grep -rn --include="*.tsx" --include="*.ts" "postMessage(" apps/web/
```
- ✅ PASS: `postMessage(data, 'https://specific-origin.com')` — targeted origin
- ❌ FAIL: `postMessage(data, '*')` — broadcasts to any listener

**Step 4: Check data validation in handler**
```
# Even with origin check: is the message data validated/typed?
grep -rn --include="*.tsx" -A15 "addEventListener.*message" apps/web/ | grep -iE "type\|schema\|typeof\|z\."
```
- ✅ PASS: Message data is validated (type check, schema) before use
- ❌ FAIL: Message data used directly without validation

**Overall verdict:**
- ✅: Origin checked on receive, specific origin on send, data validated
- ⚠️: Origin checked but data not validated
- ❌: No origin check on message handlers
- N/A: No postMessage usage
