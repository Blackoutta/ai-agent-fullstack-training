# Methodology — Perps & Derivatives (Audit Checks)

> **Load when:** a perpetuals / derivatives protocol is detected — grep markers:
> `funding_rate`, `mark_price`, `open_interest`, `maintenance_margin`, `insurance_fund`, `vamm`, `perp`
> (also: `index_price`, `initial_margin`/`im`, `mm`, `position_size`, `settle_pnl`, `settle_funding`,
> `liquidate_position`, `sub_account`, `adl`, `peg`, `oracle` config accounts).
>
> **Purpose:** protocol-specific checks for perpetual swaps, options, and funding-rate derivatives —
> vAMM (Drift), on-chain orderbook (Mango v4), pool-vs-trader / RFQ (Jupiter Perps, GMX-Solana,
> Adrena), options (Zeta), prediction markets (Monaco), leverage aggregators (Lavarage, RateX). These
> sit **on top of** the language-agnostic checklists (`checklists/01`–`07`); where a generic check
> covers the base case the note says *"beyond `<ID>`, also verify…"*.
>
> **How to use:** each section is an auditor check — *safe shape*, *failure mode*, *grep*. PASS = safe
> shape enforced *in code*; FAIL = failure mode reachable.
>
> **Why this surface is the highest-stakes on Solana:** derivatives combine oracles, margin math,
> liquidation, cross-program collateral, and governance into one product where a single bug is
> typically fund-draining. The **Mango Markets exploit ($115M)** is the canonical lesson and every
> section here is downstream of it. Other public exploits credited inline: Cypher ($1M, sub-account
> isolation), Cypher insider (residual admin key), Drift (governance + durable-nonce), Offside/RateX
> (funding-as-collateral), Jupiter Perps (RFQ single-sided pricing). Funding-rate and margin mechanics
> are public derivatives math.

---

## 0. Mechanism design determines the threat model

Identify the architecture first — the dominant failure modes differ:

| Architecture | Examples | Dominant risks |
|---|---|---|
| vAMM (virtual, no real reserves) | Drift v2 | vAMM curve/peg manipulation, k-recentering, mark-vs-oracle funding divergence |
| On-chain orderbook | Mango v4, Phoenix-backed | crank DoS, match/settlement racing, self-trade bypass, partial-fill rounding |
| Pool-vs-trader / RFQ | Jupiter Perps, GMX-Solana, Adrena | single-sided price feed (no book to anchor), LP-exit timing, RFQ spoof/replay, oracle-staleness arbitrage |
| Options | Zeta, PsyOptions, 01 | IV-parameter staleness, settlement-window timing, exercise-vs-expiry race, collateral-release timing |
| Prediction markets | Monaco | resolution-oracle finality (irreversible once settled) |
| Leverage aggregator | Lavarage, RateX | marketplace liquidation logic, funding-as-collateral valuation |

---

## 1. Oracle composition — the Mango invariant (mark vs index vs oracle)

The **Mango Markets exploit ($115M)** mechanics: attacker pumped a thin MNGO/USD spot market ~22× with
~$5M, Mango's MNGO-PERP mark was a median of three feeds **all reading the same thin spot venues**, the
attacker's position showed ~$423M paper PnL, and they borrowed $115M against it. The fix is **not** "a
better oracle" — it is **multiple independent defenses**:

- **Mark-vs-index bounded discrepancy.** Mark (used for PnL/liquidation) must not deviate from a robust
  index (median-of-independent-oracles or TWAP) beyond a configured tolerance.
- **Confidence gating.** Reject wide-confidence prices (Pyth `conf/price` above a bps cap; Switchboard
  variance equivalent).
- **Staleness gating.** Reject prices older than `MAX_STALENESS` slots.
- **TWAP cross-check.** Spot must agree with a longer TWAP within a bound before it is trusted.
- **Independent sources.** The feeds combined into the index must not all derive from the same venue.

