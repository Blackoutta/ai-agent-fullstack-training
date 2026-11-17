# Methodology — Lending & Borrowing (Audit Checks)

> **Load when:** a lending / borrowing / CDP protocol is detected — grep markers:
> `obligation`, `reserve`, `liquidation_threshold`, `borrow_index`, `refresh_reserve`, `ltv`
> (also: `refresh_obligation`, `liquidate_obligation`, `collateral_mint`, `borrowed_value`,
> `exchange_rate`, `close_factor`, `liquidation_bonus`, `flash_loan`, `socialize`/`bad_debt`).
>
> **Purpose:** protocol-specific checks for collateralized lending — pooled markets (Solend/Save,
> Kamino Lend, MarginFi, Larix), isolated markets, CDP / stablecoin issuance, yield aggregators over
> lending, leveraged loops, and flash loans. These sit **on top of** the language-agnostic checklists
> (`checklists/01`–`07`); where a generic check covers the base case the note says *"beyond `<ID>`,
> also verify…"*.
>
> **How to use:** each section is an auditor check — the *safe shape*, the *failure mode*, and a
> *grep*. PASS = safe shape enforced *in code*; FAIL = failure mode reachable. Note the recurring
> theme: **every lending invariant is a stale-state and stale-oracle risk**, so most checks specify
> *"and this still holds mid-CPI and under oracle staleness."*
>
> **Scope & public exploits credited inline:** Solend USDH oracle ($1.26M), Solend governance crisis
> (bad-debt path), Nirvana ($3.5M, spot-price + flash loan), Cashio ($52.8M, unanchored validation
> chain), Jet (whitehat, closed-slot iteration), Loopscale ($5.8M, unpinned oracle account), MarginFi
> (flash-loan state re-check). Invariants (health factors, interest indices) are public DeFi mechanics.

---

## 0. Map the variant(s) first — protocols are usually a blend

| Variant | Defining property | Primary risk shift |
|---|---|---|
| Pooled lending | one reserve per asset, shared | a single bad oracle = whole-pool bad debt |
| Isolated markets | per-group reserves, risk siloed | group config **is** the security boundary |
| CDP / stablecoin issuance | per-user vault, debt is a minted synthetic | mint authority + redemption math are the catastrophe surface |
| Yield aggregator | vault auto-routes into underlying markets | inherits **every** underlying's surface + rebalance/share-price logic |
| Leveraged loops | multi-hop positions in one program or across programs | health must hold **mid-loop**, including failure paths |
| Flash loans | borrow-and-repay in one tx | universal exploit accelerant — every other check must hold *while a $100M flash loan is live* |

Kamino, for example, is pooled lending + leveraged loops + vault aggregator simultaneously —
enumerate the variants before scoping. An aggregator inherits the full risk of each market it
touches.

---

## 1. Interest / borrow index — monotonic per slot, refresh before health math

Cumulative interest is tracked as an index (`borrow_index` / `liquidity_index`, typically Q64.64 or
scaled-int). Two hard requirements:

- **Monotonic per slot.** `new_index ≥ old_index` at **every** accrual point — negative interest is
  impossible. A path that rounds the index *down*, or resets it, lets an active borrower escape
  interest at the dust level (and, compounded, more).
- **Refresh-before-use.** Solana lenders accrue on each touch via `refresh_reserve`; health math is
  only correct if **every health-affecting instruction calls `refresh_reserve` AND `refresh_obligation`
  first, in the same transaction.** Solend's 2022 incidents trace to stale-price / stale-index math;
  reading health off an unrefreshed reserve prices against the past.

**Auditor check**
- ✅ PASS: `refresh_reserve` (index + oracle) and `refresh_obligation` (aggregate collateral/debt
  across **all** referenced reserves) are invoked at the top of `borrow`, `withdraw/redeem`,
  `liquidate`, and any health check — in the same tx — before any comparison; the index update uses
  checked Q64.64 with no downcast and asserts non-decreasing.
- ❌ FAIL: a health branch that reads `reserve`/`obligation` state without a preceding refresh in the
  same tx; an index update that can round down or reset; a `refresh_obligation` that skips a
  reserve passed via `remaining_accounts`.
- Beyond `AR-010`–`AR-017` (precision/widening): the lending-specific rule is *ordering* — refresh
  is a precondition, and a stale index is silently wrong rather than an error.

```
grep -rn -E "refresh_reserve|refresh_obligation|accrue_interest|borrow_index|liquidity_index" programs/
grep -rn -E "fn (borrow|withdraw|redeem|liquidate|.*health)" programs/    # does each refresh first?
```

