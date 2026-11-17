---
id: 86
title: "Insecure Deserialization"
severity: 8
category: devops
---

### 86 — Insecure Deserialization
**Severity: 8** | **Real: Java deserialization RCE, Python pickle exploits, JSON.parse with reviver attacks**

Deserializing untrusted data → attacker crafts payload that executes code during deserialization.

#### Verification Procedure

**Step 1: Check for dangerous deserialization**
```
grep -rn --include="*.ts" -iE "eval\(|Function\(|deserialize|unserialize|yaml\.load\b|pickle" apps/backend/
```
- ✅ PASS: No eval, no unsafe deserialization
- ❌ FAIL: eval() or unsafe deserialization of user input

**Step 2: Check for JSON.parse with reviver function**
```
grep -rn --include="*.ts" "JSON\.parse" apps/backend/ | grep -v node_modules | head -15
```
- ✅ PASS: JSON.parse used without reviver, or reviver is safe (no side effects)
- ❌ FAIL: JSON.parse with user-controlled reviver function

**Step 3: Check for template literal injection**
```
grep -rn --include="*.ts" -E "new Function|eval\(|setTimeout\(.*\bstring" apps/backend/
```
- ✅ PASS: No dynamic code execution patterns
- ❌ FAIL: Template strings or dynamic code with user input

**Step 4: Check for buffer/binary deserialization**
```
grep -rn --include="*.ts" -iE "Buffer\.from|borsh\.deserialize|decode\(" apps/backend/ | grep "req\." | head -5
```
- ✅ PASS: Binary deserialization only of trusted data (e.g., Anchor accounts from blockchain)
- ❌ FAIL: Binary deserialization of arbitrary user input

**Overall verdict:**
- ✅: No eval, JSON.parse is safe, no dynamic code execution, binary deser from trusted sources
- ⚠️: JSON.parse from user input but wrapped in try/catch (handles malformed but not RCE risk)
- ❌: eval() or unsafe deserialization of user input
