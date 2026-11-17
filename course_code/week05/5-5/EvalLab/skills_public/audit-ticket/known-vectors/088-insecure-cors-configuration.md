---
id: 88
title: "Insecure CORS Configuration"
severity: 7
category: devops
---

### 88 — Insecure CORS Configuration
**Severity: 7** | **Real: API data theft via cross-origin requests**

`Access-Control-Allow-Origin: *` on API → any website can make authenticated requests to your API.

#### Verification Procedure

**Step 1: Find CORS configuration**
```
grep -rn --include="*.ts" -iE "cors|access-control-allow" apps/backend/ | head -10
```
- If no CORS: check if it's an SPA with same-origin API (may not need CORS)
- If CORS: proceed

**Step 2: Check for wildcard origin**
```
grep -rn --include="*.ts" "origin.*\*\|origin.*true\|cors()" apps/backend/ | head -5
```
- ✅ PASS: Origin is a specific allowlist of domains
- ⚠️ PARTIAL: `origin: true` (mirrors requesting origin — equivalent to wildcard with credentials)
- ❌ FAIL: `origin: '*'` or `origin: true` with credentials

**Step 3: Check credentials handling**
```
grep -rn --include="*.ts" "credentials.*true\|withCredentials" apps/backend/ | head -5
```
- ✅ PASS: Credentials only allowed with specific origins (not wildcard)
- ❌ FAIL: `credentials: true` with wildcard or dynamic origin

**Step 4: Check allowed methods**
```
grep -rn --include="*.ts" "methods\|allowedHeaders" apps/backend/ | head -5
```
- ✅ PASS: Only necessary methods allowed (GET, POST — not DELETE, PUT unless needed)
- ⚠️ PARTIAL: All methods allowed

**Step 5: Verify origin list**
```
grep -rn --include="*.ts" -A10 "origin\b" apps/backend/ | grep -E "https?://" | head -10
```
- ✅ PASS: Only production domains in allowlist (https://*.yourdomain.com)
- ⚠️ PARTIAL: localhost in allowlist in production (acceptable for dev, not for prod)
- ❌ FAIL: Third-party or unknown domains in allowlist

**Overall verdict:**
- ✅: Specific origin allowlist, credentials only with known origins, minimal methods
- ⚠️: Origin list includes localhost (dev convenience), or `origin: true`
- ❌: `origin: '*'` or `origin: true` with `credentials: true`
