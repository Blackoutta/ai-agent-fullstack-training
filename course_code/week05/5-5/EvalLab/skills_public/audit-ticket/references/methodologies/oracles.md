# Methodology — Oracles & Price Feeds (Audit Checks)

> **Load when:** oracle / price-feed consumption detected — grep markers:
> `pyth`, `switchboard`, `PriceUpdateV2`, `get_price_no_older_than`, `PullFeed`,
> `confidence`, `conf`, `std_dev`, `expo`, `publish_time`, `oracle`, `twap`.
>
> **Purpose:** What to verify at every call site that turns an external price into an
> on-chain decision (lending health, perp mark, stablecoin mint/redeem, vault NAV,
> oracle-anchored swap). Oracle handling is *per-call-site*, not per-instruction — run
> this list every time a feed account is touched.
>
> **Shared dependency.** Lending, perps, and stablecoin (`stablecoin.md`) all inherit
> this file. Read alongside `checklists/01` (account validation), `checklists/03`
> (arithmetic), `checklists/06` (economic logic).
>
> **Public exploit provenance:** feed substitution, ignored confidence, and thin-market
> spot are the loss leaders of Solana DeFi. Credited public incidents: Mango Markets
> ($115M, thin-market vAMM mark), Nirvana ($3.5M, flash-loaned spot on a redemption
> curve), Cashio ($52M, unvalidated account chain into a mint), plus the recurring
> stale-price / confidence-ignored class across lending forks.

---

## 1. Feed identity pinned — deserializing as a price feed proves nothing

A `PriceUpdateV2` (or `PullFeed`, or legacy `PriceAccount`) that *deserializes* is not a
feed you can trust. Any account whose bytes match the layout will parse. The check that
matters is: **is this the pubkey I expected?** — either a hard-coded constant or a
governance-stored value on a sibling account (`market.oracle`).

**Auditor check**
- PASS: `require_keys_eq!(feed.key(), EXPECTED_SOL_USD_FEED, ...)` against a constant, or
  against a stored `market.oracle` set at init and changeable only behind a timelock.
- FAIL: the feed account is read and priced with no key comparison — the program prices
  collateral with whatever account the caller passed. This is the single most damaging and
  most preventable oracle bug (feed-substitution class).

```
grep -rn -E "PriceUpdateV2|PullFeed|price_update|\.feed" programs/
grep -rn -E "require_keys_eq!|EXPECTED_.*FEED|\.oracle" programs/   # is the key actually pinned?
```

---

## 2. Provider-program-ID pinned — type-confusion across oracle vendors

