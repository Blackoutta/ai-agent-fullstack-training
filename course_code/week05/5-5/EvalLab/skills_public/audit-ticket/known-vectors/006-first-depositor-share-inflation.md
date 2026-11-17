---
id: 6
title: "First Depositor / Share Inflation"
severity: 9
category: crypto
---

### 6 — First Depositor / Share Inflation
**Severity: 9** | **Real: Multiple ERC-4626 vault exploits (2022-2023), Yearn-like vault attacks**

Attacker deposits 1 lamport → donates large amount to vault → next depositor's shares round to 0 → attacker redeems all.

#### Verification Procedure

**Step 1: Find share calculation code**
```
grep -rn --include="*.rs" -iE "shares|total_supply|mint_to|share_price|per_share" programs/
```
- Record: The exact formula used for deposit→shares conversion

**Step 2: Check for virtual offset (inflation protection)**
```
# Look for a minimum initial deposit, virtual shares, or dead shares pattern
grep -rn --include="*.rs" -iE "virtual|dead_shares|minimum.*deposit|min_deposit\|MINIMUM" programs/
```
- ✅ PASS: Virtual offset (e.g., 1000 virtual shares) or minimum first deposit that prevents the attack
- ❌ FAIL: No protection — `shares = deposit * total_shares / total_assets` with no minimum

**Step 3: Verify division order**
```
# In the share calculation, multiplication must come BEFORE division
# Correct: shares = (deposit * total_shares) / total_assets
# Wrong: shares = deposit * (total_shares / total_assets) — precision loss
```
- Read the actual calculation code and verify mul-before-div
- ✅ PASS: Multiplication before division with checked_mul then checked_div
- ❌ FAIL: Division happens before multiplication

**Step 4: Check for rounding direction**
```
# Deposits should round DOWN (fewer shares to depositor — protocol favored)
# Withdrawals should round DOWN (less assets to withdrawer — protocol favored)
```
- ✅ PASS: Rounding consistently favors the vault/protocol
- ❌ FAIL: Rounding can go against the vault (attacker extracts dust)

**Step 5: Test edge case — deposit with total_shares = 0**
```
grep -rn --include="*.rs" -A20 "total.*shares.*==.*0\|total_supply.*==.*0\|if.*first" programs/
```
- ✅ PASS: First deposit has special handling (e.g., 1:1 ratio, minimum deposit, dead shares minted)
- ❌ FAIL: First deposit follows same formula as subsequent (vulnerable to inflation)

**Overall verdict:**
- ✅: Virtual offset, correct rounding, mul-before-div, first deposit protection
- ⚠️: Some protections but missing virtual offset or minimum
- ❌: No first depositor protection AND rounding can be exploited
