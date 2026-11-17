---
id: 4
title: "Missing Access Control"
severity: 10
category: crypto
---

### 4 — Missing Access Control
**Severity: 10** | **Real: Wormhole ($326M), Parity ($31M), numerous Solana rug pulls**

Admin/privileged function doesn't verify the signer is authorized. Anyone can call it.

#### Verification Procedure

**Step 1: List all instructions and their signers**
```
grep -rn --include="*.rs" "pub fn\|Signer<'info>" programs/*/src/instructions/
```
- Record: Every instruction function and how many Signer accounts it has

**Step 2: For each instruction, verify signer constraints**
```
grep -rn --include="*.rs" -A20 "#\[derive(Accounts)\]" programs/*/src/instructions/ | grep -E "Signer|has_one|constraint"
```
- ✅ PASS: Every mutation instruction has at least one `Signer<'info>` with appropriate `has_one` or `constraint`
- ❌ FAIL: Any mutation instruction without a signer check

**Step 3: Verify has_one constraints match state fields**
```
grep -rn --include="*.rs" "has_one" programs/*/src/instructions/
```
- For each `has_one = field`, verify the referenced field exists in the account struct and is the correct authority
- ✅ PASS: All `has_one` constraints reference valid authority fields
- ❌ FAIL: Missing `has_one` on admin operations, or `has_one` references wrong field

**Step 4: Check for runtime require_keys_eq (defense in depth)**
```
grep -rn --include="*.rs" "require_keys_eq!\|require_eq!" programs/*/src/instructions/
```
- ✅ PASS: Critical operations have BOTH declarative (`has_one`) AND runtime (`require_keys_eq!`) checks
- ⚠️ PARTIAL: Only declarative OR only runtime (not both)

**Step 5: Verify admin functions are admin-only**
```
# List all functions that modify global state, program config, or treasury
grep -rn --include="*.rs" -iE "admin|config|treasury|authority|owner|upgrade|pause|freeze|withdraw_fee" programs/*/src/instructions/
```
- For each: verify the signer is checked against the stored authority
- ✅ PASS: Every admin function verifies signer == stored authority
- ❌ FAIL: Any admin function callable by non-authority

**Step 6: Check for unrestricted init/initialize**
```
grep -rn --include="*.rs" "pub fn init\|pub fn initialize\|pub fn create" programs/*/src/instructions/
```
- ✅ PASS: Init functions either have authority checks or are one-time-only (init constraint)
- ❌ FAIL: Init function can be called by anyone to overwrite state

**Overall verdict:**
- ✅: Every instruction has correct signer + constraint checks, admin functions protected, init is one-time
- ⚠️: Most instructions correct but 1-2 missing defense-in-depth
- ❌: Any mutation instruction callable without proper auth
