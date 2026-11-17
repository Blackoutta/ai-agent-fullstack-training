---
id: 7
title: "MEV Sandwich Attack"
severity: 7
category: crypto
---

### 7 — MEV Sandwich Attack
**Severity: 7** | **Real: Jaredfromsubway ($40M+ extracted, 2023), sandwich bots on Solana**

Front-run user's swap → user gets worse price → back-run to capture the difference.

#### Verification Procedure

**Step 1: Find all swap/trade operations**
```
grep -rn --include="*.rs" -iE "swap|trade|exchange|jupiter|route|slippage" programs/
```
- Record: Every instruction that performs or triggers a swap

**Step 2: Verify slippage protection**
```
grep -rn --include="*.rs" "slippage_bps\|min_out\|minimum_amount_out\|max_slippage\|slippage_tolerance" programs/
```
- ✅ PASS: Every swap has a `minimum_amount_out` or `slippage_bps` parameter that is validated on-chain
- ❌ FAIL: Swaps execute without minimum output validation

**Step 3: Check slippage is enforced on-chain (not just in API call)**
```
grep -rn --include="*.rs" -A10 "slippage\|min_out" programs/*/src/instructions/
```
- ✅ PASS: `require!(received >= minimum_amount_out, Error)` check exists in the instruction
- ❌ FAIL: Slippage only checked off-chain or in the API request but not in the program

**Step 4: Verify slippage is set by the authorized party (not attacker)**
```
# Check who provides the slippage parameter
grep -rn --include="*.rs" -B20 "slippage" programs/*/src/instructions/ | grep "Signer\|authority\|manager"
```
- ✅ PASS: Slippage set by fund manager/authorized signer, not by an arbitrary account
- ❌ FAIL: Any account can set the slippage tolerance

**Step 5: Check backend slippage defaults**
```
grep -rn --include="*.ts" -iE "slippage|slippageBps" apps/backend/
```
- ✅ PASS: Backend uses reasonable slippage (50-300 bps) and doesn't allow user to set 10000 bps (100%)
- ❌ FAIL: Slippage is hardcoded to a very high value or user-controllable without bounds

**Overall verdict:**
- ✅: On-chain slippage enforcement, reasonable defaults, authorized signer controls it
- ⚠️: Slippage exists but only enforced off-chain or defaults are too loose
- ❌: No slippage protection on swaps
