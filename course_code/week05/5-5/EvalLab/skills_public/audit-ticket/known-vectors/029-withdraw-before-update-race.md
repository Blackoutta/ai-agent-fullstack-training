---
id: 29
title: "Withdraw-Before-Update Race"
severity: 8
category: crypto
---

### 29 — Withdraw-Before-Update Race
**Severity: 8** | **Real: Multiple NAV-based funds, pricing oracle lag exploits**

Withdraw executed with stale NAV → user gets more than entitled before price drop is reflected in the fund.

#### Verification Procedure

**Step 1: Find NAV/price update mechanism**
```
grep -rn --include="*.rs" -iE "update.*nav\|attest\|refresh.*price\|update.*value" programs/*/src/instructions/
```
- Record: How and when NAV is updated

**Step 2: Verify NAV freshness at withdrawal time**
```
grep -rn --include="*.rs" -iE "nav.*timestamp\|last.*update\|stale\|freshness\|max_age\|valid_until" programs/*/src/instructions/
```
- ✅ PASS: Withdrawal checks that NAV was updated within acceptable window (e.g., last 5 min)
- ❌ FAIL: Withdrawal uses NAV without checking when it was last updated

**Step 3: Check withdrawal state machine (multi-step withdrawal protocols)**
```
grep -rn --include="*.rs" -iE "initiate.*withdraw\|mark_ready\|finalize.*withdraw\|withdrawal.*state" programs/
```
- ✅ PASS: Multi-step withdrawal (initiate → ready → finalize) with NAV checkpoint at finalize
- ❌ FAIL: Single-step withdrawal that uses whatever NAV is stored

**Step 4: Verify NAV update cannot be skipped before finalization**
```
# Check: can finalize_withdrawal be called without a recent NAV update?
grep -rn --include="*.rs" -A20 "pub fn finalize" programs/*/src/instructions/
```
- ✅ PASS: finalize requires NAV attestation timestamp to be recent
- ❌ FAIL: finalize works regardless of NAV freshness

**Overall verdict:**
- ✅: Multi-step withdrawal with NAV freshness check at finalization
- ⚠️: Multi-step but NAV freshness window is too wide (hours)
- ❌: Single-step withdrawal or no NAV freshness check
