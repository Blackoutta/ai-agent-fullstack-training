---
id: 108
title: "Token Decimals & Cross-Mint Amount Confusion"
severity: 7
category: crypto
---

### 108 — Token Decimals & Cross-Mint Amount Confusion

**Severity: 7** | **Real: Decimals/units accounting class — raw `amount` treated as value across mints of different precision**

SPL token `amount` is in raw base units; the human value depends on the mint's `decimals`. Bugs arise when a program: hardcodes decimals (e.g., assumes 6 like USDC, but a token has 9 or 2); compares or sums raw `amount`s across mints with different decimals; treats raw `amount` as USD/price-denominated value; or mixes a token amount with a SOL/lamport amount (9 decimals) without scaling. The result is mispriced deposits/withdrawals, broken share math, and rounding that favors an attacker — especially dangerous in NAV/share-issuance paths.

#### Verification Procedure

**Step 1: Find decimals handling**
```
grep -rn --include="*.rs" -E "decimals|10u64\.pow|10\.pow|1_000_000|1e6|1e9|pow\(" programs/
```
- Record every place a power-of-ten scale or hardcoded decimals constant appears

**Step 2: Decimals are read from the mint, not assumed**
- ✅ PASS: Scaling uses `mint.decimals` read from the actual mint account
- ❌ FAIL: Hardcoded `10^6` / `10^9` while accepting tokens of other precision

**Step 3: transfer_checked enforces decimals**
```
grep -rn --include="*.rs" -E "transfer_checked|mint_to_checked|burn_checked|::transfer\(" programs/
```
- ✅ PASS: `*_checked` variants are used (runtime asserts amount/decimals against the mint)
- ⚠️: Unchecked `transfer` used (no decimals binding)

**Step 4: No cross-mint raw-amount comparison**
- For multi-asset vaults / baskets: confirm amounts are normalized to a common unit (or oracle value) before adding/comparing
- ✅ PASS: All cross-asset math normalizes by each mint's decimals (and price where relevant)
- ❌ FAIL: Raw `amount`s of different mints are summed/compared directly

**Step 5: Share / NAV math precision**
- ✅ PASS: Multiply-before-divide with `u128` intermediates; rounding direction favors the protocol (see AR / KV-012)
- ❌ FAIL: Decimals truncation or wrong scale lets an attacker mint excess shares or over-withdraw

**Overall verdict:**
- ✅: Decimals read from mint, `*_checked` transfers, normalized cross-asset math, safe rounding
- ⚠️: Correct decimals but unchecked transfers or risky rounding
- ❌: Hardcoded/assumed decimals or raw cross-mint amount confusion
- N/A: Single fixed mint with known decimals and no value math
