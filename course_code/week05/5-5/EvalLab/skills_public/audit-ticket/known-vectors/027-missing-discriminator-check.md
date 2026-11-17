---
id: 27
title: "Missing Discriminator Check"
severity: 8
category: crypto
---

### 27 — Missing Discriminator Check
**Severity: 8** | **Real: Anchor type cosplay attacks, account substitution**

Account of wrong type passes validation because discriminator isn't checked — attacker provides Fund account where Position was expected.

#### Verification Procedure

**Step 1: Verify Anchor manages all state accounts**
```
grep -rn --include="*.rs" "#\[account\]" programs/*/src/state/
```
- ✅ PASS: All state structs use `#[account]` macro (8-byte discriminator auto-added)
- ❌ FAIL: Manual account structs without Anchor discriminator

**Step 2: Verify Account<> type is used in instruction contexts**
```
grep -rn --include="*.rs" "Account<'info," programs/*/src/instructions/
```
- ✅ PASS: All state accounts deserialized via `Account<'info, StateType>` (auto-checks discriminator)
- ❌ FAIL: Any account deserialized manually or via try_from_slice without discriminator check

**Step 3: Check for manual deserialization**
```
grep -rn --include="*.rs" "try_from_slice\|try_deserialize\|from_account_info\|AccountDeserialize" programs/
```
- If found: Does it include discriminator verification?
- ✅ PASS: All manual deserialization includes discriminator check
- ❌ FAIL: Manual deserialization without discriminator (type cosplay possible)

**Overall verdict:**
- ✅: All accounts use Anchor #[account] + Account<> type (automatic discriminator)
- ⚠️: Manual deserialization present but with discriminator check
- ❌: Accounts without discriminator check
