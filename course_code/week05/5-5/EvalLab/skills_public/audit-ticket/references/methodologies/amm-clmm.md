# Methodology — AMM / CLMM / DLMM (Audit Checks)

> **Load when:** an AMM/DEX-liquidity protocol is detected — grep markers:
> `tick`, `sqrt_price`, `liquidity_net`, `fee_growth`, `bin_array`, `whirlpool`
> (also: `tick_bitmap`, `bin_step`, `active_id`/`active_bin`, `sqrt_price_x64`, `fee_growth_inside`, `fee_growth_global`, `min_out`/`min_amount_out`, `k` invariant).
>
> **Purpose:** protocol-specific checks for pooled-reserve AMMs (constant-product, concentrated
> liquidity, discrete-bin DLMM, stable-swap, dynamic-curve hybrids, bonding-curve launchpads).
> These sit **on top of** the language-agnostic checklists (`checklists/01`–`07`). Where a generic
> check already covers the base case, the note says *"beyond `<ID>`, also verify…"* — this file
> only adds the AMM-shaped failure modes.
>
> **How to use:** each section is framed as an auditor check — the *safe shape*, the *failure
> mode*, and a *grep* to locate it. PASS = the safe shape is enforced *in code*; FAIL = the
> failure mode is reachable.
>
> **Scope:** Orca Whirlpools, Raydium CLMM/AMM v4, Meteora DLMM / DAMM v2 / DBC, Crema, Invariant,
> stable-swap forks, pump.fun-style bonding-curve launchpads. Public exploits credited inline
> (Crema $8.8M). Not covered: central-limit order books (Phoenix, OpenBook) — no curve, no LP shares.

---

## 0. Identify the variant before reading line one

The bug surface differs by curve. Confirm which you are auditing:

| Variant | Curve / state | LP form | Distinctive risk |
|---|---|---|---|
| Constant-product | `x·y = k` over `[0,∞)` | fungible LP mint | first-depositor inflation, one-unit `k` leak per swap |
| CLMM | sqrt-price + per-tick liquidity | position NFT | tick math, sqrt-price overflow, fee-growth checkpoints (Crema) |
| DLMM (discrete bin) | fixed-price bins, one active | position (bin shares) | bin-array PDA index off-by-one, active-bin transition atomicity |
| Stable-swap | Newton-solver invariant | fungible LP mint | solver convergence/overflow, amp-ramp griefing |
| Dynamic / hybrid | segmented curve + dynamic fees | position NFT | all CLMM risks + dynamic-fee-state corruption, zap atomicity |
| Bonding-curve launchpad | monotone price curve → graduation | curve state + pre-created mint | graduation accounting, locked-bucket drift, migration DoS |

A wrapper (vault, leveraged-LP, router) that CPIs into a base AMM **inherits every base-AMM risk
in this file plus its own composition risk**. Walk the full call graph; the "real" pool state
lives in the base program and the wrapper's mirror of it must reconcile post-CPI (§9).

---

## 1. Sqrt-price & Q64.64 intermediate overflow

CLMM state carries `sqrt_price` as a fixed-point value (Solana implementations use `Q64.64` —
confirm the constant; it is **not** the EVM `Q96`). Price/liquidity/amount conversions multiply
two ~128-bit quantities, so the intermediate needs `u256`-equivalent width (a `u128` pair, or a
`U256` newtype). A silent truncation mis-prices the swap.

**Auditor check**
- ✅ PASS: every `sqrt_price ± Δ`, `Δamount = L · Δsqrt_price`, and `amount = f(sqrt_price_a, sqrt_price_b, L)`
  conversion is done with an explicit wide-intermediate helper (`mul_div_floor` / `mul_div_ceil`
  over `u128`/`U256`) and a checked downcast (`try_into`/bounds-checked `as`).
