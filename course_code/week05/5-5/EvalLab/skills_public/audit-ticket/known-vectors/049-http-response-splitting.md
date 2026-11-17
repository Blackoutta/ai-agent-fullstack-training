---
id: 49
title: "HTTP Response Splitting"
severity: 6
category: backend
---

### 49 — HTTP Response Splitting
**Severity: 6** | **Real: Cache poisoning, XSS via header injection**

User input in response headers contains `\r\n` — attacker injects headers or breaks HTTP response.

#### Verification Procedure

**Step 1: Find all setHeader/writeHead calls**
```
grep -rn --include="*.ts" "setHeader\|writeHead\|res\.header\|res\.set(" apps/backend/
```
- Record: All header-setting operations

**Step 2: Check for user input in headers**
```
# For each header set: does the value come from user input?
grep -rn --include="*.ts" -B3 "setHeader\|res\.header" apps/backend/ | grep "req\.\|body\.\|query\.\|params\."
```
- ✅ PASS: No user input in response headers
- ❌ FAIL: User input in header values without newline stripping

**Step 3: Check for newline filtering**
```
grep -rn --include="*.ts" -iE "\\\\r|\\\\n|replace.*newline" apps/backend/ | grep -i "header"
```
- ✅ PASS: If user input in headers, newlines (`\r`, `\n`) are stripped
- ❌ FAIL: User input in headers without filtering

**Step 4: Node.js version check**
```
node --version
# Node.js 12+ rejects header values containing \r or \n
```
- ✅ PASS: Node.js 12+ (built-in protection)
- ⚠️ PARTIAL: Older Node.js but no user input in headers

**Overall verdict:**
- ✅: No user input in headers, or Node.js 12+ (auto-protection)
- ⚠️: User input in headers but newlines filtered
- ❌: User input in headers on old Node.js without filtering
