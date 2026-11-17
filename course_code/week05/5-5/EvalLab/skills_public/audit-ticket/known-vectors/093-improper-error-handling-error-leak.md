---
id: 93
title: "Improper Error Handling (Error Leak)"
severity: 5
category: devops
---

### 93 — Improper Error Handling (Error Leak)
**Severity: 5** | **Real: Stack traces revealing file paths, DB structure, or API keys**

Server returns full stack trace or internal details in error responses — attacker maps the application internals.

#### Verification Procedure

**Step 1: Check error handler**
```
grep -rn --include="*.ts" -iE "error.*handler\|catch.*error\|app\.use.*err" apps/backend/src/ | head -10
```
- ✅ PASS: Global error handler catches all errors and returns generic message
- ❌ FAIL: No global error handler — default Express handler exposes stack

**Step 2: Check error response format**
```
grep -rn --include="*.ts" -A5 "catch.*error\|\.catch(" apps/backend/src/ | grep -iE "res\.\(json\|send\|status\)" | head -10
```
- ✅ PASS: Error responses contain only a message code/string, no stack trace or internal details
- ❌ FAIL: `res.json({ error: error.message, stack: error.stack })`

**Step 3: Check for error.stack in responses**
```
grep -rn --include="*.ts" "\.stack\b" apps/backend/ | grep -iE "res\.|response\.|send\|json" | head -5
```
- ✅ PASS: Stack traces never sent in HTTP responses
- ❌ FAIL: Stack traces in error responses

**Step 4: Check for NODE_ENV-based error detail**
```
grep -rn --include="*.ts" "NODE_ENV.*stack\|production.*stack\|stack.*production" apps/backend/ | head -5
```
- ✅ PASS: Stack traces only in development, generic messages in production
- ⚠️ PARTIAL: Environment check exists but not consistently applied

**Step 5: Check for database error forwarding**
```
grep -rn --include="*.ts" "MongoError\|mongoose.*error\|\.catch.*res\.\(json\|send\)" apps/backend/ | head -5
```
- ✅ PASS: Database errors mapped to generic messages before sending to client
- ❌ FAIL: Raw database errors forwarded to client (reveals DB structure)

**Overall verdict:**
- ✅: Global error handler, generic messages in production, no stack traces
- ⚠️: Error handler exists but some routes bypass it
- ❌: Stack traces or internal details in production error responses