**Auditor check**
- ✅ PASS: a single mark/index gate enforces staleness + confidence + TWAP-agreement + independent
  sources; mark cannot diverge from the index beyond tolerance; the price used for PnL/liquidation is
  the gated one, never a raw field.
- ❌ FAIL: mark = median of correlated thin-market feeds; any price read without staleness+confidence;
  no TWAP cross-check; mark and index can diverge unboundedly.
- Beyond `ECON-057`–`ECON-062` (oracle basics): perps require the **mark-vs-index divergence bound**
  and the **independent-source** requirement — a median of three correlated feeds passes the generic
  checks and still fails here.

```
grep -rn -E "mark_price|index_price|oracle_price|median|twap|conf|confidence" programs/
grep -rn -E "publish_slot|staleness|divergence|spread" programs/    # is mark bounded to index + gated?
```

*Vulnerable → fixed (the Mango class):*

```rust
// vulnerable — median of three feeds that all read the same thin spot venue
let mut p = [a.price, b.price, c.price]; p.sort(); Ok(p[1])
```

```rust
// fixed — staleness + confidence + TWAP-agreement + position cap (defense-in-depth)
require!(pyth.publish_slot >= clock.slot - 25, ErrorCode::StaleOracle);
require!(pyth.conf.checked_mul(100).ok_or(ErrorCode::Math)? < pyth.price as u64, ErrorCode::WideConfidence);
let spread = (pyth.price - twap_30min).abs();
require!(spread.checked_mul(100).ok_or(ErrorCode::Math)? / twap_30min < 5, ErrorCode::TwapDivergence);
require!(position_size <= market_oi_cap, ErrorCode::PositionLimitExceeded);   // see §2
```

---

## 2. Position caps & open-interest symmetry

- **Per-account & per-market size caps.** A single position must not be able to corner a thin market —
  the Mango exploit succeeded partly because **no per-account cap existed for MNGO-PERP**. Caps must be
  enforced at placement and after any size-increasing settlement.
- **OI symmetry.** For every market, `Σ long_size == Σ short_size` within rounding tolerance. Asymmetry
  means a fill/settlement bug is minting or burning open interest — a property-test target.
- **Permissionless-listing amplification.** Community-listed markets multiply the thin-market risk;
  per-market caps and listing-vote thresholds are mandatory when listing is open.

**Auditor check**
- ✅ PASS: `position_size ≤ per_account_cap` and market OI ≤ `market_oi_cap` checked on `place_order`
  and post-settlement; an OI-symmetry property test passes over random op sequences; listed markets
  carry caps regardless of who listed them.
- ❌ FAIL: no per-account/per-market cap on a thin market; OI can drift asymmetric; permissionless
  listing with no cap.
- Beyond `checklists/06` (economic): the perps-specific invariants are **OI symmetry** and **hard
  position caps** as a Mango countermeasure.

```
grep -rn -E "position_size|open_interest|oi_cap|max_position|long_.*short|size_cap" programs/
grep -rn -E "list_market|add_market|permissionless" programs/    # listed markets carry caps?
```

---

## 3. Funding-rate math: precision, cadence, settlement ordering

Funding rate = `(mark − index) / index · period_factor`. Bugs hide in three places:

- **Precision-loss truncation.** Integer division of a small `mark − index` spread rounds to **zero**,
  freezing funding (`(1.0001 − 1.0000)/1.0000 → 0`). Scale **before** dividing; use signed checked math.
- **Accrual cadence.** Per-slot vs per-hour vs per-period accrual mismatches let a trader pay one rate
  and receive another. The cadence must be consistent between the debit and credit sides.
- **Settlement ordering (the Offside/RateX class).** Funding settled *before* liquidation can let an
  about-to-be-liquidated position pay/receive funding that should have gone to the liquidator — the
  order of `settle_funding` vs `liquidate` vs `settle_pnl` changes who gets the value. Funding-as-
  collateral (RateX rate derivatives) makes this accounting the core asset, so the ordering bug is
  amplified.

