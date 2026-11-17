---
id: 36
title: "SSRF (Server-Side Request Forgery)"
severity: 8
category: backend
---

### 36 — SSRF (Server-Side Request Forgery)
**Severity: 8** | **Real: Capital One ($80M fine, 2019), metadata service attacks**

Server fetches a URL provided by user — attacker fetches `http://169.254.169.254/latest/meta-data/iam/` (cloud metadata) or internal services.

#### Verification Procedure

**Step 1: Find all outbound HTTP requests**
```
grep -rn --include="*.ts" -E "fetch\(|axios\(|axios\.get\(|axios\.post\(|http\.get\(|got\(|request\(" apps/backend/
```
- Record: Every outbound request with what URL it uses

**Step 2: Check if URL comes from user input**
```
# For each fetch/axios call: trace the URL parameter
# Is it hardcoded, or does it include req.body/req.query values?
```
- ✅ PASS: All URLs are hardcoded or constructed from validated internal data (not user input)
- ❌ FAIL: Any URL derived from user input without validation

**Step 3: If user-controlled URLs exist, check allowlist**
```
grep -rn --include="*.ts" -iE "allowlist|whitelist|allowed.*url|valid.*host|blocked.*host|deny.*host" apps/backend/
```
- ✅ PASS: URL validation against allowlist of permitted domains
- ❌ FAIL: No URL validation — user can specify any URL

**Step 4: Check for internal IP blocking**
```
grep -rn --include="*.ts" -iE "127\.0\.0|localhost|169\.254|10\.\|172\.16|192\.168|::1|0\.0\.0" apps/backend/
```
- ✅ PASS: Internal IPs (127.0.0.1, 169.254.x.x, 10.x.x.x, 192.168.x.x) are blocked
- ❌ FAIL: No blocking of internal addresses

**Step 5: Check for redirect following**
```
grep -rn --include="*.ts" -iE "redirect.*follow|maxRedirects|followRedirects" apps/backend/
```
- ✅ PASS: Redirects are disabled or limited on external fetches
- ⚠️ PARTIAL: Redirects allowed but only to non-internal hosts
- ❌ FAIL: Unlimited redirects that could bounce to internal hosts

**Overall verdict:**
- ✅: All URLs hardcoded or allowlisted, internal IPs blocked, redirects limited
- ⚠️: Most URLs hardcoded, 1-2 user-influenced with partial validation
- ❌: User-controlled URLs without allowlist or internal IP blocking
