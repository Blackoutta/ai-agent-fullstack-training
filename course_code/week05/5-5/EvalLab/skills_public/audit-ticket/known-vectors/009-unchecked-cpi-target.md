---
id: 9
title: "Unchecked CPI Target"
severity: 9
category: crypto
---

### 9 — Unchecked CPI Target
**Severity: 9** | **Real: Wormhole ($326M), Cashio ($52M)**

CPI to wrong program — attacker passes their own program instead of SPL Token.

#### Verification Procedure

**Step 1: Find all CPI calls and their target programs**
```
grep -rn --include="*.rs" -B2 "CpiContext::new\|invoke(\|invoke_signed(" programs/*/src/instructions/
```
- Record: Every CPI with its target program source

**Step 2: Verify every CPI target is constrained in the Accounts struct**
```
grep -rn --include="*.rs" -A30 "#\[derive(Accounts)\]" programs/*/src/instructions/ | grep -E "Program<|program:.*Program|token_program|system_program"
```
- ✅ PASS: Every program account used in CPI is typed as `Program<'info, Token>` or `Program<'info, System>` (Anchor auto-validates the program ID)
- ❌ FAIL: Program account is `UncheckedAccount` or `AccountInfo` without explicit ID check

**Step 3: Check for manual program ID verification (if UncheckedAccount is used)**
```
grep -rn --include="*.rs" -A5 "UncheckedAccount\|/// CHECK:" programs/*/src/instructions/
```
- For each `/// CHECK:` comment: verify there's an actual runtime check (`require_keys_eq!(account.key(), expected_id)`)
- ✅ PASS: Every `/// CHECK:` has corresponding runtime validation
- ❌ FAIL: `/// CHECK:` comments say "safe" but no actual validation code follows

**Step 4: Verify no CPI to user-provided program**
```
grep -rn --include="*.rs" "remaining_accounts" programs/*/src/instructions/ | grep -c ""
```
- Then check if any remaining_account is used as a CPI target
- ✅ PASS: remaining_accounts are only used as data accounts, never as CPI targets
- ❌ FAIL: A remaining_account is passed as the program to invoke

**Overall verdict:**
- ✅: All CPI targets are Anchor Program<> types with compile-time verification
- ⚠️: Some CPIs use manual checks that are correct but not compile-time enforced
- ❌: Any CPI target from user input without verification
