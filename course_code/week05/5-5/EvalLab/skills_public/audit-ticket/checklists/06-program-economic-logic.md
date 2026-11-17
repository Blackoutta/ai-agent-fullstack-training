# 06 — Economic & Logic Attack Checklist

> Domain: On-chain Solana Program  
> Severity if missed: CRITICAL to HIGH  
> References: DeFi exploit history, MEV research, flash loan attacks, sandwich attacks

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

> **Feature-gated sections (advisory load).** Several sections here are feature-specific: if the feature is *provably absent* (empty prescan array or zero grep hits — see `references/orchestration/pre-scan.md`), you may spot-defer the section and render its items `[N/A — feature absent: <marker>]`. This is a token-efficiency layer only — **every item still gets a verdict per Rule 0**, and the section reopens the instant a manual read surfaces the feature.
>
> | Section | Feature | Markers |
> |---------|---------|---------|
> | §6.1 Flash Loan Attacks | flash-loan / atomic deposit-withdraw | `flash` · `flashloan` · atomic deposit→withdraw · oracle-priced shares |
> | §6.9 Oracle Manipulation | price oracle | `pyth` · `switchboard` · `oracle` · `get_price` · `PriceUpdate` |
> | §6.13 Bonding-Curve / AMM Integrity | bonding curve / AMM | `bonding_curve` · `virtual_reserves` · `curve` · `swap` · `reserve` |
> | §6.15 TWAP / Internal Accumulator Hardening | TWAP accumulator | `twap` · `cumulative` · `observation` · `time_weighted` · `last_update` |
>
> Sections without a feature gate (fees, NAV, first-depositor, DoS, staking, slippage, vault) are evaluated for any value-moving program.

---

## 6.1 — Flash Loan Attacks

- [ ] **ECON-001**: Can an attacker flash-borrow tokens, deposit into the fund, inflate the NAV, and withdraw in the same transaction?
- [ ] **ECON-002**: Is there a deposit cooldown before withdrawal is allowed? (Prevents atomic deposit→withdraw exploitation)
- [ ] **ECON-003**: Is share minting delayed by at least one slot/block from deposit? (Prevents same-slot manipulation)
- [ ] **ECON-004**: Can an attacker flash-borrow SOL, deposit, get shares, and use shares as collateral elsewhere in the same tx?
- [ ] **ECON-005**: NAV attestation — can it be updated and exploited in the same transaction?

## 6.2 — Sandwich & MEV Attacks

- [ ] **ECON-006**: Jupiter swap instructions — do they enforce slippage limits? (User-configurable or hardcoded minimum?)
- [ ] **ECON-007**: Can a validator/MEV searcher sandwich a fund's swap by front-running with a buy and back-running with a sell?
- [ ] **ECON-008**: Manager's swap instruction — is the swap data (route, slippage) determined off-chain? Can it be manipulated?
- [ ] **ECON-009**: Deposit instruction — can it be sandwiched? (attacker deposits before, inflates NAV, depositor gets fewer shares)
- [ ] **ECON-010**: Withdrawal instruction — can it be sandwiched? (attacker manipulates pool prices to reduce withdrawal value)
- [ ] **ECON-011**: Is there a minimum deposit amount to prevent dust attacks that exploit per-transaction costs?
- [ ] **ECON-012**: Is there a minimum withdrawal amount similarly enforced?

## 6.3 — First Depositor / Share Inflation Attack

- [ ] **ECON-013**: When fund has 0 shares and 0 assets — what ratio does the first deposit use?
- [ ] **ECON-014**: Can the first depositor deposit 1 unit, then donate a large amount to the vault, making the second depositor's shares worth nearly nothing?
- [ ] **ECON-015**: Is there a minimum first deposit requirement to prevent the first depositor attack?
- [ ] **ECON-016**: Is there a "virtual shares" or "dead shares" mechanism (mint some minimal shares to address 0) to prevent first-depositor manipulation?
- [ ] **ECON-017**: Share price at creation — is it 1:1 with the deposit? Verify initialization logic

## 6.4 — NAV Manipulation

