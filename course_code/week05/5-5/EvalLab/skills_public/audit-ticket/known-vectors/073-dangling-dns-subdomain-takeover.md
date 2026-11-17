---
id: 73
title: "Dangling DNS / Subdomain Takeover"
severity: 7
category: frontend
---

### 73 — Dangling DNS / Subdomain Takeover
**Severity: 7** | **Real: Microsoft, Starbucks, numerous Fortune 500 companies**

DNS CNAME points to deprovisioned service (Heroku, S3, Azure) — attacker claims the subdomain.

#### Verification Procedure

**Step 1: List DNS records**
```
# Check for dangling CNAME records:
dig CNAME api.yourdomain.com +short
dig CNAME staging.yourdomain.com +short
dig CNAME docs.yourdomain.com +short
```
- Record: All CNAME records and their targets

**Step 2: Check if CNAME targets are live**
```
# For each CNAME: does the target service still exist?
curl -s -o /dev/null -w "%{http_code}" https://CNAME_TARGET 2>/dev/null
```
- ✅ PASS: All CNAME targets respond (service is active)
- ❌ FAIL: CNAME target returns service-specific "unclaimed" page or doesn't resolve

**Step 3: Check for vulnerable service patterns**
```
# These services are commonly involved in subdomain takeover:
# - Heroku: *.herokuapp.com → "There is no app configured at that hostname"
# - GitHub Pages: → "There isn't a GitHub Pages site here"
# - S3: → "NoSuchBucket"
# - Azure: *.azurewebsites.net → "Error 404"
# - Shopify: → "Sorry, this shop is currently unavailable"
```
- ✅ PASS: No dangling records pointing to claimable services
- ❌ FAIL: CNAME to deprovisioned service (attacker can claim it)

**Step 4: Check deployment configs for old domains**
```
grep -rn "domain\|CNAME\|subdomain" . --include="*.yaml" --include="*.yml" --include="*.toml" --include="*.json" | grep -v node_modules | head -10
```
- ✅ PASS: Deployment configs match current DNS setup
- ❌ FAIL: Old domains in configs that are no longer active

**Overall verdict:**
- ✅: All DNS records point to active services, no dangling CNAMEs
- ⚠️: Some records to investigate (old staging environments)
- ❌: Dangling CNAME pointing to claimable service