- ❌ FAIL: a `sqrt_price` product cast with bare `as u128`/`as u64`, or an add on `sqrt_price`
  without `checked_add`, anywhere the operands are state- or user-derived.
- Beyond `AR-010`–`AR-017` (u128 widening + no unchecked truncation): CLMM specifically needs the
  **256-bit** intermediate for `sqrt_price · liquidity`; a `u128` intermediate that is correct for
  fee math still overflows here.

```
grep -rn -E "sqrt_price|sqrt_price_x64|sqrtPrice" programs/
grep -rn -E "as u128|as u64|as u256" programs/ | grep -iE "sqrt|price|liquidity"   # truncating casts on price/liq math
```

---

## 2. Tick-bitmap off-by-one (negative ticks and word edges)

Ticks are signed (`i32`); the initialized-tick bitmap is a packed array of words indexed by
`tick_index / tick_spacing`, split into `(word_pos, bit_pos)`. Two classic errors:
- **Negative-tick rounding.** `tick / spacing` in Rust truncates *toward zero*, but the bitmap
  needs *floor* division for negative ticks. `-1 / 64 == 0` (truncation) vs `floor(-1/64) == -1`.
  Off by one word ⇒ a swap "finds" the wrong next initialized tick and prices against stale liquidity.
- **Word-boundary search.** "next initialized tick in this word" masks bits at `[bit_pos..]` or
  `[..=bit_pos]`; an inclusive/exclusive slip at bit 0 or bit 255 skips the tick at the boundary.

**Auditor check**
- ✅ PASS: tick→(word,bit) uses **floor** division (or an explicit `div_euclid` / sign-corrected
  path), and the boundary bit is handled with tested inclusive/exclusive masks. Property/fuzz tests
  cover `MIN_TICK`, `MAX_TICK`, `tick = -1`, and both sides of a word boundary.
- ❌ FAIL: `tick / spacing` (truncating) used for bitmap indexing; boundary masks with an
  unaudited `<`/`<=` at bit 0/255; no test at negative ticks.

```
grep -rn -E "tick.*(/|>>).*spacing|word_pos|bit_pos|tick_bitmap|next_initialized_tick" programs/
grep -rn -E "div_euclid|/ *tick_spacing|/ *TICK" programs/    # is division floor-correct for negatives?
```

---

## 3. Bin-array PDA index off-by-one (DLMM)

DLMM stores bins in fixed-size `bin_array` accounts; `bin_array_index = floor(bin_id / BINS_PER_ARRAY)`.
`bin_id` is signed, so — as in §2 — truncating division mislabels the array for negative bins, and a
swap that consumes the **last unit of the last bin in an array** must roll to `index ± 1`, loading
the *adjacent* bin-array account. If the traversal reads/writes the wrong array PDA, or fails to
require the adjacent array be passed in, it prices against the wrong bins.

**Auditor check**
- ✅ PASS: `bin_array_index` uses floor division; the bin-array PDA is re-derived from
  `(pool, bin_array_index)` and `require_keys_eq!`-checked (or Anchor `seeds`+`bump`) on **every**
  array touched during traversal, including the adjacent array reached at a boundary; the
  active-bin transition is atomic with the liquidity update (§4).
- ❌ FAIL: truncating `bin_id / BINS_PER_ARRAY`; a traversal that assumes the next bin-array is the
  same account; a bin-array account trusted without PDA re-derivation (see §6 — same class as tick
  accounts).

```
grep -rn -E "bin_id|bin_array_index|BINS_PER_ARRAY|active_id|active_bin" programs/
grep -rn -E "bin_array" programs/ | grep -iE "seeds|find_program_address|require_keys"
```

---

## 4. Atomic tick / bin crossing

Crossing a tick (CLMM) or bin (DLMM) mid-swap must update **all** of: `liquidity_net` (applied at
the boundary), the fee-growth checkpoints (`fee_growth_outside` for the crossed tick / per-bin fee
accumulator), and the tick-bitmap / active-bin marker — in the **same instruction, as one unit**.
A partial update leaves later swaps mis-priced; if an attacker can interpose a CPI (e.g. via a
Token-2022 transfer hook, §8) between the sub-steps, they can act on a half-updated curve.

