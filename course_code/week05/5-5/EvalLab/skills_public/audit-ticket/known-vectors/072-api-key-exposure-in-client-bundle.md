---
id: 72
title: "API Key Exposure in Client Bundle"
severity: 7
category: frontend
---

### 72 — API Key Exposure in Client Bundle
**Severity: 7** | **Real: Exposed Firebase/Stripe/AWS keys in SPAs**

API key baked into client-side JS bundle — anyone extract it from browser DevTools or bundle analysis.

#### Verification Procedure

**Step 1: List all NEXT_PUBLIC_ variables**
```
grep -rn "NEXT_PUBLIC_" apps/web/ --include="*.ts" --include="*.tsx" --include="*.env*" | grep -v node_modules | sort -u
```
- Record: Every NEXT_PUBLIC_ variable and what it contains

**Step 2: Classify each as public vs secret**
```
# For each NEXT_PUBLIC_ var:
# PUBLIC (OK): Program ID, RPC URL without key, network name, app URL
# SECRET (BAD): API secret key, private key, database URL, internal service URL with token
```
- ✅ PASS: All NEXT_PUBLIC_ vars are truly public (no secrets)
- ❌ FAIL: Any NEXT_PUBLIC_ var is a secret (API key, database URL, private key)

**Step 3: Check for non-NEXT_PUBLIC vars in client code**
```
grep -rn --include="*.tsx" --include="*.ts" "process\.env\." apps/web/src/ | grep -v "NEXT_PUBLIC_" | grep -v node_modules
```
- ✅ PASS: All non-NEXT_PUBLIC env vars are only in server-side code (API routes, getServerSideProps)
- ❌ FAIL: Non-NEXT_PUBLIC env vars used in client components (will be undefined but intent is wrong)

**Step 4: Check for hardcoded API keys**
```
grep -rn --include="*.ts" --include="*.tsx" -E "(sk_|pk_|api_|key_)[a-zA-Z0-9]{10,}" apps/web/src/
```
- ✅ PASS: No hardcoded API keys in source code
- ❌ FAIL: Hardcoded API keys — exposed in bundle

**Step 5: Build and check the bundle (thorough)**
```
# Build and check what's in the client bundle:
# npx next build && grep -rn "sk_\|api_key\|secret" .next/static/chunks/ | head -20
```
- ✅ PASS: No secrets in built bundle
- ❌ FAIL: Secrets visible in built output

**Overall verdict:**
- ✅: All NEXT_PUBLIC_ are truly public, no hardcoded keys, bundle clean
- ⚠️: One questionable NEXT_PUBLIC var (e.g., RPC URL — public but could be abuse target)
- ❌: Secret API keys in client bundle or NEXT_PUBLIC_ vars
