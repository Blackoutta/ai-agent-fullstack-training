---
id: 94
title: "Missing Input Length Limits"
severity: 6
category: devops
---

### 94 — Missing Input Length Limits
**Severity: 6** | **Real: DoS via 100MB JSON body, regex DoS (ReDoS), MongoDB document size exploits**

No body size limit → attacker sends 100MB JSON → server runs out of memory. Or extremely long string triggers O(n²) regex.

#### Verification Procedure

**Step 1: Check body parser limits**
```
grep -rn --include="*.ts" -iE "limit.*body\|body.*limit\|json\(\|urlencoded\(" apps/backend/src/ | head -5
```
- ✅ PASS: Body parser has explicit size limit (e.g., `json({ limit: '1mb' })`)
- ❌ FAIL: No body limit set (Express default is 100kb but should be explicit)

**Step 2: Check individual field length validation**
```
grep -rn --include="*.ts" -iE "\.max\(|maxLength|z\.string\(\)\.max\|length.*<\|\.length.*>" apps/backend/src/ | head -10
```
- ✅ PASS: Zod schemas with `.max()` on string fields
- ❌ FAIL: No field length validation — attacker sends 10MB string in a single field

**Step 3: Check for regex patterns (ReDoS risk)**
```
grep -rn --include="*.ts" "new RegExp\|\.match\|\.test\|\.replace" apps/backend/src/ | grep "req\." | head -5
```
- ✅ PASS: No regex on user input, or regex is simple (no nested quantifiers)
- ❌ FAIL: Complex regex applied to user input (e.g., `(a+)+b` pattern)

**Step 4: Check MongoDB document limits**
```
# MongoDB max document is 16MB — but your limits should be much lower
grep -rn --include="*.ts" -A5 "new\|create\|insertOne\|save\(\)" apps/backend/ | grep -iE "req\.body\b" | head -5
```
- ✅ PASS: All user input validated before storage
- ❌ FAIL: Raw request body stored in MongoDB

**Overall verdict:**
- ✅: Body size limit, field length limits via zod, no ReDoS patterns
- ⚠️: Body limit set but not all fields have length limits
- ❌: No body limit, no field validation, complex regex on user input