**Auditor check**
- ✅ PASS: the cross routine (1) computes the in-range portion to the boundary, (2) applies in-range
  fees, (3) loads the boundary tick/bin and updates `liquidity_net` + fee-growth + bitmap together,
  (4) continues into the next range with the new `L` — with no external CPI interleaved between
  (2) and (4), and all writes committed before any transfer.
- ❌ FAIL: `liquidity_net` applied but fee-growth or bitmap not updated in the same step; the
  boundary write deferred to "after the transfer"; any external CPI (hook, callback) reachable
  mid-cross. Cross-ref `RE-001` (checks-effects-interactions) for the CPI-ordering base case.

```
grep -rn -E "liquidity_net|cross_tick|cross|next_tick|fee_growth_outside" programs/
```

---

## 5. Fee-growth accounting: `inside`/`outside` divergence and global monotonicity

Per-position fee owed = `liquidity · (fee_growth_inside_now − fee_growth_inside_last)`, where
`fee_growth_inside = fee_growth_global − fee_growth_below(lower) − fee_growth_above(upper)`. Two
independent failure modes:
- **Checkpoint divergence (the Crema class).** If the position's stored checkpoint or the tick's
  `fee_growth_outside` diverges from what was actually collected — or the accounting is read from a
  caller-supplied tick account that was never validated — one position can be credited another's
  fees. Crema Finance lost **$8.8M** here: the `claim_fees` path read fee-growth from an
  unvalidated tick account (owner/PDA never checked). The auditor caught the same class in `swap`
  and missed it in `claim_fees` — **when you find a validation gap in one handler, audit every
  handler that reads the same state.**
- **Global monotonicity.** `fee_growth_global[t+1] ≥ fee_growth_global[t]` must hold across every
  state transition. Any path that resets or decreases global fee growth lets prior positions
  re-collect (skip-collect / double-collect).

**Auditor check**
- ✅ PASS: `fee_growth_global` is only ever incremented (assert non-decreasing at each write);
  `fee_growth_inside` is recomputed from validated tick accounts (owner == program ID + PDA
  re-derivation, §6) on every collect; owed ≤ accrued; collect updates the position checkpoint
  **before** the transfer so a second collect returns 0.
- ❌ FAIL: any decrement/reset of `fee_growth_global`; `fee_growth_inside` read from an unvalidated
  tick; checkpoint updated after the transfer (re-collect window); reward-emission accounting
  (a parallel `reward_growth_*` surface) not mirrored to the same discipline.

```
grep -rn -E "fee_growth_global|fee_growth_inside|fee_growth_outside|reward_growth" programs/
grep -rn -E "fee_growth_global *=|fee_growth_global *-=" programs/   # any non-incrementing write is suspect
```

---

## 6. Tick / bin / position account validation on EVERY read

The Crema root cause generalized: **an account holding curve state must be validated as genuinely
program-owned and correctly-derived before any field is read from it — on every instruction, not
just the ones a developer remembered.** Passing an `Account<'info, Tick>` is *not* automatically
safe if the handler also accepts `AccountInfo` variants, and re-derivation is what pins the account
to the right pool/tick_index.

**Auditor check**
- ✅ PASS: every tick, bin-array, and position account read is gated by both `owner == crate::ID`
  **and** a PDA re-derivation `require_keys_eq!(acct.key(), find_program_address([...], &crate::ID).0)`
  (Anchor `Account<..>` + `seeds`/`bump` satisfies both). The position's authority/owner is checked
  before any mutation.
- ❌ FAIL: any curve-state account reached via `UncheckedAccount`/`AccountInfo` and read without an
  owner+PDA check; a `collect_fees`/`update_position` that trusts a caller-supplied tick/position.
