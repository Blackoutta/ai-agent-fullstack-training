# 03 — Arithmetic Safety Checklist

> Domain: On-chain Solana Program  
> Severity if missed: CRITICAL to HIGH (financial programs), MEDIUM (non-financial)  
> References: Neodyme "Integer Overflow/Underflow", QEDGen ARITH properties, Rust checked math

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 3.1 — Overflow & Underflow Prevention

- [ ] **AR-001**: Every `+` operation on state-derived or user-supplied values uses `checked_add` with `.ok_or(Error)?`
- [ ] **AR-002**: Every `-` operation on state-derived or user-supplied values uses `checked_sub` with `.ok_or(Error)?`
- [ ] **AR-003**: Every `*` operation on state-derived or user-supplied values uses `checked_mul` with `.ok_or(Error)?`
- [ ] **AR-004**: Every `/` operation on state-derived or user-supplied values uses `checked_div` with `.ok_or(Error)?`
- [ ] **AR-005**: No bare arithmetic operators (`+`, `-`, `*`, `/`, `%`) are used on financial values (grep the entire program for these)
- [ ] **AR-006**: No `saturating_add`, `saturating_sub`, `saturating_mul` on financial paths — these silently cap instead of failing
- [ ] **AR-007**: No `wrapping_add`, `wrapping_sub`, `wrapping_mul` anywhere — these silently wrap
- [ ] **AR-008**: Constants-only arithmetic (e.g., `8 + 32 + 32`) is acceptable without checked_* — verify all operands are truly constant
- [ ] **AR-009**: Anchor's `space` calculation in `#[account(init, space = ...)]` — bare arithmetic is OK here since values are known at compile time

## 3.2 — Intermediate Precision (u128 Widening)

- [ ] **AR-010**: For `a * b / c` patterns, intermediate result `a * b` is computed in `u128` to prevent overflow
- [ ] **AR-011**: For share calculation `(deposit * total_shares) / total_assets` — uses u128 intermediate
- [ ] **AR-012**: For fee calculation `(amount * fee_bps) / 10000` — uses u128 intermediate if amount can be large
- [ ] **AR-013**: For proportion calculation `(amount * fraction) / total` — uses u128 intermediate
- [ ] **AR-014**: After u128 computation, downcast to u64 using `as u64` only after verifying the result fits (or use `u64::try_from()`)
- [ ] **AR-015**: No `as u64` truncation on u128 values without checking if value > u64::MAX
- [ ] **AR-016**: No `as u32` truncation on u64 values without bounds checking
- [ ] **AR-017**: No `as i64` cast on u64 values that could exceed i64::MAX (sign flip vulnerability)

## 3.3 — Division Safety

- [ ] **AR-018**: Every division operation checks that divisor is not zero (either via guard or checked_div)
- [ ] **AR-019**: For share pricing `price = total_assets / total_shares` — guard for `total_shares == 0` case
- [ ] **AR-020**: For withdrawal proportion `fraction = investor_shares / total_shares` — guard for `total_shares == 0`
- [ ] **AR-021**: Division that can truncate to 0 when it shouldn't — is there a minimum output requirement?
- [ ] **AR-022**: Integer division rounding direction — verify it rounds in favor of the protocol (not the user) for share minting
- [ ] **AR-023**: Integer division rounding direction — verify it rounds in favor of the user (not the protocol) for share redemption
- [ ] **AR-024**: Dust amount attacks: can an attacker exploit rounding by making many small deposits/withdrawals to accumulate rounding errors?
- [ ] **AR-025**: First depositor attack: if total_shares == 0, can first depositor manipulate initial share price?

## 3.4 — Share Math Specific

- [ ] **AR-026**: Share minting formula: `shares = deposit_amount * total_shares / total_assets` — verify correctness
- [ ] **AR-027**: Share minting when `total_shares == 0` OR `total_assets == 0` — uses 1:1 ratio (or documented alternative)
- [ ] **AR-028**: Share burning formula: `asset_return = burn_shares * total_assets / total_shares` — verify correctness
- [ ] **AR-029**: Slippage protection on mint: `require!(shares_minted >= min_shares_out)` — is this enforced?
- [ ] **AR-030**: Slippage protection on burn: `require!(assets_returned >= min_assets_out)` — is this enforced?
- [ ] **AR-031**: Inflation attack: can someone donate tokens to the vault to dilute share value for new depositors?
- [ ] **AR-032**: Deflation attack: can someone withdraw in a way that makes remaining shares worth less?
- [ ] **AR-033**: Total shares supply matches sum of all investor positions (invariant check)
- [ ] **AR-034**: Shares mint supply matches `fund.total_shares` (invariant check)

