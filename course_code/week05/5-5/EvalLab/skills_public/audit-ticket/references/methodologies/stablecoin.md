# Methodology — Stablecoin Issuance (Audit Checks)

> **Load when:** a price-pegged synthetic token is minted/redeemed — grep markers:
> `collateral_ratio`, `collateral_value`, `psm`, `cdp`, `debt_ceiling`, `redeem`,
> `peg`, `mint_to`, `burn`, `reserve`, `issued`, `stable`.
>
> **Purpose:** What to verify when a program issues and redeems a pegged token. The
> unifying surface is **mint authority** — every path that ends in `mint_to` is a
> print-from-thin-air primitive, so the whole class reduces to "prove backing before you
> mint, and prove solvency before you redeem."
>
> **Shared dependency.** Every mint / redeem / liquidate path reads a price. Read
> `references/methodologies/oracles.md` alongside this file — the oracle checks there are
> load-bearing here. Also cross-reference `checklists/01` (account validation), `03`
> (arithmetic), `06` (economic logic), `07` (opsec/governance).
>
> **Public exploit provenance:** Cashio ($52M, unvalidated account chain into the mint),
> Nirvana ($3.5M, flash-loaned spot price on a redemption curve), and the counterparty-
> collateral class where a stablecoin's backing lived in another protocol that was then
> drained. These are credited as public mechanics, not sourced from any private corpus.

---

## 1. Backing solvency — `collateral_value >= issued` under conservative pricing

At all times, for every issued unit, the collateral behind it must be worth at least the
peg **under conservative pricing** — TWAP not spot, low end of the confidence band, after
haircut. For yield-bearing collateral (LST, RWA, lending receipts), use the
**redemption-floor** price, not the mark price; the mark can exceed what you'd actually
realize on exit.

**Auditor check**
- PASS: a solvency invariant `collateral_value_conservative >= issued_units` is asserted on
  every mint and holds after every collateral withdrawal; yield-bearing collateral is
  valued at its redemption floor.
- FAIL: solvency checked with spot/mark price; or checked at mint but not re-checked after
  a withdrawal that could push the position under-collateralized.

```
grep -rn -E "collateral_value|issued|total_minted|backing|solvenc" programs/
grep -rn -E "twap|conservative|haircut|floor" programs/
```

---

## 2. Per-collateral debt ceilings — one bad asset can't sink the peg

Each collateral type needs its own cap (`debt_ceiling` / max-mint-per-collateral). Without
per-asset ceilings, a single thin or manipulable collateral can back an unbounded share of
supply, so its failure de-pegs the whole system.

**Auditor check**
- PASS: minting against a collateral is gated by `issued_against[collateral] + amount <=
  ceiling[collateral]`, with a global cap on top.
- FAIL: a single global cap only, or no cap — exposure to any one asset is unbounded.

```
grep -rn -E "debt_ceiling|ceiling|max_mint|cap|per_collateral" programs/
```

---

## 3. Reserve solvency post-redemption — check the state *after* the redeem

A redemption must leave the system solvent: `reserve_after >= issued_after`. The check has
to model the post-redemption state, not the pre-state — otherwise the last redeemers drain
reserves below outstanding supply and later holders eat the shortfall.

**Auditor check**
- PASS: `redeem` computes post-redemption reserve and issuance and asserts solvency before
  transferring out.
- FAIL: redemption pays out with only a pre-state balance check, or no solvency assertion.

```
grep -rn -E "redeem|reserve|post_redemption|solvenc|remaining" programs/
```

---

## 4. Validation-chain integrity — the Cashio class (every account to a canonical root)

This is the highest-impact class in stablecoin issuance. A mint path traverses a chain of
accounts (deposit → wrapper → LP → mint). The fatal pattern is validating each account
against the **previous account in the chain** — because the previous account is
attacker-supplied. Cashio ($52M) lost exactly this way: a forged `arrow` account carried the
expected LP `mint` field but was owned by the attacker, not the canonical program; the final
`arrow.mint == EXPECTED_LP` check passed and 2 billion tokens minted.

The invariant: **every account in the chain must own-check to a canonical, program-owned
root. Never validate one intermediate against another intermediate — always against a known
program ID.**

```rust
// FAIL — arrow.mint is whatever the attacker wrote; arrow itself is never owner-checked.
require!(arrow.mint == EXPECTED_LP, Err::InvalidMint);
token::mint_to(/* ... */, amount)?;

// PASS — anchor every intermediate to its canonical program, THEN trust its fields.
require_keys_eq!(*arrow.to_account_info().owner, SABER_PROGRAM_ID, Err::InvalidOwner);
require_keys_eq!(*swap.to_account_info().owner,  SABER_PROGRAM_ID, Err::InvalidOwner);
require_keys_eq!(*crate.to_account_info().owner, CRATE_PROGRAM_ID, Err::InvalidOwner);
require!(arrow.mint == EXPECTED_LP, Err::InvalidMint);   // now trustworthy
token::mint_to(/* ... */, amount)?;
```

