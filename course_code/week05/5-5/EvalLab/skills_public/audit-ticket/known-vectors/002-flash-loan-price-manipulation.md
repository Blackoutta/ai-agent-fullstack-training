---
id: 2
title: "Flash Loan Price Manipulation"
severity: 10
category: crypto
---

### 2 — Flash Loan Price Manipulation
**Severity: 10** | **Real: Euler ($197M), Mango Markets ($114M), Cream ($130M)**

Borrow millions in one tx → manipulate price/collateral calculation → deposit/withdraw at wrong value → repay loan. Zero capital needed.

#### Verification Procedure

**Step 1: Identify all price calculation code**
```
grep -rn --include="*.rs" -iE "price|value|nav|collateral|balance.*amount|get_account_lamports" programs/
```
- Record: List every file:line where asset values are computed

**Step 2: Check if prices come from on-chain vs oracle**
```
grep -rn --include="*.rs" -iE "pyth|switchboard|oracle|price_feed|price_account" programs/
```
- ✅ PASS (if oracle used): Price comes from a hardened oracle with TWAP, not spot price
- ❌ FAIL: Price calculated from current pool reserves or token account balance (manipulable)

**Step 3: Check for deposit-to-withdrawal delay**
```
grep -rn --include="*.rs" -iE "deposit.*time|withdrawal.*delay|lock.*period|cooldown|min_holding" programs/
```
- ✅ PASS: There's a time delay between deposit and withdrawal (prevents same-tx manipulation)
- ❌ FAIL: Deposit and withdraw can happen in the same transaction or same slot

**Step 4: Check if balance is read before AND after state changes**
```
# Look for patterns where balance is read, then state is changed, without re-reading
grep -rn --include="*.rs" -B5 -A5 "token_account.*amount\|get_lamports()" programs/*/src/instructions/
```
- ✅ PASS: Balance snapshots are taken at consistent points, not between state changes
- ❌ FAIL: Balance read can be stale or manipulated between CPI calls

**Step 5: Verify NAV calculation atomicity (vault/fund protocols)**
```
grep -rn --include="*.rs" "nav\|attestation\|total_value\|compute_shares" programs/
```
- ✅ PASS: NAV is attested off-chain and verified on-chain with freshness timestamp
- ⚠️ PARTIAL: NAV calculated on-chain but has staleness protection
- ❌ FAIL: NAV uses current token account balances that could be donated to

**Step 6: Check for flash loan integration or entry points**
```
grep -rn --include="*.rs" "flash\|loan\|borrow\|CpiContext" programs/ | grep -v "test"
```
- Record: Whether the program interacts with any lending protocol or could be called within a flash loan

**Overall verdict:**
- ✅: Price calculation is oracle-based with TWAP, deposit/withdrawal delay exists, NAV has freshness protection
- ⚠️: Some protections but not comprehensive (e.g., delay exists but no oracle TWAP)
- ❌: Prices come from manipulable sources AND no time delays exist
