---
id: 90
title: "Missing HTTPS / TLS Misconfiguration"
severity: 8
category: devops
---

### 90 — Missing HTTPS / TLS Misconfiguration
**Severity: 8** | **Real: Man-in-the-middle attacks, credential interception**

API served over HTTP, or weak TLS — attacker intercepts traffic on same network.

#### Verification Procedure

**Step 1: Check deployment TLS config**
```
# Adapt filenames to your deploy platform (render.yaml, fly.toml, docker-compose.yml, etc.)
grep -rn --include="*.yaml" --include="*.yml" --include="*.toml" -iE "https|tls|ssl|cert" <your-deploy-config>.yaml 2>/dev/null
```
- ✅ PASS: HTTPS enforced in deployment config
- ❌ FAIL: HTTP allowed in production

**Step 2: Check for HSTS header**
```
grep -rn --include="*.ts" -iE "strict-transport-security|hsts" apps/backend/ apps/web/next.config*
```
- ✅ PASS: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- ❌ FAIL: No HSTS header (user could be downgraded to HTTP)

**Step 3: Check for HTTP redirect**
```
grep -rn --include="*.ts" -iE "redirect.*https\|force.*ssl\|upgrade.*insecure" apps/backend/
```
- ✅ PASS: HTTP requests redirect to HTTPS
- ❌ FAIL: HTTP requests served without redirect

**Step 4: Check for mixed content**
```
grep -rn --include="*.tsx" --include="*.ts" "http://" apps/web/src/ | grep -v "localhost\|127\.0\.0\.1\|//http" | head -10
```
- ✅ PASS: No plain HTTP URLs in production code (all https:// or protocol-relative)
- ❌ FAIL: HTTP URLs in production code (mixed content blocks or warnings)

**Step 5: Check RPC URL protocol**
```
grep -rn "SOLANA_RPC_URL\|rpc.*url\|helius\|mainnet" apps/backend/src/ apps/web/src/ | grep "http://" | head -5
```
- ✅ PASS: RPC URLs use https:// (or wss:// for WebSocket)
- ❌ FAIL: RPC URL using http:// — Solana transactions visible to MITM

**Overall verdict:**
- ✅: HTTPS enforced, HSTS set, HTTP redirects, no mixed content
- ⚠️: HTTPS in production but HSTS not set
- ❌: HTTP allowed in production, or mixed content, or plain HTTP RPC