- [ ] **ECON-018**: Who attests the NAV? Manager? Oracle? Backend?
- [ ] **ECON-019**: If manager attests NAV — manager can inflate NAV before new deposits (dilution vectors)
- [ ] **ECON-020**: If manager attests NAV — manager can deflate NAV before withdrawals (steal from investors)
- [ ] **ECON-021**: Is there a maximum NAV change per attestation? (Rate limiting on NAV changes)
- [ ] **ECON-022**: Is there a verification mechanism for NAV accuracy? (On-chain oracle, multiple attestors, etc.)
- [ ] **ECON-023**: NAV floor: can NAV be set to 0? What happens to share pricing?
- [ ] **ECON-024**: NAV ceiling: can NAV be set to u64::MAX? Integer overflow in downstream calculations?
- [ ] **ECON-025**: Stale NAV: deposits/withdrawals using outdated NAV — is there a freshness requirement?

## 6.5 — Fee Exploitation

- [ ] **ECON-026**: Can the manager set fees to extract more than documented? Verify on-chain max fee enforcement
- [ ] **ECON-027**: Can the manager change fees after deposits are made? (Retroactive fee change)
- [ ] **ECON-028**: Is there a timelock on fee changes? (Allow investors to withdraw before new fees take effect)
- [ ] **ECON-029**: Can the manager extract fees by making wash trades (trade to themselves, charge fees on volume)?
- [ ] **ECON-030**: Management fee accrual — is it time-proportional or charged on operations?
- [ ] **ECON-031**: Performance fee — is the high-water mark tracked to prevent double-charging on recovery?
- [ ] **ECON-032**: Fee extraction order — are fees deducted before or after the investor's share calculation?
- [ ] **ECON-033**: Can fees be extracted from fund assets without going through the fee instruction path? (Direct transfer CPI)

## 6.6 — Manager Trust & Rug Pull Vectors

- [ ] **ECON-034**: Can the manager swap all fund assets to a worthless token? (Protocol risk, not necessarily a bug)
- [ ] **ECON-035**: Can the manager send fund tokens to their personal wallet via `pda_token_transfer`?
- [ ] **ECON-036**: `pda_token_transfer` — are both source and destination constrained to be fund-owned accounts?
- [ ] **ECON-037**: `pda_lamports_transfer` — are destinations constrained? Can manager drain SOL?
- [ ] **ECON-038**: `pda_token_approve` — can manager approve a delegate on fund tokens? What's the limit?
- [ ] **ECON-039**: `token_swap_vault` — can manager extract value via unfavorable swap routes?
- [ ] **ECON-040**: Protocol CPI — can manager CPI into a malicious program to drain assets?
- [ ] **ECON-041**: Is the whitelist for protocol CPI controlled by the same manager? (Fox guarding the henhouse)
- [ ] **ECON-042**: Can manager add their own program to the whitelist and then drain via CPI?
- [ ] **ECON-043**: Is there investor-side protection against manager misbehavior? (Timelock, multi-sig, withdrawal guarantee)

## 6.7 — Token-Related Exploits

- [ ] **ECON-044**: Token-2022 transfer hook: can a malicious token with a transfer hook exploit the fund?
- [ ] **ECON-045**: Token with fee-on-transfer: does the program correctly handle tokens where transfer amount != received amount?
- [ ] **ECON-046**: Rebasing tokens: does the program handle tokens whose balance changes without transfers?
- [ ] **ECON-047**: Tokens with freeze authority: can someone freeze fund's token accounts?
- [ ] **ECON-048**: Tokens with mint authority: can someone inflate token supply after fund buys them?
- [ ] **ECON-049**: Non-standard decimal tokens (e.g., 0 decimals, 18 decimals): does the program handle all decimal ranges?
- [ ] **ECON-050**: WSOL wrapping/unwrapping: correct handling of native SOL ↔ wrapped SOL transitions

## 6.8 — Denial of Service (Economic DoS)

- [ ] **ECON-051**: Can an attacker make transactions too expensive for legitimate users? (Account bloat, compute unit exhaustion)
- [ ] **ECON-052**: Can an attacker create many positions or withdrawals to make batch operations fail (out of compute)?
- [ ] **ECON-053**: `pay_fund_investors` with many remaining_accounts — does it exhaust compute budget?
- [ ] **ECON-054**: Can an attacker spam small deposits to create many positions and bloat state?
- [ ] **ECON-055**: Large Vec or array in state — can it grow unbounded and exceed account size limit?
- [ ] **ECON-056**: Can an attacker lock funds by creating a state that prevents legitimate operations?