Even with the key pinned, confirm the account is **owned by the expected oracle program**.
Without an owner check, a Switchboard-shaped account can be slotted where the program
expects Pyth (or vice versa), and a hand-rolled deserializer reads adversary-chosen fields.
Anchor's `Account<'info, PriceUpdateV2>` enforces `owner == pyth_solana_receiver_sdk::ID`
for free — the risk is the `AccountInfo` / manual-deserialize downgrade.

**Auditor check**
- PASS: explicit `feed.owner == &pyth_solana_receiver_sdk::ID` (or `switchboard_on_demand::ID`),
  or an Anchor typed wrapper that enforces it.
- FAIL: raw `AccountInfo` + `try_from_slice` with no owner assertion — Pyth↔Switchboard
  type confusion is open.

```
grep -rn -E "\.owner ==|owner\(\)|pyth_solana_receiver_sdk::ID|switchboard" programs/
grep -rn -E "try_from_slice|try_deserialize|from_bytes" programs/   # manual parse = check owner by hand
```

---

## 3. Staleness gate — the SDK call that checks it vs. the one that doesn't

For Pyth pull, `get_price_no_older_than(&clock, MAX_AGE, &feed_id)` checks feed-id match
**and** `clock.unix_timestamp - publish_time <= MAX_AGE` in one call. Its sibling
`get_price_unchecked` does **neither** — it hands back the last-posted price with no
freshness or feed-id guarantee. `get_price_unchecked` with no manual staleness check is a
finding on any value-transfer path.

`MAX_AGE` is risk-calibrated, not a magic number:

| Action | `MAX_AGE` guidance | A value of… is a finding |
|---|---|---|
| Perp liquidation / mark | ≤ 10s | ≥ 60s |
| Lending health check | ≤ 60s | ≥ 300s |
| Stablecoin mint / redeem | ≤ 30s | ≥ 120s |
| Governance-priced action | context-specific | unbounded |

**Auditor check**
- PASS: `get_price_no_older_than(...)`, or `get_price_unchecked` *followed by* an explicit
  `now - publish_time <= MAX_AGE` assert, with `MAX_AGE` appropriate to the action.
- FAIL: `get_price_unchecked` alone; or a `MAX_AGE` far too loose for the action's risk; or
  a staleness check on a Switchboard/legacy feed that reads a stale `round_open_slot`.

```
grep -rn -E "get_price_unchecked|get_price_no_older_than|publish_time|posted_slot" programs/
grep -rn -E "MAX_AGE|MAX_STALENESS|unix_timestamp" programs/
```

---

## 4. `verification_level == Full` on Pyth pull — reject `Partial`

`PriceUpdateV2` carries a `verification_level`. A `Partial` update means only a subset of
the Wormhole guardian signatures on the price message were verified when it was posted —
cheaper to post, weaker guarantee. High-value actions must require `Full`. The
`PriceUpdateV2` account is itself a PDA written by the receiver program after VAA
verification; if you hand-roll the VAA path instead of using the receiver SDK, you must
verify the guardian-signature chain yourself.

**Auditor check**
- PASS: `require!(price_update.verification_level == VerificationLevel::Full, ...)` before
  any pricing that moves value, or exclusive use of the receiver SDK's verified path.
- FAIL: `Partial` accepted on a liquidation / mint / redeem path; or a bespoke VAA parser
  with no guardian-set / signature-count check.

```
grep -rn -E "verification_level|VerificationLevel|Partial|Full" programs/
grep -rn -E "VAA|guardian|wormhole|verify" programs/
```

---

## 5. Signed `expo` (i32) — branch on sign, checked math

Pyth `Price.expo` is a **signed `i32`**, typically `[-12, 0]` but valid to roughly `+6`.
Applying it with `price as u64 * 10u64.pow(decimals)` truncates the sign and can overflow.
Correct handling branches on `expo.is_negative()` and applies `10^abs(expo)` via checked
mul/div.

```rust
// FAIL — sign lost, silent overflow/truncation.
let usd = (price.price as u64) * 10u64.pow(token_decimals);

// PASS — branch on sign, checked pow/mul/div.
let scale = 10u128.checked_pow(price.expo.unsigned_abs()).ok_or(Err::ExpoOverflow)?;
let raw = (price.price.max(0) as u128).checked_mul(amount as u128).ok_or(Err::Overflow)?;
let usd = if price.expo < 0 { raw.checked_div(scale).ok_or(Err::DivZero)? }
          else { raw.checked_mul(scale).ok_or(Err::Overflow)? };
