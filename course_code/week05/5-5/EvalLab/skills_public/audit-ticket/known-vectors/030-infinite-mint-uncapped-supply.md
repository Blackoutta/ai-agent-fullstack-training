---
id: 30
title: "Infinite Mint / Uncapped Supply"
severity: 10
category: crypto
---

### 30 — Infinite Mint / Uncapped Supply
**Severity: 10** | **Real: Cover Protocol ($4.4M, 2020), Paid Network ($27M, 2021)**

Exploit allows minting unlimited tokens — attacker dumps on market, drains all liquidity.

#### Verification Procedure

**Step 1: Find all mint operations**
```
grep -rn --include="*.rs" "mint_to\|MintTo\|token::mint_to" programs/ | grep -v test
```
- Record: Every mint instruction with context

**Step 2: Verify every mint has correct authorization**
```
# For each mint_to: who is the mint authority?
grep -rn --include="*.rs" -B10 "mint_to\|MintTo" programs/*/src/instructions/
```
- ✅ PASS: Mint authority is PDA (only program can mint) with correct seeds verified
- ❌ FAIL: Mint authority is a user-controlled account

**Step 3: Verify mint amount is proportional**
```
# For each mint: is the amount calculated correctly?
# shares_to_mint = (deposit_amount * total_shares) / total_assets
# NOT: shares_to_mint = arbitrary_user_input
```
- ✅ PASS: Mint amount derived from verified formula, not user input
- ❌ FAIL: User can influence mint amount directly

**Step 4: Check for supply cap or max mint per tx**
```
grep -rn --include="*.rs" -iE "max_supply\|supply_cap\|max_mint\|MAX_SUPPLY" programs/
```
- ✅ PASS: Supply cap exists OR minting is strictly proportional to deposits (self-limiting)
- ❌ FAIL: No supply limit AND mint amount can be manipulated

**Step 5: Verify mint event emission**
```
grep -rn --include="*.rs" "emit!" programs/*/src/instructions/ | grep -iE "mint\|share\|deposit"
```
- ✅ PASS: Every mint emits an event (off-chain monitoring can detect anomalies)
- ⚠️ PARTIAL: Mint works but no event emitted (silent — hard to detect abuse)

**Overall verdict:**
- ✅: PDA mint authority, proportional formula, supply cap or self-limiting, events
- ⚠️: Correct formula but missing events or supply cap
- ❌: Arbitrary mint amounts possible or weak authority check

---

## Backend / API Hacks (31-55)