## 6.9 — Oracle Manipulation

- [ ] **ECON-057**: If program relies on price oracles — which oracle? Pyth, Switchboard, Chainlink?
- [ ] **ECON-058**: Oracle price staleness check — is there a max age for oracle prices?
- [ ] **ECON-059**: Oracle confidence interval — are wide-confidence prices rejected?
- [ ] **ECON-060**: Can oracle be manipulated by the same party who benefits from the manipulation?
- [ ] **ECON-061**: Multi-oracle: does the program use fallback oracles if primary is stale?
- [ ] **ECON-062**: If no oracle is used (manager-attested NAV) — document the trust assumption and flag
- [ ] **ECON-071**: On-chain randomness / lottery / reward-selection uses a request-bound VRF (Switchboard/ORAO, with staleness + one-time consume) or a penalized commit-reveal — NEVER raw slot/blockhash/Clock entropy or user-supplied seeds (attacker submits only on favorable outcomes, or re-grinds across a reorg). Cross-ref KV-120.

## 6.10 — Staking / Reward Accounting

> Reward math is the most exploited category in staking/yield programs. (adapted from safe-solana-builder shared-base §21)
> Grep hints:
> ```
> grep -rn --include="*.rs" -iE "reward_debt|reward_per_token|acc_reward_per_share|reward_per_share|pending|accrued|total_staked|total_shares" programs/
> ```

