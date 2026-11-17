---
id: 31
title: "NoSQL Injection (MongoDB)"
severity: 8
category: backend
---

### 31 — NoSQL Injection (MongoDB)
**Severity: 8** | **Real: Constant in-the-wild exploitation, authentication bypass**

Attacker sends `{ "$gt": "" }` instead of a string — MongoDB operator injection bypasses filters and authentication.

#### Verification Procedure

**Step 1: Find all MongoDB queries**
```
grep -rn --include="*.ts" -E "\.(find|findOne|updateOne|updateMany|deleteOne|deleteMany|aggregate|countDocuments)\(" apps/backend/
```
- Record: Every query with file:line

**Step 2: For each query, trace the input source**
```
# For each .find() call: where do the filter params come from?
# Trace back from the query to req.body, req.params, req.query
```
- Record: Which queries use user-controlled input

**Step 3: Verify Zod validation BEFORE every query**
```
grep -rn --include="*.ts" "z.object\|z.string\|\.parse(" apps/backend/src/routes/
```
- For each route with a MongoDB query: does a Zod schema validate the input before the query?
- ✅ PASS: Every query parameter is Zod-validated with explicit types (z.string(), z.number())
- ❌ FAIL: Any query parameter passes through without schema validation

**Step 4: Check for direct $operator injection**
```
grep -rn --include="*.ts" "req\.body\.\|req\.query\.\|req\.params\." apps/backend/src/routes/ | grep -i "find\|update\|delete"
```
- ✅ PASS: User input is explicitly typed/cast to string before use in query: `{ field: String(req.body.field) }`
- ❌ FAIL: Raw `req.body.field` passed into MongoDB query (could contain `{ "$gt": "" }`)

**Step 5: Check for $where injection**
```
grep -rn --include="*.ts" '"\$where"\|\$expr\|\$function' apps/backend/
```
- ✅ PASS: No `$where`, `$expr`, or `$function` operators used
- ❌ FAIL: Server-side JavaScript execution in MongoDB queries

**Step 6: Test with injection payload (manual)**
```
# Send to any authenticated endpoint:
# { "walletAddress": { "$gt": "" } }
# If it returns data for other wallets → VULNERABLE
```
- ✅ PASS: Returns 400/validation error
- ❌ FAIL: Returns data → injection works

**Overall verdict:**
- ✅: All inputs Zod-validated, explicit type casting, no $where
- ⚠️: Zod validation present but some edge cases miss nested $operators
- ❌: Raw req.body in MongoDB queries without validation
