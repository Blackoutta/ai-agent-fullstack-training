---
id: 82
title: "Exposed Admin / Debug Endpoints in Production"
severity: 8
category: devops
---

### 82 — Exposed Admin / Debug Endpoints in Production
**Severity: 8** | **Real: Exposed Spring Boot Actuator, Django admin, Express status pages**

Debug routes like `/debug`, `/admin`, `/graphql-playground`, or `/swagger` left active in production.

#### Verification Procedure

**Step 1: Search for debug/admin routes**
```
grep -rn --include="*.ts" -iE "\/debug|\/admin|\/test|\/swagger|\/graphql.*playground|\/status|\/healthz|\/metrics|\/pprof" apps/backend/src/
```
- Record: All potentially sensitive routes

**Step 2: Check if routes are environment-gated**
```
grep -rn --include="*.ts" -B5 "\/debug\|\/admin\|\/test\|\/swagger" apps/backend/ | grep -iE "NODE_ENV\|isDev\|isProduction"
```
- ✅ PASS: Debug routes only registered when `NODE_ENV !== 'production'`
- ❌ FAIL: Debug routes always registered regardless of environment

**Step 3: Check for auth on admin routes**
```
grep -rn --include="*.ts" -B3 "\/admin" apps/backend/ | grep -iE "auth\|verify\|middleware\|admin.*only"
```
- ✅ PASS: Admin routes have authentication middleware
- ❌ FAIL: Admin routes accessible without authentication

**Step 4: Check for environment files**
```
grep -rn "NODE_ENV" apps/backend/src/ | head -5
# Adapt filenames to your deploy platform (render.yaml, fly.toml, docker-compose.yml, etc.)
grep "NODE_ENV" <your-deploy-config>.yaml 2>/dev/null
```
- ✅ PASS: NODE_ENV set to "production" in deployment config
- ❌ FAIL: NODE_ENV not set (defaults to development in many frameworks)

**Overall verdict:**
- ✅: Debug routes gated by environment, admin routes authed, production NODE_ENV
- ⚠️: Debug routes exist but disabled in prod
- ❌: Debug/admin endpoints accessible in production without auth