- Beyond `PDA-001`+ (derivation safety) and `checklists/01` (owner checks): the AMM-specific
  emphasis is *coverage* — the same check must exist in `swap`, `collect_fees`, `update_position`,
  `close_position`, and any reward path.

```
grep -rn -E "UncheckedAccount|AccountInfo<" programs/ | grep -iE "tick|bin|position"
grep -rn -E "fn (collect|claim|update_position|close_position|swap)" programs/    # confirm each re-derives + owner-checks
```

*Vulnerable → fixed (the Crema class, `collect_fees`):*

```rust
// vulnerable — reads fee_growth from a caller-controlled tick account
let tick = &ctx.accounts.tick_lower;                 // no owner / PDA check
let owed = compute_owed(&ctx.accounts.position, tick.fee_growth_inside);
```

```rust
// fixed — owner + PDA re-derivation gate every tick read
require_keys_eq!(*ctx.accounts.tick_lower.owner, crate::ID, ErrorCode::InvalidTickOwner);
let expected = Pubkey::find_program_address(
    &[b"tick", ctx.accounts.pool.key().as_ref(), &tick_index.to_le_bytes()], &crate::ID).0;
require_keys_eq!(ctx.accounts.tick_lower.key(), expected, ErrorCode::InvalidTickPda);
// ...now safe to read fee_growth_inside...
```

---

## 7. Swap invariants: `k` monotonicity, slippage on every path, asymmetric rounding

### 7a. `k` (or stable invariant / per-tick liquidity) never decreases after fees

The pool must not lose value on a swap once fees are applied. Rounding that lets `k` shrink by a
single unit per swap drains the pool over thousands of trades — a slow, unattributed leak.

- ✅ PASS: after each swap, `reserve_in · reserve_out ≥ k_before` (CP) / the stable invariant `D`
  does not decrease / per-tick `L` accounting is exact — verified with an invariant test over
  random `swap|add|remove|collect` sequences. Fees are credited to the pool, not skimmed in a way
  that lets `k` drop.
- ❌ FAIL: no `k`-monotonicity assertion/test; a fee split (protocol vs LP) whose parts don't sum
  to the total fee (dropped units); output computed such that the pool can end below `k_before`.

### 7b. `min_out` / `max_in` enforced on internal, multi-hop, and flash-swap legs

A `min_out` check on the top-level `swap` is not enough. It must fire on **internal routing calls,
flash-swap callbacks, and every leg of a multi-hop / aggregator path**. Protocols that expose both
`swap_exact_in` and `swap_exact_out` frequently patch slippage on one and forget the other.

- ✅ PASS: every user-callable and internally-callable swap variant takes and enforces
  `amount_out ≥ min_out` (or `amount_in ≤ max_in`), including flash-swap repayment callbacks and
  each hop of a route; aggregator entrypoints honor the caller's slippage bound and cannot have the
  output account substituted.
- ❌ FAIL: a swap variant / internal path / flash-swap leg with no slippage bound; `swap_exact_out`
  missing `max_in`; output-mint or output-account not pinned on an aggregator path.
- Beyond `ECON-006` (Jupiter-swap slippage) and `ECON-007`/`ECON-010` (sandwich): here the concern
  is **completeness across every swap entrypoint the program exposes**, not just the headline one.

### 7c. Asymmetric rounding by direction

`exact_in` rounds **output down**; `exact_out` rounds **input up**. Deposits/withdrawals round
shares/amounts **down**; fees round **up**. A single direction rounded the wrong way is a bug, and
the classic subtle version is *direction-asymmetric*: favouring the pool in `exact_in` but the user
in `exact_out` (or vice versa), so a round-trip extracts value.

