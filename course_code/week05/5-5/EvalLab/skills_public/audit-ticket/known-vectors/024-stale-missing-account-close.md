---
id: 24
title: "Stale/Missing Account Close"
severity: 5
category: crypto
---

### 24 — Stale/Missing Account Close
**Severity: 5** | **Real: Rent-exempt account bloat, stale reference attacks**

Accounts not closed after use — stale data can be referenced, rent is wasted, or revived accounts retain old state.

#### Verification Procedure

**Step 1: Find all account lifecycle endpoints**
```
grep -rn --include="*.rs" "close =\|close_account\|AccountClose" programs/
```
- Record: Which accounts have close operations

**Step 2: For each closeable account, verify state machine completeness**
```
# E.g., WithdrawalState: Created → Pending → Finalized → CLOSED
grep -rn --include="*.rs" -iE "status|state|stage|phase" programs/*/src/state/
```
- ✅ PASS: Terminal states have close logic — accounts don't remain open indefinitely
- ❌ FAIL: Accounts can reach terminal state but never get closed

**Step 3: Verify closed account data is zeroed**
```
# Anchor's close constraint automatically zeros data and transfers lamports
grep -rn --include="*.rs" "close =" programs/*/src/instructions/
```
- ✅ PASS: Uses Anchor `close =` attribute (auto-zeroes data)
- ❌ FAIL: Manual close that doesn't zero account data (account could be revived with stale data)

**Step 4: Check for resurrection attacks**
```
# After close, can the same PDA be re-created with different data?
grep -rn --include="*.rs" "init," programs/*/src/instructions/ | grep -v test
```
- ✅ PASS: Seeds ensure a closed account can only be re-created through proper init with fresh data
- ❌ FAIL: Closed PDA can be re-opened and old relationships are still valid

**Overall verdict:**
- ✅: All terminal-state accounts closeable, data zeroed, re-init is safe
- ⚠️: Some accounts don't have close logic but don't hold critical data
- ❌: Stale accounts can be referenced after they should be invalid
