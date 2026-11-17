---
id: 85
title: "Server-Side Request Forgery (SSRF)"
severity: 8
category: devops
---

### 85 — Server-Side Request Forgery (SSRF)
**Severity: 8** | **Real: Capital One breach (2019, $80M+ fine), SSRF to cloud metadata**

Server fetches user-provided URL → attacker provides `http://169.254.169.254/latest/meta-data/` → reads cloud instance credentials.

#### Verification Procedure

**Step 1: Find all server-side URL fetching**
```
grep -rn --include="*.ts" -iE "fetch\(|axios\.\|http\.get\|https\.get\|request\(" apps/backend/ | grep -v node_modules
```
- Record: Every place the backend makes HTTP requests

**Step 2: Check if any fetch URL is user-controlled**
```
grep -rn --include="*.ts" -B3 "fetch\(|axios\." apps/backend/ | grep -iE "req\.\|body\.\|query\.\|params\."
```
- ✅ PASS: All fetch URLs are hardcoded or from trusted configuration
- ❌ FAIL: User input used as fetch URL or URL component

**Step 3: If user-controlled, check for URL validation**
```
# Verify: is the URL validated against an allowlist?
grep -rn --include="*.ts" -iE "allowedDomains|allowed.*url|whitelist.*url|url.*valid" apps/backend/
```
- ✅ PASS: URL validated against strict allowlist (domain + protocol)
- ❌ FAIL: No URL validation — attacker can point to internal services or cloud metadata

**Step 4: Check for internal IP blocking**
```
grep -rn --include="*.ts" -iE "127\.0\.0\|localhost|169\.254\|10\.\|192\.168\|0\.0\.0\.0|::1|internal" apps/backend/ | grep -iE "block\|deny\|reject\|forbidden"
```
- ✅ PASS: Internal/private IPs explicitly blocked in URL validation
- ❌ FAIL: No check for internal IPs (allows access to cloud metadata, internal services)

**Step 5: Check for DNS rebinding protection**
```
# Some SSRF checks validate hostname first but don't prevent DNS rebinding
# (attacker's domain resolves to external IP first, then to 169.254.169.254)
# Verify: is the resolved IP checked, not just the hostname?
```
- ✅ PASS: IP address validated after DNS resolution (resolves domain, checks IP is public)
- ⚠️ PARTIAL: Only hostname checked (vulnerable to DNS rebinding)
- ❌ FAIL: No IP validation at all

**Overall verdict:**
- ✅: All fetch URLs hardcoded/allowlisted, internal IPs blocked, DNS rebinding protected
- ⚠️: URLs from trusted config but no explicit internal IP blocking
- ❌: User-controlled fetch URLs without validation