- ✅ PASS: a shared, direction-aware helper (`mul_div_floor` for out, `mul_div_ceil` for in) is used
  across **both** swap directions; round-trip `swap(a→b,x)` then `swap(b→a,·)` never returns more
  than `x`; round-trip add-then-remove (no swaps) returns `≤` deposited.
- ❌ FAIL: naive `/` (truncates toward zero, which is caller-favoured in one direction only);
  different rounding primitives in the two directions; no round-trip / no-free-trade test.

```
grep -rn -E "min_out|min_amount_out|max_in|max_amount_in|slippage" programs/
grep -rn -E "fn swap|swap_exact_in|swap_exact_out|flash_swap|swap_callback" programs/   # each must bound slippage
grep -rn -E "mul_div_floor|mul_div_ceil|/ *\(|as u64" programs/ | grep -iE "out|in|amount"
```

---

## 8. Post-CPI vault reload before re-read; Token-2022 delta accounting

An `Account<TokenAccount>` reference is **stale** after any token-transfer CPI until `.reload()` is
called. AMM accounting that reads `vault.amount` post-transfer without reload prices the next
operation against pre-transfer state. With Token-2022 **TransferFee**, the received amount is
strictly less than the sent amount, so accounting must use the *balance delta*, not the declared
`amount`.

**Auditor check**
- ✅ PASS: after every vault transfer, `vault.reload()?` precedes the next read; credited amount =
  `vault.amount_after − vault.amount_before` (checked_sub), so transfer-fee mints are accounted
  correctly; all token movement uses `transfer_checked` (mint + decimals).
- ❌ FAIL: `reserve += amount` after a transfer without reload/delta (mis-accounts fee-on-transfer
  and stale balances); legacy `token::transfer` on a Token-2022-capable pool.
- Beyond `RE-002`/`RE-003` (reload) and `EXT-014` (delta accounting): the AMM angle is that **reserve
  bookkeeping is what gets corrupted**, so a single missed reload mis-prices every subsequent swap.
- Token-2022 extension allow-list (§ cross-cutting): enumerate extensions on every supported mint;
  reject **TransferHook** (reentrancy into swap, §4), **ConfidentialTransfer** (amounts unobservable),
  **NonTransferable / PermanentDelegate** (vault freeze/seizure), **DefaultAccountState=frozen**
  (deposits succeed, withdrawals frozen). Whitelist, don't blacklist. Cross-ref `EXT-012`/`EXT-013`.

```
grep -rn -E "\.reload\(\)" programs/
grep -rn -E "reserve|vault\.amount" programs/ | grep -iE "\+=|checked_add"    # credited from delta or from declared amount?
grep -rn -E "get_extension|TransferHook|TransferFee|PermanentDelegate|DefaultAccountState" programs/
```

---

## 9. Position NFT / share lifecycle

- **Close without fee settlement.** `close_position` must sweep residual (uncollected) fees to the
  owner **before** burning the NFT / zeroing state — otherwise the fees are stranded permanently.
- **Revival.** Burn/close must zero the per-position state (or mark it closed, `0xff`) so the slot
  cannot be reused with attacker state; per-tick `liquidity_net` must be decremented on close.
- **First-depositor inflation (CP).** A direct token donation to the vault before the first LP mint
  must not change shares-per-token for the first depositor — mitigate with a minimum-liquidity lock
  (mint `MIN_LIQ` to a burn/PDA address, irretrievable), donation-aware accounting, or privileged
  init. Cross-ref `ECON-013`–`ECON-017`. (CLMM is largely immune pool-wide since shares are
  per-position, but the same attack exists on the *first position in a fresh tick range*.)

**Auditor check**
- ✅ PASS: `close_position` collects fees → decrements `liquidity_net` → zeroes/marks state → returns
  rent to authority, in that order; requires zero remaining liquidity (or explicitly handles it);
  first CP deposit locks `MIN_LIQ`.
- ❌ FAIL: close before fee collection (stranded fees); state left non-zero after close (revival);
  rent to a caller-supplied destination on a non-admin path; no first-depositor mitigation on a CP
  pool.

