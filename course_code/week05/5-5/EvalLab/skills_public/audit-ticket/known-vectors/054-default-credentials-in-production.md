---
id: 54
title: "Default Credentials in Production"
severity: 8
category: backend
---

### 54 — Default Credentials in Production
**Severity: 8** | **Real: Mirai botnet ($100M+), exposed databases**

Database, admin panel, or monitoring tool uses default credentials — `admin:admin` or `root:password`.

#### Verification Procedure

**Step 1: Check for hardcoded credentials**
```
grep -rn --include="*.ts" --include="*.yml" --include="*.yaml" --include="*.toml" -iE "password.*=.*['\"]|user.*admin|default.*password" . | grep -v node_modules | grep -v ".md"
```
- ✅ PASS: Zero hardcoded credentials
- ❌ FAIL: Any hardcoded credentials in config or code

**Step 2: Check docker-compose for default passwords**
```
grep -rn --include="*.yml" -iE "password|MONGO_.*=|POSTGRES_.*=" docker-compose* 2>/dev/null
```
- ✅ PASS: No default passwords, or passwords from env vars
- ❌ FAIL: Hardcoded `password: admin123` in docker-compose

**Step 3: Check for development backdoors**
```
grep -rn --include="*.ts" -iE "if.*dev\|bypass.*auth\|skip.*auth\|test.*mode" apps/backend/src/routes/
```
- ✅ PASS: No auth bypass backdoors
- ❌ FAIL: Development auth bypass that could be triggered in production

**Step 4: Check hosting platform credentials**
```
grep -rn "render.yaml\|vercel.json\|fly.toml" . | head -5
cat render.yaml 2>/dev/null | grep -i "env\|secret" | head -10
```
- ✅ PASS: Deployment configs reference env vars, not hardcoded secrets
- ❌ FAIL: Secrets in deployment config files

**Overall verdict:**
- ✅: No hardcoded credentials anywhere, all from env vars
- ⚠️: Dev defaults exist but gated behind NODE_ENV check
- ❌: Hardcoded credentials or auth bypass backdoors
