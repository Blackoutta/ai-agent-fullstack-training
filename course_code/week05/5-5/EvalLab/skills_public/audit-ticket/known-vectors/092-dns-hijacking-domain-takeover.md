---
id: 92
title: "DNS Hijacking / Domain Takeover"
severity: 9
category: devops
---

### 92 — DNS Hijacking / Domain Takeover
**Severity: 9** | **Real: Curve Finance DNS attack ($570K, 2022), PancakeSwap DNS hijack**

Attacker compromises domain registrar or DNS provider — redirects users to phishing site that looks identical.

#### Verification Procedure

**Step 1: Check domain registrar security**
```
# Verify: is the domain registrar account protected with:
# - Strong unique password
# - 2FA (preferably hardware key, not SMS)
# - Domain lock enabled
whois yourdomain.com 2>/dev/null | grep -iE "lock|registrar"
```
- ✅ PASS: Domain locked, registrar has 2FA, auto-renew enabled
- ❌ FAIL: Domain not locked, or no 2FA on registrar account

**Step 2: Check DNS provider security**
```
# If using separate DNS (Cloudflare, Route53, etc.):
# Verify 2FA on DNS provider account
# Check for DNSSEC
dig +dnssec yourdomain.com 2>/dev/null | grep -i "rrsig"
```
- ✅ PASS: DNSSEC enabled, DNS provider account has 2FA
- ⚠️ PARTIAL: 2FA on account but no DNSSEC
- ❌ FAIL: No 2FA, no DNSSEC

**Step 3: Check for certificate transparency monitoring**
```
# Monitor for unauthorized SSL certificates issued for your domain:
# https://crt.sh/?q=yourdomain.com
# Set up CT monitoring alerts
```
- ✅ PASS: CT monitoring alerts configured
- ⚠️ PARTIAL: Manually checked occasionally

**Step 4: Check for deployment verification**
```
# Do deploy processes verify they're deploying to the correct infrastructure?
grep -rn --include="*.yaml" --include="*.yml" "verify\|checksum\|integrity" .github/workflows/ | head -5
```
- ✅ PASS: Deployment verified against expected infrastructure
- ❌ FAIL: No verification — DNS change silently redirects users

**Overall verdict:**
- ✅: Domain locked, DNSSEC, 2FA on registrar/DNS, CT monitoring
- ⚠️: 2FA but no DNSSEC or CT monitoring
- ❌: No domain lock, no 2FA, no DNSSEC — high takeover risk
