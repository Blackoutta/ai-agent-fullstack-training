---
id: 128
title: "On-Chain Floating-Point Financial Math"
severity: 5
category: crypto
---

### 128 — On-Chain Floating-Point Financial Math

**Severity: 5** | **Real: Sec3 Huma (`powf`), Sec3/Carrot f64 exchange rate, Neodyme Streamflow, Halborn Token-2022 f64↔u64 cast**

Using `f64`/`f32` in on-chain value computation is unsafe on several independent axes, and auditors keep finding it in fee, interest, exchange-rate, and price math:

- **Non-deterministic rounding.** IEEE-754 results depend on evaluation order and can differ across compiler versions / build flags / target math implementations. Two nodes (or a re-audit build) computing the "same" value may round differently, and value that should be conserved is silently created or destroyed.
- **Precision loss at scale.** `f64` has 52 bits of mantissa; token amounts routinely exceed 2^53. Large balances lose low-order units, so fees/shares/interest computed in float quietly diverge from the true integer amount — exploitable as dust accumulation or as a rounding edge that favors the attacker.
- **Lossy boundary casts.** `f64 → u64` truncates toward zero (or saturates), and `u64 → f64` loses precision on the way in. Every crossing of that boundary in a value path is a place where amounts change unexpectedly.
- **CU blowup.** Transcendental ops (`powf`, `powi`, `sqrt`, `ln`, `exp`) are expensive and variable-cost on BPF, risking compute-budget exhaustion (see KV-025) and making CU non-deterministic.

The correct approach is fixed-point representation (scaled integers / basis points / a fixed-point crate) with **checked** integer arithmetic and u128 widening for intermediate `a * b / c` products — never floating point.

> Off-chain code (clients, indexers, display) may use floats freely; this vector is specifically about float entering **on-chain** value/price/fee/rate computation.

#### Verification Procedure

**Step 1: Find floating-point types and ops in program source**
```
grep -rn --include="*.rs" -E "\bf64\b|\bf32\b|as f64|as f32|\.powf|\.powi|\.sqrt|\.ln\(|\.exp\(|\.floor\(|\.ceil\(|\.round\(" programs/*/src/
```
- Record every hit and identify whether it feeds a value, price, fee, interest, exchange-rate, share, or reward computation

**Step 2: Classify each usage**
```
grep -rn --include="*.rs" -iE "price|fee|rate|interest|exchange|amount|share|reward|balance|swap|collateral" programs/*/src/
```
- ✅ PASS: no float appears in any value path — all financial math uses scaled integers / fixed-point with `checked_*` and u128 intermediates
- ❌ FAIL: `f64`/`f32`/`powf`/`sqrt`/`as f64` computes or scales a monetary value (non-deterministic rounding + precision loss + lossy cast)

**Step 3: Inspect every `f64 ↔ u64` (or `f32 ↔ u32`) boundary in a value path**
- For each cast crossing float↔integer, confirm it is not on a monetary quantity; a cast on an amount is a finding on its own (truncation/saturation changes the value)
- ✅ PASS: no float↔integer cast occurs on a value; conversions are integer-only with explicit rounding direction chosen in the protocol's favor
- ❌ FAIL: a token amount / fee / rate crosses the float↔integer boundary

**Overall verdict:**
- ✅: On-chain financial math is entirely fixed-point + checked integers; no `f64`/`f32`/transcendental ops or float↔integer casts in any value path
- ⚠️: Float appears only in a clearly non-value context (e.g., a log/metric) but sits close to value code and risks future misuse
- ❌: Any on-chain value, price, fee, interest, or exchange-rate is computed or cast through floating point
- N/A: Program performs no value/price/fee/rate computation
