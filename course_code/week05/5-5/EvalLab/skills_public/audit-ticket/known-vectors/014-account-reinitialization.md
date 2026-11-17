---
id: 14
title: "Account Reinitialization"
severity: 8
category: crypto
---

### 14 — Account Reinitialization
**Severity: 8** | **Real: Multiple Solana programs overwritten by reinit**

Account can be initialized twice — attacker overwrites legitimate data.

#### Verification Procedure

**Step 1: Find all account initialization**
```
grep -rn --include="*.rs" "init,\|init_if_needed" programs/*/src/instructions/
```
- Record: Every init account

**Step 2: Check for init_if_needed (dangerous)**
```
grep -rn --include="*.rs" "init_if_needed" programs/*/src/instructions/
```
- ✅ PASS: Zero uses of `init_if_needed`
- ⚠️ PARTIAL: `init_if_needed` used but with additional validation (checked that re-initializing is safe behavior)
- ❌ FAIL: `init_if_needed` used without checking if the data would be overwritten

**Step 3: Verify `init` constraint prevents reinit**
```
# Anchor's init constraint automatically prevents reinitialization
# Verify all state accounts use `init` (not manual init)
grep -rn --include="*.rs" "#\[account(init" programs/*/src/instructions/
```
- ✅ PASS: All accounts use Anchor's `init` constraint (automatic reinit prevention)
- ❌ FAIL: Manual initialization without checking if account already exists

**Step 4: Check for manual AccountInfo initialization**
```
grep -rn --include="*.rs" "serialize\|try_borrow_mut_data\|data\.borrow_mut" programs/*/src/instructions/
```
- If found: verify there's a check that the account is empty/uninitialized before writing
- ✅ PASS: No manual serialization, or manual serialization checks `account.data_len() == 0` first
- ❌ FAIL: Manual data write without checking if account already has data

**Overall verdict:**
- ✅: All init uses Anchor `init` constraint, no `init_if_needed`, no manual serialization
- ⚠️: Some `init_if_needed` with adequate safeguards
- ❌: Accounts can be reinitialized, overwriting existing data