---

## 2. Rounding always favours the protocol (but bounded)

Every rounding in the reserve↔receipt-token exchange and in debt accounting must favour the
protocol, never the user — and never the protocol *unbounded* (overflow protection still required).

- Receipt minted on deposit: **round down**. Liquidity returned on redeem: **round down**.
- Debt reduction on repay: **round up** (borrower repays at least the true debt). Debt accrual:
  **round up**.
- Receipt-token round-trip: `deposit(x); redeem_all()` returns **≤ x**, never `> x`.

**Auditor check**
- ✅ PASS: a shared rounding helper applies the correct direction per operation; a property test
  asserts the round-trip never exceeds the deposit; debt can never go negative on repay.
- ❌ FAIL: naive `/` where the direction favours the user; a redeem that can return more than
  deposited due to fee inclusion at the wrong rounding; debt underflow on over-repay.
- Beyond `AR-011` (share math u128) / `ECON-013`–`ECON-017` (first-depositor share inflation): the
  lending angle is the **exchange-rate rounding direction** on both mint and redeem, tested as a
  round-trip.

```
grep -rn -E "exchange_rate|collateral_exchange_rate|one_collateral_token|receipt|ctoken" programs/
grep -rn -E "round|floor|ceil|/ *exchange|as u64" programs/ | grep -iE "collateral|liquidity|debt"
```

---

## 3. Oracle integration — six dimensions, all mandatory

The single most-exploited surface in Solana lending. Every price read must enforce **all six**:

1. **Feed identity pin** — the exact expected feed account is hardcoded or PDA-validated
   (`require_keys_eq!` against the Pyth feed / Switchboard aggregator / Scope chain). **Loopscale
   lost $5.8M** because the oracle account was user-supplied with no pin.
2. **Program-ID pin** — `oracle_account.owner == expected_oracle_program`.
3. **Staleness** — `clock.slot − price.publish_slot ≤ MAX_STALENESS` (typical 25–60 slots, which is 5-12 s at 200 ms slots since Oct 2026: re-derive the bound in seconds, KV-138 / ECON-091); stale ⇒
   reject the whole instruction, no silent fallback.
4. **Confidence** — Pyth `conf/price` (or Switchboard variance) below a configured bps cap.
5. **Manipulation resistance** — thin-liquidity assets priced via TWAP/EMA/median-of-N. **Nirvana
   lost $3.5M** using spot price for redemption with a flash loan available that exceeded on-chain
   depth. For collateral use `max(spot, TWAP)`, for debt use `min(spot, TWAP)` — always the
   protocol-conservative side.
6. **Asset-specific clamp** — stablecoins clamp to `min(feed_price, ~1.05)` or use a stablecoin-aware
   feed. **Solend's USDH incident** marked USDH at ~$15 in the health calc; a clamp would have
   rejected it.

**Auditor check**
- ✅ PASS: a single `read_validated_price` gate enforces identity + owner + staleness + confidence
  before returning a price; thin assets carry a TWAP/median; collateral uses `max(spot,TWAP)`, debt
  uses `min(spot,TWAP)`; stablecoins are clamped; no code path reads a raw price field directly.
- ❌ FAIL: a user-supplied oracle account with no `require_keys_eq!`; a price read that skips
  staleness or confidence; spot price used for a thin asset while a flash loan is composable; a
  stablecoin priced off a raw feed with no clamp.
- Beyond `ECON-057`–`ECON-062` (oracle basics): lending requires **identity pinning** and the
  **conservative-side (max-collateral / min-debt)** selection, plus stablecoin clamps — the generic
  checks stop at staleness/confidence.

```
grep -rn -E "publish_slot|prev_slot|conf|confidence|twap|ema|price" programs/
grep -rn -E "require_keys_eq!.*(oracle|feed|aggregator|pyth|switchboard)" programs/   # is the feed account pinned?
```

*Minimum acceptable oracle read (identity + owner + staleness + confidence in one gate):*

```rust
require_keys_eq!(*oracle.key, *expected_feed, ErrorCode::WrongOracleFeed);
require_keys_eq!(*oracle.owner, *expected_owner, ErrorCode::WrongOracleProgram);
let p = parse_price_update(oracle)?;
let age = clock.slot.checked_sub(p.publish_slot).ok_or(ErrorCode::ClockMovedBackwards)?;
require!(age <= MAX_STALENESS, ErrorCode::OraclePriceStale);
let conf_bps = p.conf.checked_mul(10_000).ok_or(ErrorCode::Overflow)?
    .checked_div(p.price).ok_or(ErrorCode::DivisionError)?;
require!(conf_bps <= MAX_CONFIDENCE_BPS, ErrorCode::OracleConfidenceTooWide);
```

