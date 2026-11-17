---
id: 130
title: "CLMM Tick-Boundary & Liquidity-Math Invariants"
severity: 7
category: crypto
---

### 130 — CLMM Tick-Boundary & Liquidity-Math Invariants

**Severity: 7** | **Real: Crema Finance ($8.8M) forged tick-account exploit (attacker supplies an attacker-owned "tick" account so fake fee data drives an inflated claim); OtterSec/Sec3 CLMM reviews (Raydium CLMM, Orca Whirlpools, Meteora DLMM) recurringly flag tick-crossing rounding direction, `liquidity_net` sign handling, and fee-growth-inside checkpoints**

Concentrated-liquidity AMMs (CLMM: Raydium/Orca/Cykura; DLMM/bin: Meteora) replace the constant-product curve with liquidity that is only active inside discrete **tick** (or **bin**) ranges. Almost all of the exploitable surface lives at the *boundaries* between ranges and in the *checkpoint math* that credits fees to each position. Five recurring invariant failures:

- **Tick-crossing rounding direction.** Every conversion between `liquidity`, token amounts, and `sqrt_price` at a tick edge must round **against the LP / in favor of the pool** — amount-in rounds up, amount-out rounds down, and the sqrt-price step never over-credits the swapper. A single boundary that rounds the wrong way lets a swapper repeatedly cross the same tick to extract dust that compounds into a real drain.
- **Sqrt-price boundary off-by-one.** At a tick edge the comparison that decides whether the swap has reached / crossed the tick (`sqrt_price >= tick_sqrt_price` vs `>`) determines whether the boundary liquidity is applied *this* step or the *next* one. An inclusive/exclusive mismatch double-applies or skips the tick's `liquidity_net`, so active liquidity is wrong for the remainder of the swap.
- **`liquidity_net` / ΔL accounting on crossing.** When price crosses a tick (or bin) the pool must add `liquidity_net` going up and subtract it going down (sign flips with direction), and the running `liquidity` must never underflow. A dropped sign flip, a missing checked add/sub, or a crossing that updates price but not `liquidity` corrupts the active-liquidity total — mispricing every subsequent fill in the transaction.
- **Tick-array / bin-array traversal bounds.** Swaps walk a sequence of tick-array / bin-array accounts supplied by the caller. If traversal can skip an array (leaving initialized ticks uncrossed) or re-enter / double-count one, liquidity and fees are computed over the wrong set of ticks. The array accounts themselves must be validated (owner = the pool program, correct discriminator/type, correct start-index derivation) — **this is the Crema class**: the attacker passed a *forged* tick account they owned, carrying fabricated fee-growth values, and the program trusted it.
- **Fee-growth-inside checkpoint correctness.** A position's earned fees are `fee_growth_inside = fee_growth_global − fee_growth_below − fee_growth_above`, where the below/above terms are selected by whether current tick is inside the position's range, using the ticks' `fee_growth_outside` snapshots (which are flipped on each crossing). Getting the below/above selection, the subtraction order, or the wrapping-subtraction semantics wrong lets a position claim fees it never earned (or strand fees), and a forged tick account short-circuits the whole calculation.

Root cause across all five: boundary math and the accounts that feed it are trusted to be internally consistent, when correctness actually depends on (a) rounding always favoring the pool, (b) exact inclusive/exclusive edge comparisons, (c) checked signed ΔL updates, and (d) hard owner/type validation of every tick/bin account read.

> Cross-ref: pairs with the AMM/CLMM/DLMM methodology (`references/methodologies/amm-clmm.md`) — §2 (tick-bitmap off-by-one), §3 (bin-array PDA index off-by-one), §4 (atomic tick/bin crossing), §5 (fee-growth `inside`/`outside` divergence + global monotonicity), §6 (tick/bin/position account validation on EVERY read), §7c (asymmetric rounding by direction). The tick-account-forgery angle is the CLMM instance of KV-015 (unchecked account owner) and KV-027 (missing discriminator check); the dust-per-crossing rounding angle is the CLMM instance of KV-012 (arithmetic rounding exploit). Related economic checks: ECON-006/ECON-010 (slippage on every swap path).

#### Verification Procedure