**Auditor check**
- ✅ PASS: funding scales by a `FUNDING_PRECISION` factor before dividing (checked, signed); debit and
  credit use the same cadence; the settlement order (funding → PnL → liquidation, or a documented,
  tested alternative) is fixed and cannot be reordered to extract value; funding accrual is monotonic
  in elapsed time.
- ❌ FAIL: `(mark − index) / index` with no pre-scaling (truncates small spreads); mismatched cadence
  between sides; settlement order lets a soon-to-be-liquidated position capture funding; funding
  symmetry not tested.

```
grep -rn -E "funding_rate|funding_index|cumulative_funding|settle_funding|FUNDING_PRECISION" programs/
grep -rn -E "/ *index|/ *index_price" programs/    # scaled before division?
```

*Funding symmetry invariant:* total long-side debit == total short-side credit — the protocol must not
silently mint/burn value via funding. Property-test it alongside OI symmetry (§2).

---

## 4. Margin math: haircuts, IM/MM at placement AND post-settlement

- **Collateral haircuts.** Cross-margin collateral is summed with per-asset **haircuts** based on
  liquidity and oracle confidence; volatile collateral is discounted (e.g. SOL at 80%). Token-2022
  collateral with transfer fees is valued **post-fee**. `u128` intermediates + normalized decimals.
- **IM at placement, MM continuously.** Initial margin gates opening; maintenance margin gates
  liquidation. Both must be enforced **at order placement and again after any settlement** that changes
  the position — a position that passes IM at open but drops below MM after funding/PnL settlement must
  be liquidatable on the next slot (no grace period).
- **Withdraw leaves an IM buffer.** `withdraw_collateral` must leave post-withdraw health ≥ **IM**
  (not merely MM), and be bounded by *free* collateral, not total.

**Auditor check**
- ✅ PASS: `collateral_value` uses `u128`, applies the haircut, normalizes decimals, and values
  Token-2022 collateral post-fee; IM checked post-order, MM checked post-settlement; withdraw requires
  ≥ IM on free collateral and reloads after the token CPI.
- ❌ FAIL: `u64` collateral math or missing haircut on volatile collateral; IM/MM checked only at open;
  withdraw checks MM (not IM) or uses total (not free) collateral; no reload after withdraw CPI.
- Beyond `AR-010`–`AR-017` (widening/truncation) and `checklists/06`: the perps additions are the
  **haircut**, the **post-settlement MM re-check**, and the **IM buffer on withdraw**.

```
grep -rn -E "collateral_value|haircut|initial_margin|maintenance_margin|free_collateral|margin_ratio" programs/
grep -rn -E "fn withdraw|withdraw_collateral" programs/    # post-withdraw health >= IM on free collateral?
```

---

## 5. Cross-margin sub-account isolation (the Cypher class)

**Cypher lost $1M** to a sub-account isolation failure: a bug in how cross-margin separated
sub-account collateral let one sub-account access another's funds. Cross-margin accounting is
per-`(account, sub_account)` and **must be enforced at every read** — collateral, debt, health, and
settlement must all key on the correct sub-account, and one sub-account's positions must never be able
to draw on another's collateral.

**Auditor check**
- ✅ PASS: every collateral/debt/health read and every settlement is scoped to the exact
  `(account, sub_account)` pair, validated against the signer; a property/fuzz test attempts to make
  one sub-account spend another's collateral and it fails.
- ❌ FAIL: a shared-collateral read that doesn't pin the sub-account; a settlement that credits/debits
  the wrong sub-account; isolation assumed but not enforced on a side path.
- Beyond `checklists/01`–`02` (account validation / access control): the perps-specific angle is the
  **sub-account** as the isolation boundary — a correct account check that ignores the sub-account
  still fails.

```
grep -rn -E "sub_account|subaccount|account_index|margin_account|cross_margin" programs/
```

---

## 6. Liquidation engine