## 3.5 — Fee Calculation

- [ ] **AR-035**: Management fee formula is correct and uses checked math
- [ ] **AR-036**: Performance fee formula is correct and uses checked math
- [ ] **AR-037**: Platform fee (treasury) formula is correct and uses checked math
- [ ] **AR-038**: Fee split: `manager_fee + platform_fee + investor_return == total_amount` — no funds lost or created
- [ ] **AR-039**: Fee basis points: verify `fee_bps <= 10000` (100%) — no fee exceeding 100%
- [ ] **AR-040**: Fee basis points minimum: verify minimum platform fee is enforced
- [ ] **AR-041**: Fee calculation order: fees extracted before or after share calculation? Verify consistency
- [ ] **AR-042**: Compound fee attack: can fees be charged on fees? (fee on withdrawal that includes previous fees)
- [ ] **AR-043**: Zero-value edge case: what happens when fee calculation yields 0? Is 0-amount transfer safe?
- [ ] **AR-062**: When multiple fee/rate components apply to the same operation simultaneously (e.g., trade + platform + creator-share + referral), their **sum** is validated ≤ denominator / 100% at config-set time — not merely each component individually ≤ 100% (independently-valid components can still sum past the total and underflow the residual; see KV-128)

## 3.6 — NAV (Net Asset Value) Safety

- [ ] **AR-044**: NAV calculation includes all token positions held by the fund PDA
- [ ] **AR-045**: NAV calculation uses correct token decimals for each position
- [ ] **AR-046**: NAV calculation handles zero-balance positions correctly
- [ ] **AR-047**: NAV cannot be artificially inflated by the manager (attestation must be honest or verifiable)
- [ ] **AR-048**: NAV cannot be artificially deflated to steal from new depositors
- [ ] **AR-049**: NAV attestation PDA is validated (address re-derived, not just discriminator checked)
- [ ] **AR-050**: Stale NAV: is there a timeout after which NAV attestation is considered stale?

## 3.7 — Lamport & SOL Handling

- [ ] **AR-051**: All lamport values are treated as `u64` — no truncation to smaller types
- [ ] **AR-052**: Lamport transfers check that source has sufficient balance: `source.lamports() >= amount + rent_exempt_minimum`
- [ ] **AR-053**: After lamport manipulation, verify rent exemption is maintained for non-closeable accounts
- [ ] **AR-054**: No instruction can drain an account below rent-exempt minimum without closing it
- [ ] **AR-055**: WSOL handling: wrapping and unwrapping account for correct lamport ↔ token conversion

## 3.8 — Edge Cases

- [ ] **AR-056**: What happens with MAX u64 values as input? Does every path handle it?
- [ ] **AR-057**: What happens with 0 as amount input? Every deposit/withdraw/transfer/fee path
- [ ] **AR-058**: What happens with 1 lamport/token as input? Minimum viable amounts
- [ ] **AR-059**: What happens when fund has exactly 1 share remaining? Edge case in proportional math
- [ ] **AR-060**: What happens when fund has maximum number of investors all withdrawing simultaneously?
- [ ] **AR-061**: Timestamp arithmetic (if used): `Clock::get()?.unix_timestamp` is i64 — check for negative/overflow issues

## 3.9 — Floating-Point in On-Chain Financial Math

> Floating point has no place in on-chain value computation: rounding is non-deterministic across builds/targets, precision is silently lost at scale, `powf`/`sqrt` blow up CU, and `f64 → u64` casts truncate or saturate. Every value/price/fee/interest/exchange-rate path must use fixed-point + checked integer math instead.

- [ ] **AR-063**: No `f64`/`f32` (nor `powf`, `powi`, `sqrt`, `ln`, `exp`, or `as f64`/`as f32` casts) appears in any on-chain value, price, fee, interest, or exchange-rate computation — fixed-point representation with checked integer arithmetic is used instead; any `f64 ↔ u64` boundary cast in a value path is treated as a finding (see KV-128)
