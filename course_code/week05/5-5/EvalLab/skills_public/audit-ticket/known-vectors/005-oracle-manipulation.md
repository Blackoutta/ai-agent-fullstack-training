---
id: 5
title: "Oracle Manipulation"
severity: 9
category: crypto
---

### 5 — Oracle Manipulation
**Severity: 9** | **Real: Cream ($130M), Compound ($80M), Mango ($114M)**

Attacker manipulates price feed → protocol values collateral incorrectly → drain.

#### Verification Procedure

**Step 1: Identify all price sources**
```
grep -rn --include="*.rs" -iE "price|oracle|pyth|switchboard|feed|quote" programs/
```
- Record: Every place where a price is read or referenced

**Step 2: Check oracle type**
- ✅ PASS: Uses Pyth, Switchboard, or Chainlink with TWAP
- ⚠️ PARTIAL: Uses Pyth spot price without TWAP
- ❌ FAIL: Price derived from DEX pool reserves or token account balance

**Step 3: Verify oracle freshness check**
```
grep -rn --include="*.rs" -iE "stale|age|timestamp|valid_until|max_age|confidence" programs/
```
- ✅ PASS: Code checks that oracle update timestamp is within acceptable window (e.g., < 60s old) AND confidence interval is acceptable
- ❌ FAIL: Oracle price used without checking timestamp or confidence

**Step 4: Verify oracle account owner is checked**
```
# Oracle account should be verified as owned by the oracle program (e.g., Pyth program ID)
grep -rn --include="*.rs" -B5 -A5 "oracle\|price_feed\|price_account" programs/*/src/instructions/
```
- ✅ PASS: Oracle account has owner constraint (e.g., `owner = pyth_program_id`)
- ❌ FAIL: Oracle account is UncheckedAccount or no owner validation

**Step 5: Check for price manipulation via donation (vault/fund protocols)**
```
grep -rn --include="*.rs" "token_account.*amount\|get_lamports\|vault.*balance" programs/
```
- If NAV is computed from token balances: verify it can't be inflated by sending tokens directly to the vault
- ✅ PASS: NAV uses external attestation, not raw vault balance
- ❌ FAIL: NAV = vault balance (attackable by donating tokens)

**Overall verdict:**
- ✅: External oracle with TWAP, freshness check, owner validation, no balance-derived prices
- ⚠️: Oracle used but missing freshness OR confidence checks
- ❌: Prices from manipulable sources (pool reserves, vault balance)