Liquidation must be (a) permissionless with reward, (b) partial-fill capable, (c) ordered
**most-underwater-first**, (d) reward computed **after** the health re-check.

- **Health re-read at liquidation slot** — re-read the oracle (§1), don't trust a cached mark.
- **Partial liquidation** reduces to a target health, not to zero, so a large position doesn't require
  a single equally-large liquidator; the reward is capped.
- **Reward after health check** — computing the liquidator reward *before* the health check enables a
  self-liquidation arbitrage; the reward must be a function of the confirmed-underwater amount.
- **DoS resistance** — cannot be blocked by spamming small token-account reallocation, by a Token-2022
  transfer hook, or by a griefing false-flag; reward tuned so healthy positions aren't griefed.

**Auditor check**
- ✅ PASS: liquidation is permissionless, re-reads the oracle in-tx, liquidates most-underwater first,
  supports partial closure to a target health, computes reward ≤ cap **after** confirming `health < MM`,
  routes bad debt to the insurance fund (§7), and pays gas/reward in the same instruction; hook/realloc
  DoS is guarded.
- ❌ FAIL: reward computed before the health check; all-or-nothing liquidation; cached-price
  liquidation; reward uncapped or high enough to grief healthy positions; hook/realloc can block it.
- Beyond `RE-006`/`RE-007` (SOL-spend / post-CPI owner) and `ECON-007` (MEV): the perps additions are
  **most-underwater-first ordering** and **reward-after-health-recheck**.

```
grep -rn -E "liquidate|liquidation_reward|partial|target_health|most_underwater|health" programs/
grep -rn -E "reward.*health|health.*reward" programs/    # is reward computed after the health check?
```

---

## 7. Insurance fund & deterministic ADL

Bad debt from under-collateralized liquidations is absorbed by the insurance fund (funded by
liquidation + protocol fees). Requirements:

- **Never negative.** Total claims on the fund never exceed its balance + future fees; fund accounting
  is reconciled to the actual on-chain SOL/USDC balance (not a decoupled counter).
- **Deterministic ADL fallback.** When the fund is insufficient, auto-deleveraging (ADL) / socialized
  loss must be **deterministic** — a defined order (e.g. highest-profit opposite positions first), not
  ad-hoc — so it is predictable and cannot be gamed; the accounting path must converge.
- **Settlement bounded by collateral.** `settle_pnl` cannot settle negative PnL into the vault beyond
  an account's collateral; the socialized-loss / ADL path triggers when the fund can't cover.

**Auditor check**
- ✅ PASS: an invariant test asserts fund balance ≥ 0 and reconciles to real balance; ADL follows a
  fixed deterministic order and converges; `settle_pnl` is bounded by per-account collateral with a
  defined socialized-loss trigger.
- ❌ FAIL: fund accounting decoupled from actual balance; ADL order undefined/ad-hoc; negative PnL
  settleable into the vault past collateral; claims paid in the wrong order.
- Beyond `checklists/06`: the perps additions are **insurance-fund non-negativity as a tested
  invariant** and **deterministic ADL**.

```
grep -rn -E "insurance_fund|insurance|adl|auto_deleverage|socialized|bad_debt|deficit" programs/
grep -rn -E "settle_pnl|realize_pnl|unrealized" programs/    # bounded by collateral, ADL trigger defined?
```

---

## 8. vAMM peg / k-recentering (the Drift class) & settlement price source

- **vAMM curve manipulation & peg abuse.** A vAMM has no real reserves; its `k` and peg-multiplier are
  admin/algorithm-adjusted. k-recentering or peg changes that can be triggered or front-run let an
  attacker move the vAMM mark independently of the oracle. Verify recentering is bounded, cannot be
  attacker-triggered at an adversarial time, and that funding pins the vAMM mark to the oracle index so
  divergence is arbitraged/penalized rather than exploited.
- **Settlement PnL from TWAP, not spot.** `settle_pnl` must compute from a **settlement price (TWAP at
  settlement)**, not spot at call time — spot at call time is manipulable by the caller.