Anchor `Account<'info, T>` performs the owner check for free — the risk is the
`UncheckedAccount` / `AccountInfo` / custom-deserialize downgrade on a mint path.

**Auditor check**
- PASS: draw the account graph for the mint path; every edge/node owner-checks to a known
  canonical program (or uses a typed wrapper that does).
- FAIL: any intermediate account validated only by comparing its fields to another
  intermediate, with no anchor to a program root. Cross-link `checklists/01`.

```
grep -rn -E "mint_to" programs/
grep -rn -E "UncheckedAccount|AccountInfo<|to_account_info\(\)\.owner|require_keys_eq!" programs/
```

---

## 5. Redemption price integrity — hard floor + not a function of the user's own tx

Two coupled requirements, both learned from Nirvana ($3.5M):

- **Hard redemption floor.** Burning one stable always returns ≥ a protocol-level floor of
  underlying (e.g. `min(twap, curve_price)`, bounded below). Without a floor, an exit-liquidity
  drain becomes a print-and-dump.
- **Price independent of the redeemer's transaction.** The redemption price must **not** be a
  function of the position being closed. Nirvana priced a bonding-curve redemption with the
  same spot the attacker had just flash-loan-inflated, and the curve paid out ~10×. Any pricing
  input the caller can move within the same transaction is a flash-loan oracle.

```rust
// FAIL — spot price the attacker just inflated with a flash loan.
let out = ana_amount.checked_mul(treasury.spot_price())?.checked_div(PRECISION)?;

// PASS — TWAP + confidence + freshness, take the conservative side, then floor it.
require!(clock.unix_timestamp - oracle.publish_time <= MAX_STALENESS, Err::Stale);
let conf_bps = (oracle.conf as u128 * 10_000) / oracle.price as u128;
require!(conf_bps <= MAX_CONF_BPS, Err::ConfTooWide);
let price = oracle.twap_5min.min(treasury.spot_price());   // conservative, tx-independent
let out = ana_amount.checked_mul(price)?.checked_div(PRECISION)?;
```

**Auditor check**
- PASS: redemption uses TWAP/confidence/freshness (see `oracles.md`), enforces a hard floor,
  and the price cannot be moved by the redeemer in-tx.
- FAIL: redemption reads a spot/curve price the caller can push in the same transaction, or
  has no floor.

```
grep -rn -E "redeem|spot_price|bonding|curve|twap|floor" programs/
```

---

## 6. Redemption caps — per-tx / per-block flash-loan blast-radius limits

Even with correct pricing, cap the value redeemable per transaction and per block. A cap
bounds the damage of any residual pricing edge or oracle wobble to a size that can't drain
the system in a single flash-loaned transaction.

**Auditor check**
- PASS: `require!(usdc_out <= MAX_REDEMPTION_PER_TX, ...)` plus a rolling per-block/epoch cap.
- FAIL: unbounded redemption size — one transaction can redeem arbitrary amounts.

```
grep -rn -E "MAX_REDEMPTION|per_tx|per_block|redemption_cap|rate_limit" programs/
```

---

## 7. Full-close on repay — anti-revival

When a CDP/vault is repaid in full (`repay >= debt`), the account must be marked closed
(state flag or `close`), not merely zeroed-in-place. A drained-but-live account can be
revived and reused with stale state. Equivalently, a liquidation must end either fully
closed **or** restored above the liquidation threshold and above a minimum position size —
never leaving sub-dust positions that accumulate into socialized bad debt.

```rust
// PASS — liquidation resolves cleanly; full close marks state to prevent revival.
let fully_closed = new_debt == 0;
let restored     = compute_health(new_collateral, new_debt)? >= LIQ_THRESHOLD;
let above_dust   = new_debt >= MIN_DEBT && new_collateral >= MIN_COLLATERAL;
require!(fully_closed || (restored && above_dust), Err::IncompleteLiquidation);
if fully_closed { cdp.state = CdpState::Closed; }   // anti-revival
```

**Auditor check**
- PASS: repay-in-full and liquidation-to-zero both mark the account closed; liquidation
  otherwise restores health above a dust floor.
- FAIL: full repay leaves a live account with zeroed balances (revival vector); or
  liquidation leaves sub-threshold dust. Cross-link `checklists/05` (state machine).

```
grep -rn -E "repay|CdpState|Closed|close|liquidate|dust|MIN_POSITION" programs/
```

---

## 8. Fee rounding direction — mint UP, burn DOWN

