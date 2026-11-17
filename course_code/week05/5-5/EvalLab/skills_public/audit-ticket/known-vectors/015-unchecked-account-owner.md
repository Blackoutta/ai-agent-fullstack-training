---
id: 15
title: "Unchecked Account Owner"
severity: 9
category: crypto
---

### 15 — Unchecked Account Owner
**Severity: 9** | **Real: Cashio ($52M), Jet Protocol exploit**

Program doesn't verify account is owned by expected program — attacker passes fake account from their own program with forged data.

#### Verification Procedure

**Step 1: Find all accounts that should be program-owned**
```
grep -rn --include="*.rs" "Account<'info\|UncheckedAccount<'info" programs/*/src/instructions/
```
- Record: Every account and its expected owner

**Step 2: Verify Account<> types specify owner (Anchor automatic)**
```
# Anchor's Account<'info, MyStruct> automatically checks owner == current program
# TokenAccount checks owner == Token Program
grep -rn --include="*.rs" "Account<'info," programs/*/src/instructions/ | head -30
```
- ✅ PASS: All accounts that should be program-owned use `Account<'info, StateType>`
- Record: Count of Account<> vs UncheckedAccount<>

**Step 3: For each UncheckedAccount, verify runtime owner check**
```
grep -rn --include="*.rs" -A10 "UncheckedAccount" programs/*/src/instructions/
```
- For each: find the `/// CHECK:` comment and then the actual runtime validation
- ✅ PASS: Every UncheckedAccount has `require!(account.owner == &expected_id)` or equivalent
- ❌ FAIL: UncheckedAccount without owner validation (or only a comment, no code)

**Step 4: Check token account mint/owner constraints**
```
grep -rn --include="*.rs" "token::mint\|token::authority\|constraint.*mint\|constraint.*owner" programs/*/src/instructions/
```
- ✅ PASS: Token accounts have mint AND authority constraints
- ❌ FAIL: Token account accepted without verifying its mint matches expected token

**Step 5: Check remaining_accounts owner validation**
```
grep -rn --include="*.rs" -A20 "ctx.remaining_accounts" programs/*/src/instructions/
```
- For each remaining_account: is the owner checked before using the data?
- ✅ PASS: All remaining_accounts are deserialized with owner check
- ❌ FAIL: remaining_accounts used without owner verification

**Overall verdict:**
- ✅: All accounts typed with Account<>, UncheckedAccounts have runtime checks, remaining_accounts validated
- ⚠️: Mostly typed but some remaining_accounts have weak validation
- ❌: UncheckedAccount without owner check, or remaining_accounts without validation