- **Unrealized PnL bounded/capped as collateral (the Mango class).** Unrealized (paper) PnL used as
  collateral for further borrowing must be **capped/haircut** — the Mango attacker borrowed against
  ~$423M of unrealized PnL. Cap the fraction of unrealized PnL usable as margin, or exclude it.

**Auditor check**
- ✅ PASS: vAMM recentering/peg changes are bounded, non-attacker-triggerable, and funding-anchored to
  the oracle; `settle_pnl` uses a settlement TWAP; unrealized PnL is capped/haircut before counting as
  collateral.
- ❌ FAIL: peg/k recenterable at an adversarial time or front-runnable; settlement from spot-at-call;
  full unrealized PnL usable as borrowing collateral.
- Beyond §1 (oracle) / §4 (margin): the additions are **vAMM peg discipline**, **TWAP settlement**, and
  the **unrealized-PnL cap**.

```
grep -rn -E "peg|peg_multiplier|k_recenter|recenter|update_amm|vamm|sqrt_k" programs/
grep -rn -E "settle_pnl|settlement_price|unrealized|upnl" programs/    # TWAP settlement + uPnL cap?
```

---

## 9. Admin, governance whitelist & durable-nonce (the Drift class)

**Drift's incident** abused the Security Council's instruction-whitelist (fast-track execution) via a
**durable-nonce pre-signed transaction** executed outside its intended context. Two cross-cutting
requirements:

- **Durable-nonce `valid_until_slot` on admin tx.** Any admin/council instruction signed with a durable
  nonce can be **replayed indefinitely** until the nonce advances — a leaked pre-signed "pause" or
  council action fires at the attacker's chosen time (e.g. pausing during a liquidation cascade to
  block liquidations). Time-bound every admin instruction: include a `valid_until_slot` and reject if
  `Clock::get()?.slot > valid_until_slot`. Cross-ref the durable-nonce vector.
- **Fast-track paths still have hold-up time.** Every "council-only" / "fast-track" instruction is an
  emergency-authority; enumerate them, enforce a minimum hold-up (not zero), and audit who can
  add/remove from the whitelist and at what scope.
- **Oracle key pinning under governance.** Every oracle account pubkey is stored in a config account
  whose update path is council-gated + timelocked + event-logged. An attacker who swaps an oracle
  pubkey immediately points the risk model at their own feed.
- **Insurance-fund withdrawals / market-param changes** (IM/MM tiers, thresholds, caps) are
  high-threshold, timelocked (24h+), multisig.
- **Residual admin keys (Cypher-insider class).** After any incident or launch, residual admin keys are
  a continuing attack surface — enumerate and revoke.

**Auditor check**
- ✅ PASS: admin/council instructions carry `valid_until_slot`; fast-track paths have a non-zero hold-up
  and an audited whitelist mechanism; oracle pubkeys are config-stored with council+timelock+event
  update; param/insurance changes are timelocked multisig; no unaccounted residual admin key.
- ❌ FAIL: durable-nonce admin tx with no time bound; zero-delay fast-track; oracle pubkey swappable by
  a single key or a faulty `update_oracle`; residual admin authority.
- Beyond `checklists/07` (opsec/governance): the perps-specific additions are **`valid_until_slot` on
  admin tx**, **fast-track hold-up time**, and **oracle-pubkey pinning under governance**.

```
grep -rn -E "valid_until_slot|durable_nonce|nonce|whitelist|fast_track|council|security_council" programs/
grep -rn -E "update_oracle|set_oracle|oracle_config|set_authority|upgrade_authority" programs/
```

---

## 10. Orderbook / RFQ / options specifics (as applicable)

- **Orderbook (Mango/Phoenix-backed):** crank reward proportional to actual fills (not order count) so
  no-op cranks can't drain; self-trade prevention not bypassable; partial-fill rounding favours the
  protocol; settlement atomic (no half-filled state); crank cannot reorder events to extract MEV.