---

## 4. Health invariant — holds continuously, mid-CPI, under staleness

For every obligation, `collateral_value / debt_value ≥ liquidation_threshold` while non-liquidatable;
and any obligation with `health < 1.0` **must** be liquidatable. This must hold **at all times**,
including *after a CPI* (use `.reload()` / fresh borrow — never a pre-CPI cached value) and *while the
oracle is at its staleness/confidence bounds*.

A specific historical footgun (Jet, whitehat): iterating a fixed-size position array and `break`-ing
on a `Pubkey::default()` (closed) slot short-circuits the health sum, undercounting debt. **Closed
slots must be `skip`ped, not `break`ed on.**

**Auditor check**
- ✅ PASS: health is computed only from refreshed reserves (§1) and validated prices (§3); any
  post-CPI health decision re-reads state via `.reload()`; position-array iteration treats closed
  slots as `continue`/skip and sums every open slot; the health formula is a property-test target.
- ❌ FAIL: a health check on stale (pre-CPI or unrefreshed) state; iteration that `break`s on a
  default/closed slot; health computed from a directly-read price field.
- Beyond `RE-002`/`RE-003` (reload) and `checklists/05` (state machine): the lending emphasis is that
  a **single** stale-state read in health math is catastrophic (every check is a stale-state risk).

```
grep -rn -E "health|liquidation_threshold|allowed_borrow_value|unhealthy_borrow_value|borrowed_value|deposited_value" programs/
grep -rn -E "break|Pubkey::default\(\)|default\(\)" programs/    # closed-slot short-circuit?
```

---

## 5. Liquidation engine

- **Refresh + re-read at liquidation slot.** Pre-condition `health < 1.0` and post-condition
  `health > 1.0` OR full close, both computed after a same-tx refresh and a **fresh oracle read** —
  never trust a cached price.
- **Partial-liquidation reentry re-check.** With `close_factor < 100%`, a liquidator can re-call to
  drain incrementally; **health must be re-checked between calls** so a position that became healthy
  cannot be liquidated further.
- **Bonus rounding bounded.** `liquidator_repay_value · (1 + bonus_bps)` is the most rounding-sensitive
  expression in the protocol — verify the rounding direction (liquidator-favoured up to the cap) and
  that it cannot overflow even at protocol-max collateral, and that the bonus is bounded so it can't
  itself trigger a cascade.
- **Permissionless completeness (no DoS).** Any liquidatable position must be liquidatable by an
  anonymous caller at bounded cost — no whitelisted-liquidator gate, no required global state, and no
  way for the target to block their own liquidation (freeze their token account, DoS the price
  refresh, or inject a **Token-2022 transfer hook** that reverts/reenters).
- **Self-liquidation == external.** Self-liquidation must be allowed (economically neutral) and must
  produce the **same** outcome as external liquidation modulo fees.

**Auditor check**
- ✅ PASS: liquidation refreshes + re-reads oracles in-tx; partial path re-checks health each call;
  bonus is checked-math, bounded, and rounds within a cap; the path is permissionless with a
  reentrancy guard for Token-2022 sources; `self_liquidate(o) == liquidate(o, attacker)` (mod fees)
  is tested.
- ❌ FAIL: liquidation on a cached price; no health re-check between partial calls; unbounded/overflow-
  prone bonus; a whitelist or hook-DoS that can block liquidation; self-liquidation on a different
  code path with a different outcome.
- Beyond `RE-006` (SOL-spend guard) / `RE-007` (post-CPI owner) / `checklists/06` (economic): the
  lending-specific checks are **partial-reentry health re-check**, **bounded bonus rounding**, and
  **hook-DoS resistance**.

```
grep -rn -E "liquidate|close_factor|liquidation_bonus|repay_amount|withdraw_reserve|borrow_reserve" programs/
grep -rn -E "self_liquidat|is_signer" programs/    # self-liquidation path identical to external?
```

---

## 6. Flash-loan atomicity & side-path state re-check

A flash loan borrows at the start and must repay + fee before the instruction sequence ends,
**checked after all callbacks return** — no mid-flight exit. Two additions specific to Solana:

- **Token-2022 reentrancy.** A transfer hook on the borrowed asset can re-enter the lending program
  mid-flash-loan. Set a reentrancy-guard flag before any transfer and verify the balance invariant
  *after* all CPI returns (not on the last write before transfer). Reject hook mints from
  flash-loanable assets unless allowlisted.
