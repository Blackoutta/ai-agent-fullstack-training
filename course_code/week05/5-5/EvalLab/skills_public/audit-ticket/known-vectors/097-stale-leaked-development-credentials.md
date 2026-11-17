---
id: 97
title: "Stale / Leaked Development Credentials"
severity: 8
category: devops
---

### 97 — Stale / Leaked Development Credentials
**Severity: 8** | **Real: Development API keys used in production, staging DB credentials leaked**

Dev credentials with production access left in `.env.example`, Notion docs, or Slack channels.

#### Verification Procedure

**Step 1: Check .env.example for real values**
```
cat .env.example 2>/dev/null; cat apps/backend/.env.example 2>/dev/null; cat apps/web/.env.example 2>/dev/null
```
- ✅ PASS: All values are clearly placeholders (e.g., `YOUR_API_KEY_HERE`, `change-me`, empty)
- ❌ FAIL: Real-looking API keys, URLs with credentials, or actual secrets

**Step 2: Check for devnet/testnet credentials used in production**
```
grep -rn --include="*.ts" -iE "devnet|testnet" apps/ | grep -v node_modules | grep -v "// " | head -10
```
- ✅ PASS: Environment-specific RPC URLs and configs selected by NODE_ENV
- ❌ FAIL: Hardcoded devnet URLs that could be accidentally deployed to production

**Step 3: Check for default/weak credentials**
```
grep -rn --include="*.ts" --include="*.json" --include="*.yaml" -iE "password.*123|admin.*admin|root.*root|changeme|default.*key|test.*key" . | grep -v node_modules | head -10
```
- ✅ PASS: No default credentials in any config files
- ❌ FAIL: Default or weak credentials in configuration

**Step 4: Check for credentials in documentation**
```
grep -rn --include="*.md" -iE "sk_\|pk_live\|api_key.*=.*[a-zA-Z0-9]{10}" docs/ README.md | head -5
```
- ✅ PASS: No real credentials in documentation
- ❌ FAIL: Real credentials in markdown files

**Overall verdict:**
- ✅: Placeholder-only in examples, environment-based configs, no default credentials
- ⚠️: Some real-looking but harmless values in examples (e.g., devnet program IDs)
- ❌: Real credentials in examples, docs, or configs
