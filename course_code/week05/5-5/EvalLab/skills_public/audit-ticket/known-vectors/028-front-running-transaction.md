---
id: 28
title: "Front-Running Transaction"
severity: 6
category: crypto
---

### 28 — Front-Running Transaction
**Severity: 6** | **Real: Widespread in DeFi, Solana MEV via Jito bundles**

Attacker sees pending transaction, submits theirs first to profit from price impact.

#### Verification Procedure

**Step 1: Identify time-sensitive operations**
```
grep -rn --include="*.rs" -iE "swap|trade|deposit|withdraw|claim|liquidat" programs/*/src/instructions/
```
- Record: All time-sensitive instructions

**Step 2: Check for commit-reveal pattern**
```
grep -rn --include="*.rs" -iE "commit|reveal|hash|preimage|nonce" programs/
```
- ✅ PASS: Sensitive operations use commit-reveal or are not vulnerable to ordering
- ⚠️ PARTIAL: No commit-reveal but slippage protection mitigates the impact
- N/A: Operations are not price-sensitive

**Step 3: Verify slippage protection on swaps (see Hack #7)**
- ✅ PASS: Slippage protection prevents profitable front-running
- ❌ FAIL: No slippage tolerance on price-sensitive operations

**Step 4: Check for private/priority transaction support**
```
grep -rn --include="*.ts" -iE "jito|priority_fee\|priorityFee\|computeUnitPrice" apps/
```
- ✅ PASS: Supports Jito bundles or priority fees for MEV protection
- ⚠️ PARTIAL: No explicit MEV protection but slippage limits impact

**Overall verdict:**
- ✅: Slippage protection + priority fees/bundles
- ⚠️: Slippage only (most common adequate protection)
- ❌: No slippage or commit-reveal on price-sensitive operations
