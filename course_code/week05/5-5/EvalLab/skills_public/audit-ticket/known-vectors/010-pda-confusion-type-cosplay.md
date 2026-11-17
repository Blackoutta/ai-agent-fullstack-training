---
id: 10
title: "PDA Confusion / Type Cosplay"
severity: 8
category: crypto
---

### 10 — PDA Confusion / Type Cosplay
**Severity: 8** | **Real: Multiple Solana exploits, Jet Protocol type confusion**

Attacker creates an account with the same binary layout as an expected account type — passes validation, feeds malicious data.

#### Verification Procedure

**Step 1: Check all account types use Anchor discriminator**
```
grep -rn --include="*.rs" "#\[account\]" programs/*/src/state/
```
- ✅ PASS: All state structs use `#[account]` (Anchor auto-adds 8-byte discriminator)
- ❌ FAIL: Any state struct uses manual serialization without discriminator

**Step 2: Verify Account<> type is used (not AccountInfo)**
```
grep -rn --include="*.rs" "AccountInfo<" programs/*/src/instructions/ | grep -v "/// CHECK"
```
- ✅ PASS: Zero results — all accounts are typed (Account<>, Program<>, Signer<>, UncheckedAccount with CHECK)
- ❌ FAIL: Raw AccountInfo used without CHECK comment and runtime validation

**Step 3: Verify PDA seeds include type-specific discriminators**
```
grep -rn --include="*.rs" "seeds = \[" programs/*/src/instructions/
```
- ✅ PASS: Seeds include a unique prefix per account type (e.g., `b"fund"`, `b"position"`, `b"withdrawal"`)
- ❌ FAIL: Multiple account types share the same seed pattern (collision possible)

**Step 4: Check for AccountInfo used as typed account**
```
grep -rn --include="*.rs" -B5 "AccountInfo\|UncheckedAccount" programs/*/src/instructions/ | grep -v "test"
```
- For each: verify the comment explains WHY and that runtime validation exists
- ✅ PASS: Each use has a valid reason and runtime owner/type check
- ❌ FAIL: AccountInfo used for convenience, no validation

**Step 5: Check has_one constraints prevent cross-type confusion**
```
grep -rn --include="*.rs" "has_one" programs/*/src/instructions/
```
- ✅ PASS: Accounts that reference each other use `has_one` to ensure type-correct linking
- ❌ FAIL: Accounts can reference wrong types because has_one is missing

**Overall verdict:**
- ✅: All accounts use Anchor discriminators, typed with Account<>, unique PDA seeds per type
- ⚠️: Mostly correct but 1-2 UncheckedAccounts with adequate runtime checks
- ❌: AccountInfo without validation, or shared PDA seeds between types