- **Side-path state re-check (the MarginFi class).** Any state a flash loan can touch on a *side
  path* — a health check, an account balance, an accounting field read by another instruction inside
  the same tx — must be re-validated after the callback, not assumed from before it. The exploit
  shape is: flash-borrow → mutate state on a side instruction → the borrow-repay accounting reads a
  value that is no longer true.

**Auditor check**
- ✅ PASS: the borrow-balance invariant is checked after **all** callbacks; a reentrancy flag guards
  the reserve/obligation across transfers; hook mints are excluded from flash-loanable assets or
  allowlisted; any side-path-reachable state is re-read post-callback.
- ❌ FAIL: repayment checked before a callback can run; balance validated on the pre-transfer write;
  a side-path value trusted across the flash-loan callback; hook mint flash-loanable with no guard.
- Beyond `RE-005` (flash-loan NAV inflation): the lending additions are **check-after-all-callbacks**
  and the **side-path re-check**.

```
grep -rn -E "flash_loan|flash_borrow|flash_repay|callback|reentran|guard" programs/
grep -rn -E "transfer_hook|TransferHook|InterfaceAccount" programs/    # hook mints excluded from flash-loanable set?
```

---

## 7. Caps, bad-debt socialization, and solvency

- **Solvency invariant.** For every reserve, `total_supplied ≥ total_borrowed + reserves_taken`
  under conservative pricing — a property-test target over any op sequence.
- **Borrow / supply / utilization caps.** Enforced in code: 100% utilization must be mathematically
  impossible (some reserve held back); above a threshold, new borrows are blocked to prevent a
  rate-spike DoS; withdrawals may be queued/rate-limited under stress. A malicious borrower must not
  be able to cheaply hold utilization at 100% to DoS supplier withdrawals.
- **Bad-debt socialization is a *mechanism*, not a governance override.** When liquidation cannot
  clear a position (`collateral_value < debt_value`), there must be a **permissionless, executable
  `socialize_loss`** path (write down supplier shares proportionally, or draw an insurance fund as
  first-loss) that **converges in bounded time**. The **Solend governance crisis** is the anti-pattern:
  the only crisis response was a multi-day vote to seize one user's wallet (SLND1, later reversed by
  SLND2). If the protocol's only bad-debt path is governance, that **is** the finding.

**Auditor check**
- ✅ PASS: solvency holds under property testing; hard caps (utilization/borrow/supply) enforced in
  the setters and the hot paths with `MIN`/`MAX` constants; a permissionless `socialize_loss` (or
  insurance-fund draw) exists, is callable once liquidation is exhausted, and converges.
- ❌ FAIL: no solvency test; 100% utilization reachable; caps only in docs; **no** protocol-level
  bad-debt mechanism (governance-only) — the Solend-governance-shaped risk.
- Beyond `ECON-071`/`checklists/06` (economic DoS): the lending additions are the **explicit solvency
  invariant** and a **permissionless converging bad-debt path**.

```
grep -rn -E "socialize|bad_debt|write_down|insurance|deficit|utilization|borrow_cap|deposit_cap" programs/
grep -rn -E "total_supplied|total_borrowed|reserves_taken|available_liquidity" programs/
```

---

## 8. LTV / liquidation-threshold parameter governance

LTV / liquidation-threshold are risk knobs owned by governance. Mis-set, every position in the
reserve is instantly liquidatable — the **2021 Solend attempt** tried to set the threshold to 1.

**Auditor check**
- ✅ PASS: changes go through a timelock (≥48h); a hard upper bound (`MAX_LIQ_THRESHOLD ≈ 95%`) and a
  hard lower bound (`MIN_LIQ_THRESHOLD = current_open_LTV + margin`) are asserted **in the
  parameter-setter**, not just docs; every change emits an event for off-chain monitoring; the
  authority is a multisig/governance PDA (not a raw key), with program-upgrade / parameter /
  treasury authorities split.
- ❌ FAIL: threshold settable to an arbitrary value; bounds only documented; single-key admin;
  instant (non-timelocked) change to an active reserve; no event on change.
- Beyond `checklists/07` (opsec/governance): the lending-specific rule is **hard-coded `MIN`/`MAX`
  bounds in the setter** so a wrong signer state still can't brick or mass-liquidate the reserve.

```
grep -rn -E "set_(ltv|threshold|liquidation|config)|MAX_LIQ|MIN_LIQ|timelock" programs/
grep -rn -E "liquidation_threshold|loan_to_value|ltv" programs/ | grep -iE "require|assert|MAX|MIN"
```

---