```
grep -rn -E "fn close_position|close *=|burn|mint_to" programs/
grep -rn -E "total_supply *== *0|MIN_LIQ|minimum_liquidity|integer_sqrt" programs/   # first-depositor guard present?
```

---

## 10. Bonding-curve launchpad (pump.fun-style) specifics

Beyond the swap-curve checks above, a bonding-curve token launcher has a **graduation** boundary —
the point where the curve migrates its accumulated liquidity into a real AMM pool. This introduces
its own bug surface:

- **Locked-bucket accounting.** Reserves are split into a "real" bucket (redeemable) and a "virtual"
  or "locked" bucket (backs the curve but is reserved for graduation). A swap that draws from the
  locked bucket, or a migration that double-counts a bucket, either drains the graduation liquidity
  or lets holders redeem reserves earmarked for the pool. Verify `real + locked` is conserved and
  that user redemptions can only touch the real bucket.
- **Pre-created-mint freeze authority.** If the token mint is created up-front (before graduation),
  confirm the launcher does **not** retain a mint or freeze authority that lets it mint past the
  curve supply or freeze holders. A residual freeze authority is a rug/DoS vector.
- **Migration DoS / atomicity.** Graduation is a multi-step migration (create pool → seed liquidity
  → hand off authority). Verify it cannot be wedged half-done (funds stuck between curve and pool),
  cannot be front-run to seed the pool at an attacker ratio, and that the trigger threshold can't be
  gamed to migrate early/never. A migration that reverts partway must leave the curve fully
  operational (not bricked).

**Auditor check**
- ✅ PASS: bucket split is a conserved invariant enforced in code; user-facing redemption is bounded
  to the real bucket; no residual mint/freeze authority after (or during) the curve phase; migration
  is idempotent/atomic (or safely resumable) and the seed ratio is fixed by curve state, not caller
  input.
- ❌ FAIL: locked-bucket reserves reachable by ordinary swaps/redemptions; launcher keeps
  freeze/mint authority on the launched mint; migration can strand funds or be front-run to set the
  initial pool price.

```
grep -rn -E "graduat|migrat|bonding|virtual_reserve|real_reserve|locked|complete" programs/
grep -rn -E "freeze_authority|mint_authority|set_authority" programs/    # residual authority on launched mint?
```

---

## 11. TWAP / oracle-accumulator hardening (pool maintains its own price feed)

Many Solana AMMs publish an **on-chain TWAP** other programs consume as an oracle — a running
`Σ(price · Δt)` accumulator plus a last-update timestamp, or a ring of observations. Because the pool
*is* the price source, the accumulator's own arithmetic is a distinct attack surface from the swap
math above. Four failure modes recur across public reports (re-authored here; original findings by
Zenith, Neodyme, Sec3):

- **Wraparound not tracked.** The cumulative sum is expected to overflow and wrap; consumers must take
  the interval as a **wrapping** difference (`now_acc.wrapping_sub(prev_acc)`) over a `u128`(+) type.
  A checked/naive subtraction panics or yields a garbage (or negative) average exactly when the
  accumulator wraps — an attacker times a read across the wrap to force a mispriced TWAP.
- **Saturation over long gaps.** When the pool is idle for a long span, the next update's
  `price · elapsed` term can overflow the step or inject an outsized weight. Use checked/saturating
  math on the step and clamp `elapsed` (or cap the per-update contribution) so a single stale update
  can't spike the average for the next reader.
- **Pre-start-delay / early read.** A freshly-initialized accumulator holds no meaningful history.
  Every consumer must gate on a **minimum elapsed span / minimum observation count** (or an explicit
  `initialized` flag) and return "not ready" rather than a number — never divide by a zero span, and
  never extrapolate a price from an all-zero seed or a single just-written sample.
