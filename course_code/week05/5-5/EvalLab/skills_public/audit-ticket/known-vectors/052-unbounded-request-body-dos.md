---
id: 52
title: "Unbounded Request Body DoS"
severity: 6
category: backend
---

### 52 — Unbounded Request Body DoS
**Severity: 6** | **Real: Node.js OOM crashes, denial of service**

No body size limit — attacker sends 1GB JSON, crashes server with out-of-memory.

#### Verification Procedure

**Step 1: Find body parser configuration**
```
grep -rn --include="*.ts" -iE "express\.json|bodyParser\.json|urlencoded|express\.raw" apps/backend/src/
```
- Record: Body parser configuration

**Step 2: Check for size limit**
```
grep -rn --include="*.ts" -A5 "express\.json\|bodyParser\.json" apps/backend/src/ | grep -i "limit"
```
- ✅ PASS: `express.json({ limit: '1mb' })` or similar reasonable limit
- ❌ FAIL: No limit option (default is 100KB in Express, but may be overridden)

**Step 3: Check file upload limits**
```
grep -rn --include="*.ts" -iE "multer|formidable|upload|busboy" apps/backend/
```
- ✅ PASS: File upload limits configured (e.g., `limits: { fileSize: 5 * 1024 * 1024 }`)
- ❌ FAIL: File uploads without size limits

**Step 4: Verify per-route body limits for sensitive endpoints**
```
# Swap/trade endpoints should have tighter limits than file upload endpoints
grep -rn --include="*.ts" "limit" apps/backend/src/routes/ | head -10
```
- ✅ PASS: Per-route limits or global limit is reasonable for all use cases
- ⚠️ PARTIAL: Global limit exists but no per-route differentiation

**Overall verdict:**
- ✅: JSON body limit + file upload limits configured
- ⚠️: Express default 100KB applies (acceptable but not explicit)
- ❌: No limits or limits very high (>100MB)