```

**Auditor check**
- PASS: `expo` sign is branched; scaling uses `checked_pow`/`checked_mul`/`checked_div`.
- FAIL: `10u64.pow(expo as u32)` (drops sign), or `as u64`/`as u32` casts on `expo`, or
  unchecked scaling arithmetic. Cross-link `checklists/03`.

```
grep -rn -E "expo|\.pow\(|10u64|10u128" programs/
```

---

## 6. Signed `i64` price — negative price is a sign-flip bomb

`Price.price` is a signed `i64`. A negative (or `i64::MIN`) price cast straight to `u64`
becomes an astronomically large positive number — collateral appears near-infinitely
valuable, or debt vanishes. Reject non-positive prices explicitly before any cast.

**Auditor check**
- PASS: `require!(price.price > 0, Err::InvalidPrice)` before the value is used or cast to
  an unsigned type.
- FAIL: `price.price as u64` with no positivity guard; negative-price handling is almost
  never exercised by integrators, so absence is common and high-impact.

```
grep -rn -E "\.price as u64|price\.price|as u64|as u128" programs/
grep -rn -E "> 0|is_positive|InvalidPrice" programs/
```

---

## 7. Confidence gate — RATIO threshold, not mere presence

The publisher ships an uncertainty band: Pyth `conf`, Switchboard `std_dev`. The gate is
not "is a confidence field present" — it is **`conf / price <= threshold`** (typically
1–3% = 100–300 bps). A wide band during a crash or thin-market moment is *the only* signal
distinguishing a tradeable price from a placeholder; reading the price and ignoring the
ratio is the recurring lending-audit finding.

```rust
// PASS — ratio gate, u128 to avoid overflow.
let conf_bps = (price.conf as u128 * 10_000) / (price.price as u128);
require!(conf_bps <= MAX_CONF_BPS as u128, Err::ConfidenceTooWide);
```

Switchboard `PullFeed`: the analogue is `result.std_dev / result.value <= threshold`.

**Auditor check**
- PASS: an explicit `conf/price` (or `std_dev/value`) ratio compared to a bounded bps
  constant on every path that transfers value.
- FAIL: `conf` read but never compared; or compared for *presence* (`conf != 0`) rather
  than as a ratio; or the ratio computed in `u64` where `conf * 10_000` overflows.

```
grep -rn -E "conf|std_dev|confidence|MAX_CONF" programs/
```

---

## 8. Switchboard On-Demand — feed-owner + queue-config pin + std_dev/value

`PullFeed` is permissionlessly updatable, so identity must tie to the **configured queue**
(the oracle set), not just the feed account. Verify: (a) feed account owner is the
Switchboard On-Demand program, (b) the feed's `queue` matches the expected queue pubkey,
(c) `result.std_dev / result.value` ratio gate (§7), (d) `result.slot`/`timestamp`
staleness (§3).

**Auditor check**
- PASS: owner check + `require_keys_eq!(feed.queue, EXPECTED_QUEUE, ...)` + std_dev-ratio +
  slot-staleness.
- FAIL: a `PullFeed` trusted on key alone with no queue pin — the result set is not bound
  to the oracle set the protocol vetted.

```
grep -rn -E "PullFeed|queue|std_dev|result\.(slot|value|timestamp)" programs/
```

---

## 9. Composition — staleness = MAX, confidence = SUM-of-ratios

Cross-asset pricing reads two feeds (e.g. SOL/USDC = SOL/USD ÷ USDC/USD). The composed
guards are stricter than either leg:

- **Freshness** applies to the *staler* leg: `max(age_a, age_b) <= MAX_AGE`. Each
  `get_price_no_older_than` enforces its own leg; confirm *both* are gated (a fresh SOL
  leg does not rescue a stale USDC leg).
- **Confidence** compounds: an upper bound is `conf_a/price_a + conf_b/price_b <= MAX_COMBINED`.
  Gating only one leg's confidence understates true uncertainty.
- **Expo alignment** across legs (§5) before the ratio.

This is the Nirvana-class failure surface generalized: a redemption/mark price derived
across a multi-leg path (an LP curve, a two-feed ratio) where one leg is manipulable or
stale diverges from fair value.

**Auditor check**
- PASS: both legs pass §1–§7 independently; combined confidence is the sum of ratios;
  staleness is the max.
- FAIL: only one leg checked; combined confidence taken from a single leg; ratio computed
  before expo alignment.

```
grep -rn -E "ratio|_usd|÷|div.*price|compose|combined" programs/
```

---

## 10. Sysvar clock key check — fake-clock defeats every staleness gate

A staleness gate is only as trustworthy as its clock. `Clock::get()?` is safe (syscall).
But a program that accepts the clock as an `AccountInfo`/`Sysvar` *parameter* must verify
`clock.key() == sysvar::clock::ID` — otherwise the caller passes a fake clock account with
`unix_timestamp` set to whatever makes a stale price look fresh, inverting §3 entirely.

**Auditor check**
- PASS: `Clock::get()?`, or a passed clock account with `require_keys_eq!(clock.key(),
  sysvar::clock::ID, ...)`.
- FAIL: clock read from an unchecked account parameter. Cross-link `checklists/01`
  (sysvar handling).

```
grep -rn -E "Clock::get|clock|sysvar::clock|Sysvar<" programs/
grep -rn -E "clock\.key\(\)|sysvar::clock::ID" programs/   # is the passed clock pinned?
```

---

## 11. Thin-market / derivative pricing — underlying, never spot

Any asset that is collateralizable, marginable, or borrowable against, whose external
market depth is thin, must be priced via TWAP or `max(spot, TWAP)` for collateral (and
`min(spot, TWAP)` for debt) — never spot alone. This is the Mango lesson: pushing a
low-liquidity spot/vAMM mark and borrowing against it is cheap.

Related and stricter: **LP tokens, LST/derivative tokens, and vault shares must be priced
from their underlying reserves, never from a spot market for the wrapper.** A flash loan
can move the wrapper's spot in one transaction; the fair value is `f(underlying reserves,
supply)`. Redemption math especially must never consume a price that is itself a function
of the position being closed.

**Auditor check**
- PASS: thin-market collateral uses TWAP or conservative `max/min(spot, TWAP)`; LP/LST/share
  prices derive from underlying reserves; redemption price is independent of the redeemer's
  own transaction.
- FAIL: spot-only pricing on a thin or collateralizable asset; an LP/derivative priced off
  a swappable spot; a redemption curve that reads the same spot the user just moved.

```
grep -rn -E "spot|twap|TWAP|lp_.*price|share.*price|reserve" programs/
```

---

## 12. Cross-protocol oracle inheritance / contagion

A protocol that accepts *another protocol's* token (LP token, LST, vault share) as
collateral inherits **that protocol's entire oracle pipeline** — and its solvency. Two
concerns:

- **Inherited oracle risk:** if protocol B's NAV/price feed is weak (fails §1–§11 under B's
  own code), listing B's token as collateral imports that weakness. The asset-listing audit
  question is: what oracle does the issuer use, and does *it* pass this file?
- **Solvency contagion:** if the accepted token's backing lives in B, then B's worst day is
  yours — B's insolvency de-values the collateral in the same window (the counterparty-as-oracle
  failure). Listing must account for B's failure mode, not assume B stays solvent.

**Auditor check**
- PASS: every accepted third-party asset has its oracle path validated under the issuer's
  code; exposure caps and circuit-breakers exist for each external backing venue.
- FAIL: a foreign LP/LST/share accepted as collateral on the assumption its price feed and
  issuer are sound, with no independent validation or exposure cap.

```
grep -rn -E "collateral|accepted_mint|listing|lp_mint|lst" programs/
```

---

## Oracle call-site checklist (fast pass — run per feed read)

- [ ] Feed key pinned to a constant or timelocked stored value (§1)
- [ ] Feed owner == expected oracle program; no unchecked manual deserialize (§2)
- [ ] `get_price_no_older_than` used, or explicit staleness gate after `get_price_unchecked`; `MAX_AGE` fits the action (§3)
- [ ] Pyth pull requires `verification_level == Full`; VAA chain verified if hand-rolled (§4)
- [ ] `expo` sign branched, scaled with checked math (§5)
- [ ] `price > 0` asserted before any unsigned cast (§6)
- [ ] Confidence gated as a `conf/price` (or `std_dev/value`) **ratio**, not presence (§7)
- [ ] Switchboard `PullFeed` pins queue config, not just feed key (§8)
- [ ] Composed reads: staleness = max, confidence = sum-of-ratios, expo aligned (§9)
- [ ] Clock is `Clock::get()?` or a pinned `sysvar::clock::ID` account (§10)
- [ ] Thin-market / LP / LST / share assets priced from underlying (TWAP), never spot; redemption price independent of the redeemer's tx (§11)
- [ ] Conservative side selected: collateral valued at `price - conf`, debt at `price + conf` (§7 + §11)
- [ ] Third-party collateral inherits a validated oracle path + exposure cap (§12)
