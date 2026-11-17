---
id: 17
title: "Vault Donation Attack"
severity: 7
category: crypto
---

### 17 — Vault Donation Attack
**Severity: 7** | **Real: ERC-4626 vault exploits, Yearn vault donation**

Attacker sends tokens directly to vault (bypassing deposit instruction) to inflate share price, then redeems at inflated price.

#### Verification Procedure

**Step 1: Identify how vault balance is computed**
```
grep -rn --include="*.rs" -iE "vault.*balance\|vault.*amount\|get_lamports\|token_account\.amount\|total_assets\|total_value" programs/
```
- Record: Whether NAV/share-price uses raw vault balance or tracked deposits

**Step 2: Check if deposits are tracked separately from balance**
```
grep -rn --include="*.rs" -iE "total_deposited\|tracked_balance\|internal_balance\|total_capital" programs/*/src/state/
```
- ✅ PASS: Program tracks deposits/withdrawals in state — share price uses tracked amount, not raw balance
- ❌ FAIL: Share price directly reads vault token account balance (donatable)

**Step 3: Verify NAV attestation (vault/fund protocols)**
```
grep -rn --include="*.rs" -iE "attest\|nav_value\|total_value.*param\|update_nav" programs/*/src/instructions/
```
- ✅ PASS: NAV submitted via attested off-chain oracle, not read from vault balance
- ⚠️ PARTIAL: NAV uses vault balance but has donation detection
- ❌ FAIL: NAV = sum of vault token accounts (directly manipulable)

**Step 4: Check for excess balance detection**
```
# Does the program detect and handle unexpected balance increases?
grep -rn --include="*.rs" -iE "expected.*balance\|excess\|donation\|unexpected" programs/
```
- ✅ PASS: Program detects and ignores unexpected balance increases
- ❌ FAIL: All balance increases are treated as deposits

**Overall verdict:**
- ✅: Tracked deposits separate from balance, or attested NAV, or donation detection
- ⚠️: Most calculations use tracked values but some edge cases use raw balance
- ❌: Share price computed from raw vault balance without donation protection