- [ ] **ECON-063**: Partial unstake settles first — on any position shrink, is `pending = accrued − reward_debt` computed and paid out BEFORE the principal is reduced, then `reward_debt` reset against the new smaller principal? (PASS: settle-then-shrink; FAIL: `reward_debt` is rescaled proportionally without settling — independent floor divisions let an attacker loop `partial_unstake(1) + claim` to mint rewards with zero elapsed time. (adapted from safe-solana-builder shared-base §21.1))
- [ ] **ECON-064**: The `pending = accrued − reward_debt` formula is applied on EVERY payout path — claim, unstake, restake, compound, withdraw, liquidate, emergency-exit — and each sets `reward_debt = accrued` after paying. (PASS: all paths identical; FAIL: e.g. `claim` subtracts `reward_debt` but `unstake` does not — claim-then-unstake pays the same rewards twice = Critical. (adapted from safe-solana-builder shared-base §21.2))
- [ ] **ECON-065**: The global accumulator (`acc_reward_per_share` / `reward_per_token_stored`) is brought current BEFORE `total_staked` (the denominator) is mutated by any stake/unstake. (PASS: accrue-then-mutate; FAIL: `total_staked` changes first, so already-elapsed rewards are divided by the new stake — over/under-distributing to everyone. Grep for the order of `acc_reward_per_share +=` vs `total_staked +=/-=`.)
- [ ] **ECON-066**: Per-position snapshot vs global accumulator are consistent — the position stores `reward_per_token_paid` (or `reward_debt`) captured at the SAME scale/units as the global accumulator, and both are updated in the same instruction. (PASS: snapshot taken against the just-updated global value; FAIL: position checkpointed against a stale or differently-scaled accumulator — drift accumulates into free or lost yield.)
- [ ] **ECON-067**: Precision — is `acc_reward_per_share` scaled by a large factor (e.g. `1e12`/`PRECISION`) and are intermediate products widened to `u128` before the final divide, following multiply-before-divide? (PASS: `(shares as u128 * acc_per_share) / PRECISION` with checked ops; FAIL: `u64` math or divide-before-multiply — truncation zeroes small stakers' rewards or rounds in the attacker's favor. (adapted from safe-solana-builder shared-base §3.2))
- [ ] **ECON-068**: Share-price / dead-share insolvency — is total owed (sum of positions' claimable) guaranteed `<= available` in the reward source, and does a yield-accrual path raise the accounting numerator (`total_staked += yield`) independently of share supply so the exchange rate actually moves? (PASS: numerator updated on yield + `owed <= available` invariant asserted; FAIL: rewards paid from principal vault, or exchange rate frozen because yield never updates `total_staked` — structurally insolvent from the first claim. (adapted from safe-solana-builder shared-base §21.4 / §21.7))
- [ ] **ECON-069**: First-staker / `total_staked == 0` guard — when stake or reward supply is zero, does the accumulator update short-circuit (skip the `reward / total_staked` divide) and is the first depositor protected via dead shares, a minimum initial stake, or virtual balances? (PASS: zero-guard present AND inflation mitigation; FAIL: division-by-zero panic on first interaction, or first staker dust-stakes then donates to inflate the exchange rate and steals from later stakers via rounding. (adapted from safe-solana-builder shared-base §21.5))
- [ ] **ECON-070**: Settle-before-rate-change — when `reward_rate` (or reward-per-second/emission) is updated, are all positions settled to the current moment (global accumulator flushed) BEFORE the new rate takes effect? (PASS: `update_reward` flushes accumulator to `now`, then writes the new rate — the new rate applies only going forward; FAIL: a single mutable global rate multiplied by `total_elapsed` retroactively re-prices all history — attackers front-run a rate increase to backdate yield. (adapted from safe-solana-builder shared-base §21.3))

## 6.11 — Blast-Radius & Margin Controls

> The single most recurrent loss-limiter across major Solana/DeFi incidents is the ABSENCE of an aggregate outflow ceiling. Per-user limits do not bound a whale, a governance-captured vote, or a single manipulated mark. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "circuit_breaker|paused?|global_cap|window|daily_limit|outflow|max_borrow|utilization|concentration|haircut|unrealized|mark_to_market|mtm|pnl" programs/
> ```

- [ ] **ECON-072**: Aggregate value-outflow circuit breaker — is the SUM of all value-leaving paths (withdraw / borrow / redeem / settle / claim) gated by an aggregate per-window cap OR a pausable circuit breaker that is INDEPENDENT of per-user limits? (PASS: a protocol-level `outflow_this_window <= max_per_window` check or an admin/guardian pause that halts all outflow paths at once; FAIL: only per-user/per-account caps exist, so one whale, one governance-captured proposal, or one manipulated position can drain the treasury in a single tx. This is the most recurrent missing loss-limiter — Mango $115M, Nirvana, Drift $285M design risk, Step, Upbit $36.8M, DEXX $30M.)
- [ ] **ECON-073**: Unrealized PnL as collateral is bounded — if mark-to-market / unrealized PnL contributes to borrowing power or health, is it capped, haircut, or settlement-gated, and priced from a manipulation-resistant mark (TWAP / oracle-with-confidence, not a spot AMM the borrower can move)? (PASS: unrealized gains are haircut or cannot be borrowed against until settled, and the mark cannot be moved by the same actor within the same tx; FAIL: full spot-priced unrealized PnL is immediately borrowable — pump an illiquid market, mark up the position, borrow against the phantom gain, walk away. This is the exact Mango Markets $115M mechanism.)
- [ ] **ECON-074**: Concentration & counterparty caps — are there per-account and per-asset deposit & borrow concentration caps, plus a max single-counterparty allocation for any redeployed / lent-out reserves? (PASS: no single account, asset, or downstream venue can exceed a configured fraction of TVL, so one bad market or one insolvent counterparty is survivable; FAIL: reserves can be fully concentrated into one governance-listed asset or one lending venue — Solend governance-whale near-miss, Tulip/UXD Mango-contagion losses. Cross-ref oracle checks in §6.9.)
- [ ] **ECON-089**: Aggregate-outflow velocity breaker fires regardless of drain CAUSE — beyond a per-window outflow cap (ECON-072), does the protocol maintain rolling per-time-window value-outflow accounting on every withdrawal/settlement/redeem path AND expose a guardian pause that halts those paths whether the drain originates from a logic bug, an oracle/mark manipulation, OR a fully-signed admin action? (PASS: rolling per-window outflow accounting rate-limits value-moving instructions, plus a pausable guardian role held SEPARATELY from the upgrade/admin authority that trips on any drain — the breaker is not conditioned on the outflow being "unauthorized"; FAIL: the only caps are governance-gated so a signed admin action, a bad oracle print, or a logic bug drains straight through, and/or the pause key is the same authority that could be the cause. This is the recurring lesson of the three largest recent Solana losses — Drift $285M, Step Finance $27M, Loopscale $6M — where per-user/governance-gated limits did not bound a bug- or manipulation-driven drain. Distinct from ECON-072/073: the breaker must trip on bug and oracle drains, not merely whale/governance-captured ones.)

## 6.12 — Slippage & Fee Ordering

> Adapted from safe-solana-builder §27 (swap/fee accounting). These target the common pattern where a slippage guard and a fee are computed against different bases, letting the true user output silently fall below the stated minimum. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "min_out|minimum_amount_out|slippage|amount_out|fee|gross|net|proceeds" programs/
> ```

- [ ] **ECON-075**: Slippage guards protect NET output, not gross — is the `min_out` / slippage check applied to the amount the user ACTUALLY receives after all protocol/LP/referral fees are deducted, not to the pre-fee gross output? (PASS: `require!(net_out >= min_out)` where `net_out = gross_out - fee`; FAIL: `require!(gross_out >= min_out)` then fee is skimmed afterward — user can receive less than the minimum they signed for.)
- [ ] **ECON-076**: Fee base is the actual swapped amount — is any percentage fee computed on the real amount that entered the swap/route, not on the raw declared input (which may exceed what was consumed) or on a stale quoted amount? (PASS: fee derived from the executed input/output; FAIL: fee charged on the raw `amount_in` parameter even when the route consumed less, over-charging the user.)
- [ ] **ECON-077**: Fee deducted from proceeds, not upfront wallet SOL — is the fee taken out of the swap output/proceeds rather than as a separate debit against the user's wallet SOL/lamports? (PASS: fee netted from the token proceeds the instruction is already moving; FAIL: fee pulled as an extra lamport transfer the user did not account for, or double-charged.)
- [ ] **ECON-078**: Unambiguous value naming — do the swap/fee code paths use distinct, unambiguous names for `gross_out`, `fee`, and `net_out` (rather than reusing one `amount` variable for all three), so the slippage check provably references the post-fee value? (PASS: three clearly-named quantities, guard reads `net_out`; FAIL: a single overloaded `amount` mutated in place, making it impossible to tell which base the guard and the transfer use.)

## 6.13 — Bonding-Curve / AMM Integrity

> Adapted from safe-solana-builder §28 (bonding-curve & reserve-layer correctness). These target launchpad/curve programs where purchases near a completion threshold, virtual-vs-real reserve layers, or interdependent config values are mishandled. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "bonding|curve|virtual_reserve|real_reserve|threshold|complete|graduat|migrat|reserve" programs/
> ```

- [ ] **ECON-079**: Purchases capped at completion threshold — when a buy would cross the curve's completion/graduation threshold, is the fill CAPPED at the threshold (refunding or rejecting the excess), with slippage RE-CHECKED against the capped amount and a terminal-state solvency check performed? (PASS: overshoot clamped, slippage re-validated post-cap, terminal reserves proven solvent; FAIL: a single large buy overshoots the threshold — over-mints tokens, mis-prices the final units, or leaves the curve insolvent at completion.)
- [ ] **ECON-080**: Virtual and real reserve layers stay aligned — are virtual (pricing) reserves and real (custodied) reserves updated consistently on every buy/sell, so the price the curve quotes cannot diverge from the tokens/SOL actually held? (PASS: both layers mutated together with a checked invariant tying them; FAIL: virtual reserves drift from real balances, letting an attacker buy/sell at a price the vault cannot back.)
- [ ] **ECON-081**: Interdependent config validated atomically from params — are interdependent configuration values (initial virtual reserves, threshold, supply, fee) validated together against the instruction parameters at initialization, NOT read piecemeal from mutable/stale state later? (PASS: full config consistency asserted atomically from the init params; FAIL: config fields set/validated independently or re-read from state that can be stale, producing an internally-inconsistent curve.)

## 6.14 — Vault & Withdrawal Integrity

> Adapted from safe-solana-builder §22.1 and §30.1 (vault reachability & cumulative-cap withdrawals). These catch funds that are provably trapped, or residual-extraction paths that ignore prior draws or outstanding liabilities. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "vault|donation|insurance|fee_vault|reserve|withdraw|already_withdrawn|allocated|pending_liab|residual|sweep" programs/
> ```

- [ ] **ECON-082**: Every PDA-controlled token vault has a withdrawal path — for each program-owned/PDA-controlled token vault (donation, insurance, fee, reserve, treasury), is there a corresponding access-controlled instruction that can move funds OUT? (PASS: every vault has a reachable, authority-gated withdrawal/sweep; FAIL: a vault accumulates deposits but no instruction can ever withdraw from it — funds are locked forever. Enumerate every vault PDA and map it to a withdrawal instruction. (safe-solana-builder §22.1))
- [ ] **ECON-083**: Withdrawals validate cumulative caps — do capped/allocated withdrawals check the RUNNING total (`already_withdrawn + requested <= allocated`), not just the single-call amount, so repeated calls cannot exceed the allocation? (PASS: cumulative `already_withdrawn` tracked and enforced; FAIL: each call independently checks `requested <= allocated`, letting an actor drain N × allocation by calling N times. (safe-solana-builder §30.1))
- [ ] **ECON-084**: Residual extraction settles liabilities first — before any "sweep residual / withdraw remaining" path extracts leftover funds, is `pending_liabilities == 0` (all owed redemptions/payouts settled) asserted so the residual sweep cannot strand or steal money owed to users? (PASS: outstanding-liability invariant checked before residual extraction; FAIL: residual/dust sweep runs while user redemptions are still pending, extracting funds that back liabilities. (safe-solana-builder §30.1))

## 6.15 — TWAP / Internal Accumulator Hardening

> Distinct from §6.9 (external oracle manipulation): this section targets a program that maintains its OWN price observation / TWAP accumulator (an on-chain running sum of `price × elapsed_time`, or a ring of observations). These accumulators are a recurring high-severity surface — they wrap, they saturate over long idle gaps, they keep accruing after the window they measure has ended, and they get read before they hold enough data to mean anything. Cross-ref `references/methodologies/amm-clmm.md` (TWAP / oracle-accumulator hardening). Grep hints:
> ```
> grep -rn --include="*.rs" -iE "twap|observation|cumulative|accumulator|price_x|last_update(d)?_ts|time_weighted|oracle_index|checkpoint|snapshot" programs/
> ```

- [ ] **ECON-085**: Accumulator wraparound is handled — the running `Σ(price × elapsed)` (and any observation index/counter) is stored wide enough (`u128`+) and its consumers compute the delta as a WRAPPING difference (`now_acc.wrapping_sub(prev_acc)`), so a value that legitimately wraps past the type max still yields the correct interval average instead of a garbage/negative spread. (PASS: `u128` accumulator with `wrapping_sub` on read, matching the documented overflow semantics; FAIL: narrow accumulator, or a checked/naive subtraction that panics or produces a nonsense TWAP when the accumulator wraps. Zenith MetaDAO: TWAP-wrapping class.)
- [ ] **ECON-086**: Long-gap saturation is bounded and sane — when a large amount of time elapses between updates (no interaction for many slots/hours), the `price × elapsed` term uses checked/saturating math and cannot overflow the accumulator step or produce a spiked average; the design caps the per-update contribution or clamps `elapsed` to a maximum. (PASS: per-step `checked_mul` with a defined saturation/clamp behavior tested at a large gap; FAIL: `price * elapsed` overflows on a long idle period, or a single stale update injects an outsized weight that skews the TWAP for the next reader.)
- [ ] **ECON-087**: No accrual after the measurement window ends — if the accumulator backs a bounded epoch (a governance proposal's TWAP, an auction/window), updates STOP contributing once that window/proposal has ended; a `finalize`/`end_ts` gate prevents post-end observations from moving the settled value. (PASS: accrual is gated on `now <= window_end` (or the proposal being in an active state) and the finalized TWAP is frozen; FAIL: observations keep updating the accumulator after the proposal/window closed, so a late interaction re-prices an already-decided outcome. Neodyme MetaDAO AMM: TWAP accrual after proposal end.)
- [ ] **ECON-088**: No price projected from a zero / early accumulator — a TWAP read is rejected (or falls back) until the accumulator has been seeded and enough time/observations have elapsed; the code never divides by a zero elapsed span nor extrapolates a price from an all-zero initial state or a single fresh observation. (PASS: a minimum-elapsed / minimum-observation-count (or explicit `initialized` flag) guard gates every TWAP consumer, with the pre-start-delay window returning "not ready" rather than a computed number; FAIL: reading the TWAP right after initialization returns `0`, a div-by-zero, or a price derived from one just-written sample — usable to open/settle at a manipulable value. Sec3 Raydium: observation-window class.)

## 6.16 — Slot-Rate Constants & Slot-Windowed Economics (SIMD-0525)

> Mainnet slots are 200 ms since epoch 1053 (Oct 9, 2026). Any rate, window or cap denominated in slots now covers half the wall-clock it did at 400 ms. The damage is silent: the program keeps passing its tests while it charges the wrong interest, trusts a shorter oracle window and lets twice the flow through a breaker. See KV-138. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "SLOTS_PER_YEAR|DEFAULT_TICKS_PER|per_slot|slot_interest|max_staleness|publish_slot|twap|window|rate_limit|max_per|breaker" programs/
> ```

- [ ] **ECON-090**: Interest, funding and emission rates accrue on wall-clock deltas (`unix_timestamp`), or, if per slot, the slots-per-period value is a governable on-chain parameter rather than a compile-time constant from SDK defaults. Compute the effective multiplier at the live slot time: a year at 200 ms is 157,680,000 slots; SPL token-lending (the base of Solend/Save, Port and most lending forks) derives `SLOTS_PER_YEAR = DEFAULT_TICKS_PER_SECOND / DEFAULT_TICKS_PER_SLOT * SECONDS_PER_DAY * 365`, which against the pre-SIMD-0525 SDK is `160 / 64 = 2` in integer math (a 500 ms assumption) and yields 63,072,000; the Save fork hardcodes that literal and Kamino hardcodes `SLOTS_PER_SECOND = 2` on its legacy basis. A deployed binary built that way now accrues **2.5x the configured APR** (it was already 1.25x at 400 ms); a fresh build against the current SDK (320 ticks/s) gets 157,680,000, so the bug lives in what is deployed, not in what compiles today. (PASS: timestamp accrual, or a parameter already updated with the integer-division check; FAIL CRITICAL: a compiled or literal constant that mis-prices borrow rates, so borrowers are over-charged, positions cross the liquidation threshold earlier than the risk model says, liquidators collect the bonus and the quoted supply APY is wrong. EVM precedent: Compound `blocksPerYear = 2,102,400` after the Merge; the Venus fork charged 5x on BSC.)
- [ ] **ECON-091**: Oracle staleness bounds, TWAP windows and observation cadences denominated in slots are re-derived in seconds at the live slot time: a 25-60-slot staleness bound is now 5-12 s, a 1,500-slot TWAP window is now 5 min, and the capital × time an attacker needs to move a window halved. (PASS: windows defined in seconds, or slot windows resized at activation with a documented manipulation-cost analysis; FAIL: unchanged slot windows, so the manipulation resistance the protocol advertises is half of what it was. Cross-ref KV-005, ECON-085..088, `references/methodologies/lending.md` §3.)
- [ ] **ECON-092**: Per-slot rate limits, withdrawal caps and circuit breakers ("max X per N slots", "one action per slot / per leader window") are re-validated: an N-slot window now admits 2x the throughput per wall-clock second, so a drain-rate breaker lets twice the outflow through before it trips, and leader-window MEV assumptions changed (4 slots = 800 ms, not 1.6 s). (PASS: caps per unit of time, or slot caps halved at activation; FAIL: per-slot caps untouched since activation. Cross-ref ECON-083 cumulative caps.)

> **Deep-dive pointer:** for protocol-specific economic checks beyond this generic list, load the matching methodology reference: `references/methodologies/lending.md` (LTV/health/liquidation/bad-debt), `references/methodologies/perps.md` (funding/mark-index/insurance-fund/ADL), `references/methodologies/amm-clmm.md` (tick/liquidity/swap-invariant/fee-growth), `references/methodologies/stablecoin.md` (peg/collateral-ratio/redemption/de-peg spiral).
