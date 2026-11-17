---
id: 11
title: "Integer Overflow / Underflow"
severity: 9
category: crypto
---

### 11 — Integer Overflow / Underflow
**Severity: 9** | **Real: BEC Token ($900M face value, 2018), multiple DeFi protocol exploits**

Arithmetic wraps around — u64::MAX + 1 = 0, or 0 - 1 = u64::MAX.

#### Verification Procedure

**Step 1: Find all arithmetic operations on financial values**
```
grep -rn --include="*.rs" -E "[\+\-\*] [a-z]|[a-z] [\+\-\*]" programs/*/src/instructions/ | grep -v "//" | grep -v "test"
```
- Record: Every line with bare arithmetic operators

**Step 2: Verify all arithmetic uses checked operations**
```
# Count bare operations vs checked
grep -rn --include="*.rs" -cE "checked_add|checked_sub|checked_mul|checked_div" programs/*/src/instructions/
grep -rn --include="*.rs" -cE "[^_]\+ [a-z]|[a-z] \+ [^_]|[^_]\* [a-z]" programs/*/src/instructions/
```
- ✅ PASS: Only checked operations (checked_add, checked_sub, checked_mul, checked_div) used for ALL financial math
- ❌ FAIL: Any bare `+`, `-`, `*`, `/` on u64/u128 financial values

**Step 3: Verify overflow results are handled**
```
grep -rn --include="*.rs" "checked_.*\.ok_or\|checked_.*\.unwrap()\|\.ok_or(.*Overflow\|\.ok_or(.*Math" programs/
```
- ✅ PASS: All checked operations use `.ok_or(Error::MathOverflow)` or equivalent
- ❌ FAIL: Any `.unwrap()` on checked operations (panics instead of returning error)

**Step 4: Check for u64 ↔ u128 casting safety**
```
grep -rn --include="*.rs" "as u64\|as u128\|as i64\|as usize\|try_into\|try_from" programs/
```
- ✅ PASS: All casts use `try_into().ok_or(Error)` or the value is provably in range
- ❌ FAIL: Bare `as u64` that silently truncates

**Step 5: Check for subtraction underflow risk**
```
grep -rn --include="*.rs" "checked_sub" programs/*/src/instructions/
```
- For each: verify the operand order is correct (larger - smaller) or underflow is handled
- ✅ PASS: All subtractions handle the underflow case
- ❌ FAIL: Subtraction that could underflow without handling

**Overall verdict:**
- ✅: 100% checked math, proper error propagation, safe casting
- ⚠️: Mostly checked but 1-2 bare operations on non-critical paths
- ❌: Bare arithmetic on financial values (lamports, shares, fees)
