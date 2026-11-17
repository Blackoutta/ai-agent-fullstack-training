---
id: 48
title: "ReDoS (Regex Denial of Service)"
severity: 6
category: backend
---

### 48 — ReDoS (Regex Denial of Service)
**Severity: 6** | **Real: Stack Overflow outage (2016), Cloudflare outage (2019)**

Malicious input causes regex to backtrack exponentially — single request hangs the server for minutes.

#### Verification Procedure

**Step 1: Find all regex usage with user input**
```
grep -rn --include="*.ts" "new RegExp(\|\.match(\|\.test(\|\.replace(\|\.search(" apps/backend/ | grep -v node_modules
```
- Record: Every regex that could receive user input

**Step 2: Check for ReDoS-prone patterns**
```
# Dangerous patterns: nested quantifiers (a+)+, overlapping alternation, backreferences
grep -rn --include="*.ts" -E "(\+|\*)\)(\+|\*|{)" apps/backend/
```
- ✅ PASS: No nested quantifiers or user-constructed regex
- ❌ FAIL: Nested quantifiers like `(a+)+` or `(a|a)+`

**Step 3: Check for user input in RegExp constructor**
```
grep -rn --include="*.ts" "new RegExp(.*req\|new RegExp(.*body\|new RegExp(.*query\|new RegExp(.*params" apps/backend/
```
- ✅ PASS: Zero results — user input never used to construct regex
- ❌ FAIL: User input fed into `new RegExp()` (attacker controls the pattern)

**Step 4: Check for regex timeout protection**
```
grep -rn --include="*.ts" -iE "re2|safe-regex|regex.*timeout" apps/backend/
```
- ✅ PASS: Using RE2 or safe-regex library, or no user input in regex at all
- ❌ FAIL: Standard JS regex with user input and no timeout

**Overall verdict:**
- ✅: No user input in regex, or RE2 library, no nested quantifiers
- ⚠️: Some regex with input but simple patterns
- ❌: User input in RegExp constructor or catastrophic backtracking patterns