- **RFQ / pool-vs-trader (Jupiter Perps, Adrena):** off-chain RFQ prices need a **per-tx nonce +
  signature-freshness gate** — a spoofable/replayable/front-runnable RFQ signer gives the pool adverse
  selection. LP-exit timing and asymmetric fees must not let an LP dodge tail risk.
- **Options (Zeta/PsyOptions):** IV parameter staleness, settlement-window timing, exercise-vs-expiry
  race, and collateral-release timing are the foreground concerns; Black-Scholes / Bjerksund-Stensland
  on-chain pricing is CU-heavy and precision-sensitive.
- **Prediction markets (Monaco):** resolution is irreversible once settled — the resolution oracle is
  the dominant risk.

```
grep -rn -E "crank|match_order|self_trade|partial_fill|rfq|signature|nonce|settle" programs/
grep -rn -E "implied_vol|iv|expiry|exercise|black_scholes|resolve|resolution" programs/
```

---

## 11. CU exhaustion on adversarial inputs

Adversarial inputs — many positions, many small fills, many `remaining_accounts`, a liquidation that
must traverse a large book — can DoS via compute-unit exhaustion, wedging the protocol in a
partially-processed state.

**Auditor check**
- ✅ PASS: worst-case-adversarial CU is bounded and tested (`sol_log_compute_units!()`, assert
  `< 1.4M`); operations that can grow unboundedly (fills, accounts, positions) have a per-tx cap or a
  resumable/partial design.
- ❌ FAIL: an unbounded traversal with no cap; no CU test on adversarial worst case.

```
grep -rn -E "remaining_accounts|for .* in|while|loop" programs/    # unbounded traversal on a hot path?
```

---

## 12. Keeper request→execute lifecycle (two-step order flow)

Pool-vs-trader and RFQ perps (Jupiter Perps, GMX-Solana, Adrena) split an order into **two
transactions**: the user submits a *request* (open/increase/decrease/close), then a **keeper/crank**
executes it against a price fetched at execution time. That gap between submit and execute is a rich
surface — the user can react to price *after* requesting, and the keeper is a privileged actor who
chooses ordering, timing, and (if under-validated) which program/callback to hit. Public reports:
Zenith (GMX-Solana — keeper reordering for MEV, claimable-close rent theft), OtterSec (Jupiter Perps
— front-running position execution, malicious-keeper wrong-program-id), Neodyme (Drift keeper paths).

- **Request parameters locked at submission.** Everything that determines value — size, leverage,
  collateral delta, direction, `min_out`/acceptable-price bound — is **frozen into the request PDA at
  submit time** and cannot be mutated before the keeper executes. If a user can edit the pending
  request (or submit-then-amend) after observing a price move, they get a free option: submit at
  T0, watch the oracle, cancel/mutate the ones that went against them, let the favorable ones execute.
  (Front-running position execution — OtterSec Jupiter.)
- **Price bound to the request's slot/context.** The keeper must execute against a price that is fresh
  **and** consistent with the request — an `acceptable_price`/slippage bound the user committed to at
  submit, and an oracle read gated to the request's slot window (staleness §1). A keeper that can pick
  a stale or out-of-window price, or ignore the user's committed bound, prices the fill adversarially.
- **Close / claimable-close requires no pending request.** Any path that settles, closes, or claims a
  position (or reclaims its rent / claimable balance) must assert the position has **no in-flight
  request** against it. Closing while a request is pending lets the keeper (or user) double-spend the
  position or steal the rent/claimable of an order that should still be live. (Claimable-close rent
  theft — Zenith GMX-Solana.)
