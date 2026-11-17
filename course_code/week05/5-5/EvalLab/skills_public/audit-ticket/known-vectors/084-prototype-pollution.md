---
id: 84
title: "Prototype Pollution"
severity: 7
category: devops
---

### 84 — Prototype Pollution
**Severity: 7** | **Real: jQuery, lodash vulnerabilities, denial of service or RCE via `__proto__`**

`Object.assign(defaults, userInput)` where userInput contains `__proto__` — attacker modifies prototype of all objects.

#### Verification Procedure

**Step 1: Check for deep merge / deep extend**
```
grep -rn --include="*.ts" -iE "deep.*merge|deep.*extend|deepMerge|deepExtend|object\.assign.*req\.\|lodash.*merge|_.merge" apps/backend/
```
- ✅ PASS: No deep merge of user input into objects
- ❌ FAIL: User input deep-merged into application objects

**Step 2: Check for direct property access from user input**
```
grep -rn --include="*.ts" -E "req\.(body|query|params)\[" apps/backend/ | head -10
```
- ✅ PASS: No bracket notation access from user input (prevents `req.body['__proto__']`)
- ⚠️ PARTIAL: Bracket notation used but input is validated

**Step 3: Check Express body parser config**
```
grep -rn --include="*.ts" "json()\|urlencoded\|body-parser" apps/backend/src/ | head -5
```
- ✅ PASS: Express 4.17.1+ (mitigates some proto pollution) or `Object.create(null)` used
- ⚠️ PARTIAL: Standard body parser (modern Express has some protections)

**Step 4: Check for MongoDB query injection via proto**
```
grep -rn --include="*.ts" "find(\|findOne(\|update(\|delete(" apps/backend/ | grep "req\." | head -10
```
- ✅ PASS: User input validated with zod before MongoDB queries (prevents `$gt`, `$ne` injection too)
- ❌ FAIL: Raw user input passed to MongoDB operations

**Overall verdict:**
- ✅: No deep merge of user input, zod validation, no bracket notation access
- ⚠️: Some merge patterns but with validation
- ❌: User input deep-merged without sanitization, or raw input to MongoDB
