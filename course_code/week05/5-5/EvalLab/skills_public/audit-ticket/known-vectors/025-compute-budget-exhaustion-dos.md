---
id: 25
title: "Compute Budget Exhaustion DoS"
severity: 6
category: crypto
---

### 25 — Compute Budget Exhaustion DoS
**Severity: 6** | **Real: Solana DeFi state bloat attacks, Mango Markets exploit chain**

Attacker creates hundreds of positions/accounts — batch operations exceed 1.4M compute units, locking the protocol.

#### Verification Procedure

**Step 1: Find all loops and iterations**
```
grep -rn --include="*.rs" -iE "for.*in\|iter()\|remaining_accounts.*for\|\.len()" programs/*/src/instructions/
```
- Record: Every loop with what's being iterated

**Step 2: Check for bounded iteration**
```
# For each loop: is there a max count?
grep -rn --include="*.rs" -B5 "for.*in\|iter()" programs/*/src/instructions/ | grep -iE "max\|limit\|cap\|MAX_"
```
- ✅ PASS: All loops have explicit upper bounds (e.g., `for i in 0..min(len, MAX_POSITIONS)`)
- ❌ FAIL: Loop iterates over unbounded user-controlled collection

**Step 3: Check remaining_accounts usage**
```
grep -rn --include="*.rs" "ctx.remaining_accounts" programs/*/src/instructions/
```
- ✅ PASS: remaining_accounts length is bounded and validated
- ❌ FAIL: Unbounded remaining_accounts processed in loop

**Step 4: Check for user-created account limits**
```
grep -rn --include="*.rs" -iE "max_positions\|max_investors\|max_.*count\|capacity" programs/*/src/state/
```
- ✅ PASS: Hard cap on user-creatable entities per fund/protocol
- ❌ FAIL: Unlimited positions/accounts can be created

**Step 5: Estimate worst-case compute**
```
# If program processes N accounts in a loop, with ~50K CU per iteration:
# Max = 1,400,000 CU → safe with ~28 iterations at 50K each
# Check if worst case exceeds budget
```
- ✅ PASS: Worst-case iteration * CU-per-iteration is well within 1.4M CU
- ❌ FAIL: Worst case can exceed compute budget

**Overall verdict:**
- ✅: Bounded loops, capped entities, safe compute budget
- ⚠️: Bounded but close to compute limit in worst case
- ❌: Unbounded iterations that can exceed compute budget
