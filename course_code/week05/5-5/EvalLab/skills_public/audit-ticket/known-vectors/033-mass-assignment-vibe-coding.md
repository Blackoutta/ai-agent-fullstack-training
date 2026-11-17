---
id: 33
title: "Mass Assignment (Vibe Coding)"
severity: 7
category: backend
---

### 33 — Mass Assignment (Vibe Coding)
**Severity: 7** | **Real: GitHub SSH key exploit (2012), every AI-generated app without validation**

API writes `req.body` directly to database — attacker adds `isAdmin: true` or `balance: 999999`.

#### Verification Procedure

**Step 1: Find all database writes**
```
grep -rn --include="*.ts" -E "\.(create|insertOne|insertMany|updateOne|updateMany|findOneAndUpdate)\(" apps/backend/src/routes/
```
- Record: Every write operation

**Step 2: Check if req.body is passed directly**
```
grep -rn --include="*.ts" -E "\.(create|insert|update)\(req\.body\b|\.(create|insert|update)\(\{.*\.\.\.req" apps/backend/src/routes/
```
- ✅ PASS: Zero results — no direct req.body pass-through
- ❌ FAIL: Any result — req.body or spread of req.body passed to DB (mass assignment)

**Step 3: Verify explicit field picking**
```
# For each write: are only specific fields extracted?
# SAFE: { name: validated.name, amount: validated.amount }
# UNSAFE: { ...req.body } or create(req.body)
```
- ✅ PASS: Every write explicitly picks fields from validated input
- ❌ FAIL: Any write uses spread operator or passes body directly

**Step 4: Check for Zod schema with .strict() or .pick()**
```
grep -rn --include="*.ts" "\.strict()\|\.pick(\|\.omit(" apps/backend/src/routes/
```
- ✅ PASS: Schemas use `.strict()` (rejects extra fields) or `.pick()` (allows only listed fields)
- ⚠️ PARTIAL: Zod schemas exist but don't use strict mode (extra fields are silently dropped)

**Step 5: Check for sensitive field overwrite**
```
# Look for fields that should NEVER come from user input
grep -rn --include="*.ts" -iE "isAdmin|role|permissions|balance|status" apps/backend/src/routes/ | grep -iE "body\.\|validated\."
```
- ✅ PASS: Sensitive fields are never read from user input
- ❌ FAIL: User input could set admin/role/balance fields

**Overall verdict:**
- ✅: Explicit field picking, strict Zod schemas, no sensitive field overwrite
- ⚠️: Zod validation but some endpoints spread validated data without .strict()
- ❌: Direct req.body to database writes