- **Keeper cannot reorder/omit callbacks for MEV, or misdirect them.** Where execution invokes a
  callback (into the perp program or a listener), the keeper must not be able to (a) reorder or drop
  pending requests to extract MEV — e.g. execute a large open just before a favorable move and defer
  the rest, or (b) point the callback at an **attacker-chosen program id**. The callback target
  program must be pinned/validated (not taken from keeper input), and execution ordering must not be a
  keeper-chosen value lever (FIFO / price-time, or economically neutral). (Keeper reordering MEV —
  Zenith; malicious keeper wrong-program-id — OtterSec.)

**Auditor check**
- ✅ PASS: request PDA freezes size/leverage/collateral/direction/price-bound at submit and is
  immutable until executed; the keeper executes against an oracle read gated to the request slot and
  honors the user's committed `acceptable_price`; every close/settle/claim path asserts
  `no_pending_request`; the callback target program id is pinned (not keeper-supplied) and the keeper
  cannot reorder/omit requests to extract value.
- ❌ FAIL: a pending request's parameters are user-mutable after submission (free option on price); the
  keeper can execute at a stale/out-of-window price or ignore the committed bound; close/claim runs
  with an in-flight request (double-spend / rent theft); callback program id comes from keeper input,
  or request ordering is a keeper-controlled MEV lever.
- Beyond §1 (oracle staleness) / §6 (liquidation) / §9 (admin durable-nonce): the two-step-order
  additions are **submit-time parameter lock**, **price-bound-to-request-slot**, the
  **no-pending-request assertion on close**, and **keeper callback/ordering integrity**. Cross-ref
  KV-129.

```
grep -rn -E "request|pending|execute_(order|request|position)|keeper|crank|callback|acceptable_price" programs/
grep -rn -E "close|claimable|settle|cancel" programs/ | grep -iE "pending|request|no_pending"   # close gated on no in-flight request?
```

---

## Perps checklist (fast pass)

- [ ] Mark gated by staleness+confidence+TWAP-agreement+independent sources; mark-vs-index divergence bounded (§1)
- [ ] Per-account & per-market position caps enforced at placement and post-settlement; OI symmetry property-tested (§2)
- [ ] Funding scaled before division (no truncation-to-zero); cadence consistent; settlement order fixed & non-extractable; funding symmetry tested (§3)
- [ ] Collateral haircuts applied (post-fee for Token-2022); IM at placement AND MM post-settlement; withdraw leaves IM buffer on free collateral (§4)
- [ ] Cross-margin reads/settlement scoped to `(account, sub_account)`; isolation fuzz-tested (§5)
- [ ] Liquidation permissionless, oracle-re-read, most-underwater-first, partial-to-target, reward-after-health-recheck & capped, DoS-guarded (§6)
- [ ] Insurance fund non-negative (reconciled to real balance) & tested; ADL deterministic; settle_pnl bounded by collateral (§7)
- [ ] vAMM peg/k-recentering bounded & non-front-runnable; settlement PnL from TWAP; unrealized PnL capped as collateral (§8)
- [ ] Admin tx carry `valid_until_slot`; fast-track hold-up > 0; oracle pubkeys config-pinned (council+timelock+event); residual admin keys revoked (§9)
- [ ] Orderbook/RFQ/options specifics honored (crank-reward-from-fills, RFQ nonce+freshness, IV/expiry timing) (§10)
- [ ] Worst-case adversarial CU bounded & tested; unbounded traversals capped/resumable (§11)
- [ ] Two-step orders: request params locked at submit; price bound to request slot; close asserts no pending request; keeper callback/ordering can't be gamed (§12)

*Public exploits & reports referenced: Mango Markets (2022, $115M — oracle composition + no position
cap + unrealized-PnL-as-collateral), Cypher (2023, $1M — sub-account isolation), Cypher insider (2024
— residual admin key), Drift (2026 — governance whitelist + durable-nonce), Offside/RateX (funding
settlement ordering), Jupiter Perps (RFQ single-sided pricing; OtterSec — execution front-running,
malicious-keeper wrong-program-id), GMX-Solana (Zenith — keeper reordering MEV, claimable-close rent
theft). Funding-rate, margin, and mark/index mechanics are public derivatives math.*
