---
id: 40
title: "Command Injection"
severity: 9
category: backend
---

### 40 — Command Injection
**Severity: 9** | **Real: Equifax ($575M, 2017, similar vector), Shell shock**

User input passed to `exec()` or `spawn()` — attacker runs: `; rm -rf / #` or `| cat /etc/passwd`.

#### Verification Procedure

**Step 1: Find all shell execution**
```
grep -rn --include="*.ts" "exec(\|execSync(\|spawn(\|spawnSync(\|child_process\|execFile(" apps/backend/
```
- If zero results: ✅ PASS (no shell execution in the codebase)
- If results found: proceed

**Step 2: Check if user input flows to shell commands**
```
# For each exec/spawn: trace the command string
# Is any part from req.body, req.query, or req.params?
```
- ✅ PASS: All shell commands are fully hardcoded (no user input)
- ❌ FAIL: Any user input in shell command string

**Step 3: If shell execution with user data exists**
```
# Verify proper escaping or use of array-form spawn
grep -rn --include="*.ts" -A5 "spawn(" apps/backend/ | grep "\["
```
- ✅ PASS: Uses `spawn('command', [arg1, arg2])` array form (no shell injection)
- ❌ FAIL: Uses `exec('command ' + userInput)` or template literal with user input

**Step 4: Check for eval() or Function()**
```
grep -rn --include="*.ts" "eval(\|new Function(" apps/backend/
```
- ✅ PASS: No eval() or new Function() calls
- ❌ FAIL: Any eval with user-controlled input (code injection)

**Overall verdict:**
- ✅: No shell execution, or fully hardcoded commands, or array-form spawn only
- ⚠️: Shell execution exists but no user input flows to it (verify trace carefully)
- ❌: User input in exec/eval/spawn string
