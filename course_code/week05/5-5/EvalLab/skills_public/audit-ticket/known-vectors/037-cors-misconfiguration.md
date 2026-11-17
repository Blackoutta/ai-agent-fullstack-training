---
id: 37
title: "CORS Misconfiguration"
severity: 7
category: backend
---

### 37 — CORS Misconfiguration
**Severity: 7** | **Real: Numerous data breaches via cross-origin cookie theft**

`Access-Control-Allow-Origin: *` with credentials — any website can make authenticated requests to your API.

#### Verification Procedure

**Step 1: Find CORS configuration**
```
grep -rn --include="*.ts" -iE "cors\(|Access-Control|origin:" apps/backend/
```
- Record: The CORS configuration

**Step 2: Check origin configuration**
```
grep -rn --include="*.ts" -A10 "cors(" apps/backend/src/
```
- ✅ PASS: Origin is an explicit whitelist: `origin: ['https://yourdomain.com', 'https://www.yourdomain.com']`
- ⚠️ PARTIAL: Origin is a function that validates against a list
- ❌ FAIL: `origin: '*'` or `origin: true` (reflects any origin)

**Step 3: Check for credentials + wildcard combination**
```
grep -rn --include="*.ts" -A5 "cors" apps/backend/src/ | grep -iE "credentials.*true"
```
- ✅ PASS: If credentials: true, origin is NOT `*` (explicit whitelist)
- ❌ FAIL: `credentials: true` with `origin: '*'` or `origin: true` (any origin can send cookies)

**Step 4: Check for regex origin matching (dangerous)**
```
grep -rn --include="*.ts" "new RegExp\|\.test(" apps/backend/src/ | grep -i "origin"
```
- ✅ PASS: No regex origin matching, or regex is strict (e.g., `/^https:\/\/.*\.yourdomain\.com$/`)
- ❌ FAIL: Loose regex like `/yourdomain/` that matches `evil-yourdomain.com`

**Step 5: Check all environments**
```
grep -rn --include="*.ts" "NODE_ENV\|production\|development" apps/backend/src/ | grep -i "cors\|origin"
```
- ✅ PASS: CORS is strict in ALL environments including development
- ❌ FAIL: Development mode uses `origin: '*'` and production flag could be misconfigured

**Overall verdict:**
- ✅: Explicit origin whitelist, credentials only with specific origins, strict in all envs
- ⚠️: Whitelist but development mode is permissive
- ❌: Wildcard origin with credentials, or origin reflects user input