- **Accrual after the window/proposal ends.** If the TWAP backs a bounded epoch (a governance
  proposal, an auction/TWAP window), updates must **stop contributing once that window closes**; a
  `finalize`/`end_ts` gate freezes the settled value. Otherwise a late interaction re-prices an
  already-decided outcome.

**Auditor check**
- ✅ PASS: accumulator is `u128`+ and consumers use `wrapping_sub` for the interval; the per-step
  `price · elapsed` is checked/saturating with a clamped `elapsed`; every TWAP read is gated on a
  minimum-elapsed / minimum-observation guard (pre-start returns "not ready"); accrual is bounded to
  the measurement window and the finalized value is frozen.
- ❌ FAIL: narrow accumulator or checked/naive interval subtraction (panics/garbage on wrap);
  unbounded `price · elapsed` on a long gap; a TWAP consumed right after init (zero span / div-by-zero
  / single-sample price); observations that keep moving the accumulator after the window/proposal has
  ended.
- Beyond §5 (fee-growth monotonicity is a different accumulator) and `ECON-085`–`ECON-088` (the
  generic internal-accumulator checklist): the AMM angle is that **the pool's published TWAP is itself
  an oracle** — every downstream borrow/settle/mint that trusts it inherits these bugs.

```
grep -rn -E "twap|observation|cumulative|price_x|oracle_index|last_update.*ts|time_weighted" programs/
grep -rn -E "wrapping_sub|checked_sub|checked_mul" programs/ | grep -iE "twap|cumulative|acc|observation|elapsed"
```

*Public reports (re-authored): Zenith (MetaDAO — TWAP accumulator wraparound), Neodyme (MetaDAO AMM —
TWAP accrual after a proposal ended), Sec3 (Raydium — observation-window / early-read handling).*

---

## AMM/CLMM/DLMM checklist (fast pass)

- [ ] Sqrt-price / price·liquidity math uses a 256-bit-equivalent intermediate + checked downcast (§1)
- [ ] Tick→(word,bit) and `bin_id`→array index use **floor** division; boundaries tested at MIN/MAX/−1 (§2, §3)
- [ ] Every bin-array PDA (incl. the adjacent one at a boundary) is re-derived + validated on traversal (§3)
- [ ] Tick/bin crossing updates `liquidity_net` + fee-growth + bitmap atomically, no CPI interleaved (§4)
- [ ] `fee_growth_global` only ever increments; `fee_growth_inside` recomputed from validated ticks (§5)
- [ ] The Crema check: tick/bin/position accounts owner+PDA-validated in **every** handler that reads them (§5, §6)
- [ ] `k` (or stable invariant) never decreases post-fee — invariant-tested (§7a)
- [ ] `min_out`/`max_in` enforced on internal, multi-hop, and flash-swap legs; both `exact_in` and `exact_out` (§7b)
- [ ] Rounding is direction-aware and shared across both swap directions; round-trip yields no free value (§7c)
- [ ] `vault.reload()?` after every transfer; reserves credited from balance delta, not declared amount (§8)
- [ ] Token-2022 extensions allow-listed; TransferHook/Confidential/PermanentDelegate/frozen-default rejected (§8)
- [ ] `close_position` settles residual fees → decrements liquidity → zeroes state → returns rent, in order (§9)
- [ ] First CP deposit cannot be inflated by a pre-mint vault donation (§9)
- [ ] Launchpad: locked/real bucket conserved; no residual mint/freeze authority; migration atomic & non-front-runnable (§10)
- [ ] Published TWAP: `u128` accumulator + wrapping interval diff; gap saturation clamped; early-read gated; no accrual after window/proposal end (§11)

*Public exploit referenced: Crema Finance (2022) — $8.8M, missing tick-account owner check in the
fee-claim path. Invariants above are public protocol mechanics (Uniswap v3 sqrt-price/tick math,
Trader Joe Liquidity Book bin math).*