Rounding always favors the **protocol**, never the user. Mint fee rounds **up** (user pays
at least fair); burn fee rounds **down** (user receives at most fair). A 1-lamport error the
wrong way, repeated across supply, is a free-stable primitive.

```rust
// FAIL — mint fee floors, burn fee ceils. Both favor the user.
fn mint_fee(a: u64, bps: u64) -> u64 { a * bps / 10_000 }            // floor — wrong
fn burn_fee(a: u64, bps: u64) -> u64 { (a * bps + 9_999) / 10_000 }  // ceil  — wrong

// PASS — mint ceils, burn floors, checked throughout.
fn mint_fee(a: u64, bps: u64) -> Result<u64> {
    Ok(a.checked_mul(bps)?.checked_add(9_999)?  / 10_000)            // ceil
}
fn burn_fee(a: u64, bps: u64) -> Result<u64> {
    Ok(a.checked_mul(bps)? / 10_000)                                 // floor
}
```

**Auditor check**
- PASS: mint/issuance fee rounds up, burn/redeem fee rounds down, both with checked math.
- FAIL: either direction favors the user, or unchecked `*`/`/`. Cross-link `checklists/03`.

```
grep -rn -E "fee|_bps|9_999|round|ceil|floor|/ 10_000" programs/
```

---

## 9. Pause semantics — halt inflows, keep de-risking paths open

An emergency pause must halt operations that **increase** system risk (mint, borrow) while
keeping operations that **reduce** risk open (repay, liquidate, redeem). A pause that also
blocks repay/liquidate traps bad debt and prevents users from de-risking during exactly the
event the pause was meant to contain.

**Auditor check**
- PASS: the pause flag gates `mint` / `borrow`; `repay`, `liquidate`, and `redeem` remain
  callable while paused. Pause authority is a council/emergency governance path.
- FAIL: a global pause that also blocks repay/liquidate/redeem; or a pause toggle with no
  access control. Cross-link `checklists/07` and `references/methodologies/governance.md`.

```
grep -rn -E "pause|paused|is_paused|emergency|halt" programs/
```

---

## 10. Mint authority = program PDA only

The mint authority for the stable must be a PDA derived from program-controlled seeds —
never an off-curve keypair, a human signer, or another program. For bridged/reserve-backed
variants, the on-chain `mint_to` must be invocable only by the bridge program with a
verified message proof, and the off-chain reserve must be independently attestable at a
cadence that matches observed mint volume.

**Auditor check**
- PASS: `mint::authority` is the program PDA; `mint_to` is signed only by that PDA via
  `invoke_signed`; bridged mints gate on verified bridge message proof + reserve attestation.
- FAIL: mint authority held by a plain keypair or delegable to one; `mint_to` reachable by
  any caller; bridged mint with no message-proof gate. Cross-link `checklists/02` (access
  control), `07` (authority custody).

```
grep -rn -E "mint::authority|mint_authority|invoke_signed|set_authority|freeze_authority" programs/
```

---

## 11. Bridged reserve attestation (reserve-backed variants)

For a wrapped mint mirroring an off-chain reserve (USDC/USDT-style), the entire security
surface is custody + attestation: (a) who can call `mint_to`, (b) is that authority a
program-controlled bridge with verified proof, (c) does the reserve-of-record have an
independent proof-of-reserve whose cadence matches mint volume.

**Auditor check**
- PASS: mint gated to a proof-verifying bridge; reserve independently attestable; mint
  volume reconciles against attested reserves.
- FAIL: mint authority is a bare multisig with no on-chain proof requirement, or no reserve
  attestation cadence.

```
grep -rn -E "bridge|attest|proof|reserve|wrapped|message" programs/
```

---

## Stablecoin checklist (fast pass)

- [ ] `collateral_value_conservative >= issued` on mint and after every withdrawal; yield collateral valued at redemption floor (§1)
- [ ] Per-collateral debt ceilings + a global cap (§2)
- [ ] Redemption asserts post-state `reserve >= issued` (§3)
- [ ] Every account in the mint chain owner-checked to a canonical program root — never intermediate-vs-intermediate (Cashio, §4)
- [ ] Redemption has a hard floor and a price the redeemer cannot move in-tx (Nirvana, §5)
- [ ] Per-tx and per-block redemption caps (§6)
- [ ] Repay-in-full and liquidate-to-zero mark the account closed; no sub-dust positions (§7)
- [ ] Mint fee rounds up, burn fee rounds down, checked math (§8)
- [ ] Pause halts mint/borrow, keeps repay/liquidate/redeem open (§9)
- [ ] Mint authority is a program PDA only; `mint_to` PDA-signed (§10)
- [ ] Bridged variants: mint gated on verified proof + reserve attestation (§11)
- [ ] Every price path (mint/redeem/liquidate) passes `references/methodologies/oracles.md`