## 9. Collateral-type specifics (Token-2022, yield tokens)

- **Token-2022 onboarding.** Classify every reserve mint: classic Token / Token-2022 without hooks /
  with hooks. Hooks need explicit allowlisting; **TransferFee** must be integrated into the math
  (internal transfers move net, so debt/collateral accounting must use the post-fee delta — cross-ref
  `EXT-014`). **ConfidentialTransfer** is incompatible (balances unreadable for solvency).
- **Yield-token (PT/YT) collateral discounted by maturity (the Loopscale class).** Principal/yield
  tokens (Pendle-style, or any maturity-bearing receipt) must be valued at a **maturity-aware
  discount**, not at face. Loopscale's $5.8M loss combined an unpinned oracle (§3) with mispriced
  yield-bearing collateral — collateral valued above its redeemable-at-maturity worth lets a borrower
  extract more than the collateral backs.
- **Asset onboarding checklist.** Oracle exists + tested at volume + TWAP/median backup; liquidation
  path tested end-to-end against realistic on-chain liquidity; threshold set with margin from realised
  volatility; the asset can be paused independently.

**Auditor check**
- ✅ PASS: every reserve mint is classified and hostile Token-2022 extensions are rejected/allowlisted;
  fee-on-transfer is delta-accounted; maturity-bearing collateral is discounted by time-to-maturity and
  priced by a pinned feed; each asset is independently pausable.
- ❌ FAIL: a mint onboarded without extension inspection; TransferFee ignored in accounting; PT/YT
  collateral valued at face; an asset with no independent pause.
- Beyond `EXT-012`–`EXT-014`: the lending addition is **maturity-discounted valuation** of yield tokens.

```
grep -rn -E "get_extension|TransferFee|TransferHook|ConfidentialTransfer|DefaultAccountState" programs/
grep -rn -E "maturity|expiry|principal_token|yield_token|pt_|yt_|discount" programs/
```

---

## 10. Cross-cutting: pause, upgrade, admin split

- **Pause affects borrow + flash-loan + liquidation** — not borrow-only. Pause-borrow-only protocols
  have been exploited by liquidators in stale-oracle conditions. Withdrawals should stay open under a
  safety pause (a paused pool that blocks LP withdrawals is a rug).
- **Upgrade authority** — immutable or behind a multi-day timelocked multisig. A `set_upgrade_authority`
  by anyone but the timelock-controlled multisig is a P0.
- **Authority split** — program-upgrade vs parameter-change vs treasury are separate authorities.

```
grep -rn -E "paused|pause|emergency|set_upgrade_authority|upgrade_authority" programs/
```

---

## Lending checklist (fast pass)

- [ ] `refresh_reserve` + `refresh_obligation` run in-tx before **every** health-affecting op; index monotonic per slot (§1)
- [ ] Exchange-rate rounding favours protocol on both mint and redeem; round-trip returns ≤ deposit; debt never negative (§2)
- [ ] Oracle gate enforces identity-pin + owner + staleness + confidence; thin assets use TWAP; `max(spot,TWAP)` collateral / `min` debt; stablecoin clamp (§3)
- [ ] Health holds continuously incl. mid-CPI (`.reload()`) and at oracle bounds; closed slots skipped not `break`ed (§4)
- [ ] Liquidation: in-tx refresh+re-read; partial-reentry health re-check; bounded bonus rounding; permissionless & hook-DoS-proof; self==external (§5)
- [ ] Flash loan: balance invariant checked after **all** callbacks; reentrancy guard; hook mints excluded; side-path state re-checked (§6)
- [ ] Solvency invariant property-tested; utilization/borrow/supply caps in code; permissionless converging bad-debt path exists (§7)
- [ ] LTV/threshold: timelock + hard `MIN`/`MAX` in the setter + event; multisig authority, split roles (§8)
- [ ] Token-2022 extensions classified/allowlisted, fee-on-transfer delta-accounted; PT/YT collateral maturity-discounted & pinned-oracle-priced (§9)
- [ ] Pause covers borrow+flash-loan+liquidation, leaves withdrawals open; upgrade authority timelocked; authorities split (§10)

*Public exploits referenced: Solend USDH oracle (2022, $1.26M), Solend governance crisis (2022,
bad-debt-as-mechanism lesson), Solend LTV-to-1 attempt (2021), Nirvana (2022, $3.5M), Cashio (2022,
$52.8M), Jet (whitehat, closed-slot iteration), Loopscale (2025, $5.8M), MarginFi (flash-loan
side-path). Health-factor and interest-index mechanics are public DeFi primitives.*