**Step 1: Confirm the pool is concentrated-liquidity (tick/bin), not constant-product**
```
grep -rn --include="*.rs" -iE "tick|sqrt_price|liquidity_net|fee_growth|bin_array|tick_array|active_id|liquidity_gross" programs/*/src/
```
- Record: the swap instruction, the tick-crossing routine, the fee-growth-inside function, and how tick-array / bin-array accounts are passed in. If the AMM is pure constant-product (`x*y=k`, no ticks/bins), this vector is N/A (use KV-012 / the AMM methodology §7 instead).

**Step 2: Does tick-crossing rounding always favor the pool?**
```
grep -rn --include="*.rs" -B3 -A6 -iE "get_amount|delta|round|next_sqrt_price|compute_swap_step|swap_step" programs/*/src/ | grep -iE "round_up|round_down|ceil|floor|div_ceil|\+ 1|checked_"
```
- ✅ PASS: at every boundary, amount-in rounds up and amount-out (and the sqrt-price step) rounds down — rounding direction is explicit and always against the LP; conversions use u128 intermediates with checked ops.
- ❌ FAIL: a tick-boundary conversion rounds toward the swapper (or rounding direction is implicit / defaulted), so repeated crossings leak value out of the pool.

**Step 3: Are the sqrt-price edge comparison and the `liquidity_net` update correct?**
```
grep -rn --include="*.rs" -B2 -A10 -iE "cross|liquidity_net|next_tick|tick_current|sqrt_price.*<|sqrt_price.*>" programs/*/src/
```
- ✅ PASS: the "reached tick" comparison uses the intended inclusive/exclusive boundary consistently for both swap directions; on crossing, `liquidity` is `checked_add(liquidity_net)` going up and `checked_sub` going down, the sign flips with direction, and price + liquidity are updated atomically in the same step.
- ❌ FAIL: an off-by-one at the sqrt-price edge double-applies or skips a tick's liquidity, OR the `liquidity_net` sign/checked-math is wrong, OR price is updated without updating active liquidity.

**Step 4: Is tick-array / bin-array traversal bounded, and is every array account validated?**
```
grep -rn --include="*.rs" -B2 -A8 -iE "tick_array|bin_array|next_array|start_index|array_index|remaining_accounts|load_tick|get_tick" programs/*/src/ | grep -iE "owner|program_id|discriminator|start_tick_index|key\(\)|require|assert"
```
- ✅ PASS: traversal cannot skip an initialized array or re-enter/double-count one (start-index derivation is checked and monotonic in the swap direction); each tick-array / bin-array (and each tick/bin) account is validated for owner = pool program, correct discriminator/type, and correct PDA/start-index derivation before its data is read.
- ❌ FAIL: an array can be skipped or double-counted, OR a caller-supplied tick/bin account is read without owner+type+derivation checks — a forged tick account with fabricated liquidity/fee data is accepted (the Crema class).

**Step 5: Is `fee_growth_inside` computed correctly and used to bound fee claims?**
```
grep -rn --include="*.rs" -B3 -A10 -iE "fee_growth_inside|fee_growth_below|fee_growth_above|fee_growth_outside|fee_growth_global|collect_fee|tokens_owed" programs/*/src/
```
- ✅ PASS: `fee_growth_inside = fee_growth_global − fee_growth_below − fee_growth_above`, with below/above selected by whether the current tick is inside the position range using the ticks' `fee_growth_outside` snapshots, subtractions use wrapping/checked semantics in the correct order, `fee_growth_outside` is flipped on each crossing, and a position can never claim more than its accrued inside-growth.
- ❌ FAIL: the below/above selection, subtraction order, or wrapping semantics are wrong, OR the checkpoint is read from an unvalidated tick account — a position claims unearned fees.

**Overall verdict:**
- ✅: All boundary conversions round in the pool's favor; sqrt-price edge comparison and checked signed `liquidity_net` updates are correct and atomic with price; array traversal is bounded and every tick/bin/array account is owner+type+derivation validated; `fee_growth_inside` is computed and bounded correctly.
- ⚠️: Core math is correct but at least one tick/bin/array account is read with incomplete validation (e.g., owner checked but not discriminator/derivation), or a rounding direction is correct but only implicitly, leaving a latent boundary bug.
- ❌: Any tick-boundary conversion rounds toward the swapper, OR an off-by-one / bad `liquidity_net` sign corrupts active liquidity, OR a forged/unvalidated tick/bin account is trusted (Crema-class), OR `fee_growth_inside` lets a position over-claim.
- N/A: Pool is pure constant-product (no ticks/bins) — evaluate under KV-012 and the AMM methodology §7.
