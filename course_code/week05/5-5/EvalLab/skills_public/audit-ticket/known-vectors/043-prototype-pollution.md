---
id: 43
title: "Prototype Pollution"
severity: 7
category: backend
---

### 43 — Prototype Pollution
**Severity: 7** | **Real: Express.js qs, lodash merge vulnerabilities**

User input `{ "__proto__": { "isAdmin": true } }` pollutes Object.prototype — affects ALL objects in the runtime.

#### Verification Procedure

**Step 1: Find deep merge/extend operations**
```
grep -rn --include="*.ts" -iE "merge\(|assign\(|extend\(|deepMerge|_.merge|lodash.*merge" apps/backend/
```
- Record: All merge operations

**Step 2: Check if merge uses user input**
```
# For each merge: does the source include req.body or user-controlled data?
```
- ✅ PASS: No merge with user-controlled data, or using Object.assign({}, ...) with pre-validated data
- ❌ FAIL: Deep merge with raw req.body

**Step 3: Check for __proto__ filtering**
```
grep -rn --include="*.ts" "__proto__\|constructor\.prototype\|Object\.create\(null\)" apps/backend/
```
- ✅ PASS: Input sanitized to strip `__proto__`, `constructor`, `prototype` keys, OR Object.create(null) used for lookups
- ❌ FAIL: No __proto__ protection

**Step 4: Check JSON body parser configuration**
```
grep -rn --include="*.ts" -A5 "express.json\|bodyParser.json" apps/backend/src/
```
- ✅ PASS: Using modern Express (4.17.3+) which rejects `__proto__` in JSON by default
- ❌ FAIL: Old Express version or custom JSON parser

**Step 5: Check for qs module (query string) prototype pollution**
```
grep -rn --include="*.ts" "qs\.\|querystring" apps/backend/ | head -10
```
- ✅ PASS: Using default Express query parser with depth limit, or qs with `allowPrototypes: false`
- ❌ FAIL: Custom qs configuration with `allowPrototypes: true`

**Overall verdict:**
- ✅: No deep merge with user input, modern Express, __proto__ filtered
- ⚠️: Some merge operations but with pre-validated data
- ❌: Deep merge with raw user input or old Express version
