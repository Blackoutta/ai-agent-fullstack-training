# Invariant Catalog — Harness-Ready Invariant Menus per Protocol Class

> **Load when:** `context-builder` or `economic-analyst` needs a starting invariant set for a
> detected protocol class — i.e. when reconstructing per-function invariants (Phase 0.5), when
> scoping an FV/fuzz harness (`references/audit-lifecycle/methodology.md` → FV ladder), or when
> writing the report's invariant-property table. Instantiate the relevant menu(s); a protocol is
> usually a **blend**, so pull from several.

---

## How to use this file

Each entry is a **candidate invariant** stated in three parts, so it can go straight into a harness:

- **Statement** — one line, declarative ("what must always be true"), independent of any code line.
- **Ranges over** — the state the invariant quantifies across (which accounts / values / op sequences it must hold for). This is what a harness enumerates.
- **Assert** — how to check it in a harness: a `proptest`/`quickcheck` property on a pure function, or a **Trident** stateful post-condition asserted after every instruction (or after a random multi-instruction sequence). Where relevant, note the `assume` (precondition) the harness needs.

These are a **menu, not a spec** — pick the invariants whose violation is a real finding for *this* target, drop the ones that don't apply, and add protocol-specific ones from `context-builder`'s per-function work. An invariant is only worth a full proof (Certora/Kani) when a single counterexample is catastrophic; the rest are fuzz/proptest targets. Cross-ref the per-class methodologies (`references/methodologies/*`) for the domain-specific failure modes each invariant guards.

---

## 1. Token / Vault

Conservation of value is the whole game: shares and underlying must reconcile, and no path may create or destroy value without a matching, accounted counter-move.

- **Supply conservation.**
  - *Statement:* Σ of all token-account balances for a mint == the mint's recorded `supply` (no tokens exist outside the accounted set).
  - *Ranges over:* every token account of the mint, across any sequence of mint / burn / transfer / deposit / withdraw instructions.
  - *Assert:* Trident post-condition after each instruction — sum the tracked token accounts and `assert_eq!(sum, mint.supply)`. Seed the harness with all holders as tracked accounts.

- **No mint without a matching debit.**
  - *Statement:* every increase in circulating supply (or vault shares) is backed by a corresponding recorded inflow — shares minted ⇒ underlying deposited; underlying withdrawn ⇒ shares burned. `Δshares` and `Δunderlying` never move in a value-creating direction.
  - *Ranges over:* the (shares_supply, vault_underlying) pair across deposit/withdraw/mint/burn sequences.
  - *Assert:* Trident — snapshot both before/after each op; `assert!` that `shares_out` was matched by `underlying_in` (round-trip `deposit(x); withdraw_all()` returns ≤ x). This is the ECON share-inflation guard as a property.

- **Rent-exemption preserved.**
  - *Statement:* no instruction leaves a still-live program-owned account below its rent-exempt minimum (an account is either rent-exempt or fully closed, never a partially-drained zombie).
  - *Ranges over:* every account the program debits lamports from (vault, fee, state) across all ops, including partial withdraws and fee sweeps.
  - *Assert:* Trident post-condition — for each live account, `assert!(account.lamports() >= Rent::minimum_balance(account.data_len()))`. Cross-ref KV-123 (lamport-donation bricking) for the dual (donation) direction.

---

## 2. AMM / CLMM

The pool must never pay out more than the curve allows, and rounding must always leave the pool at least whole. For concentrated liquidity, boundary math is where these break (cross-ref `references/methodologies/amm-clmm.md`).

- **Constant-product floor (`k = x · y` non-decreasing).**
  - *Statement:* after any swap (fees included), `reserve_x · reserve_y ≥ k_before` — the invariant product never decreases across a swap.
  - *Ranges over:* the two reserve balances across an arbitrary sequence of swaps in both directions, at arbitrary sizes.
  - *Assert:* Trident — record `k = x*y` (as u128) before each swap, `assert!(x_after * y_after >= k_before)` after. For CLMM, the analogue is per-tick: active `liquidity` reconstructs correctly after crossing sequences.

- **Rounding favors the pool.**
  - *Statement:* every conversion (amount-in, amount-out, sqrt-price step) rounds so the pool is never short — amount-in rounds up, amount-out rounds down; a round-trip cannot extract value.
  - *Ranges over:* single swap-step math (pure function), then repeated-crossing sequences.
  - *Assert:* `proptest` on the pure `compute_swap_step` / `get_amount_delta` function — assert output direction against exact rational arithmetic; plus a Trident sequence asserting `swap(a→b); swap(b→a)` returns ≤ starting amount (dust-per-crossing leak, the CLMM boundary class).

- **Fee never exceeds input.**
  - *Statement:* the fee charged on a swap is ≤ the input amount (and ≤ its configured bps), and fee accounting credits exactly what was withheld — no double-count, no negative net.
  - *Ranges over:* fee computation per swap across all sizes and both directions.
  - *Assert:* `proptest` on the fee function — `assert!(fee <= amount_in && fee <= amount_in * fee_bps / DENOM + 1)`; Trident to confirm `fee_growth_global` is monotonic and matches summed withholdings.

---

## 3. Lending / Borrowing

Solvency and health must hold *continuously* — including mid-CPI and at oracle bounds. (Deep failure modes: `references/methodologies/lending.md`; this is the harness distillation.)

- **Solvent positions stay above the liquidation line.**
  - *Statement:* every obligation that the protocol treats as non-liquidatable satisfies `collateral_value / debt_value ≥ liquidation_threshold`; conversely, any obligation with health < 1 is liquidatable.
  - *Ranges over:* every open obligation across deposit / borrow / repay / withdraw / accrue / liquidate sequences, under conservative pricing.
  - *Assert:* Trident post-condition after each op — for each tracked obligation, `assert!(!marked_healthy || health(o) >= threshold)`; feed prices at their staleness/confidence bounds via the harness `assume`. Compute health only from refreshed state.

- **Interest index is monotonic per slot.**
  - *Statement:* the borrow/liquidity index never decreases — `new_index ≥ old_index` at every accrual point (no negative interest, no reset).
  - *Ranges over:* the index value across every accrual / refresh call at arbitrary slot deltas.
  - *Assert:* `proptest` on the accrual function — `assert!(accrue(index, rate, dt) >= index)` for all `dt ≥ 0`; Trident to confirm no instruction path resets or rounds it down.

- **Aggregate borrows bounded by collateralized deposits.**
  - *Statement:* Σ borrows ≤ Σ deposits × collateral-factor across the reserve (system-wide solvency), so the pool can always cover withdrawable liquidity minus reserves.
  - *Ranges over:* the (total_borrowed, total_supplied) reserve aggregates across any op sequence.
  - *Assert:* Trident global invariant — `assert!(total_borrowed <= total_supplied.saturating_mul(collateral_factor) / DENOM)` after each op; the standalone `total_supplied >= total_borrowed + reserves_taken` solvency check is a property-test target over random sequences.

---

## 4. Multisig / Governance

Authorization and single-execution are the invariants; the subtle one is that a membership/threshold change must not leave stale approvals live (cross-ref `references/methodologies/governance.md`).

- **Execution implies sufficient approvals.**
  - *Statement:* a proposal/transaction can only reach `Executed` if its recorded approvals ≥ the threshold that was in force for it.
  - *Ranges over:* every proposal across propose / approve / revoke / execute sequences with arbitrary signer subsets.
  - *Assert:* Trident post-condition — on any transition to `Executed`, `assert!(approval_count >= threshold)`; drive random approve/revoke orderings.

- **No double-execution.**
  - *Statement:* a proposal executes at most once — a second execute of the same proposal is rejected (idempotence via a consumed/executed flag or nonce).
  - *Ranges over:* the executed-state of each proposal across repeated execute attempts (including reentrant / duplicate-instruction attempts).
  - *Assert:* Trident — attempt `execute` twice in a sequence; `assert!` the second fails and state/effects are unchanged. Model the executed marker as the state it ranges over.

- **Member-set / threshold change invalidates stale approvals.**
  - *Statement:* changing the member set or threshold invalidates approvals collected under the old configuration — a proposal cannot execute on signatures from removed members or against a superseded threshold.
  - *Ranges over:* the (approvals, member_set, threshold) triple across a change-config op interleaved with pending proposals.
  - *Assert:* Trident sequence — collect approvals, mutate the member set/threshold, then attempt execute; `assert!` it either fails or requires re-approval under the new config (this is the classic stale-approval finding).

---

## 5. Vesting / Staking

Claimed can never exceed earned, and every reward accounting change must reconcile its bookkeeping so no double-claim survives a stake change.

- **Cumulative claimed ≤ vested.**
  - *Statement:* the total amount ever claimed by a beneficiary is ≤ the amount vested at the current time per the schedule (never claim ahead of the curve).
  - *Ranges over:* the per-beneficiary `total_claimed` against `vested_at(now)` across claim calls at arbitrary timestamps (including clock edge cases at start/cliff/end).
  - *Assert:* Trident post-condition after each claim — `assert!(total_claimed <= vested_amount(schedule, clock.unix_timestamp))`; `proptest` the pure `vested_amount` for monotonicity and clamping to the total grant.

- **`reward_debt` reconciles on every stake change.**
  - *Statement:* the accumulator-based reward bookkeeping (`pending = user_stake * acc_per_share - reward_debt`) is reset consistently on **every** deposit/withdraw so a stake change can never mint unearned rewards or strand earned ones.
  - *Ranges over:* the (user_stake, reward_debt, acc_per_share) tuple across interleaved stake/unstake/claim sequences for multiple users.
  - *Assert:* Trident — after each stake-changing op, `assert!` computed `pending` is non-negative and that summed distributed rewards ≤ total rewards funded; drive random multi-user stake churn (this is where MasterChef-style double-claim bugs surface).

---

## 6. Oracle-Consuming

Any protocol that reads a price must refuse to act on data that is stale or too uncertain — the invariant is on the *gate*, not the price value (cross-ref `references/methodologies/oracles.md`).

- **Staleness bound enforced.**
  - *Statement:* no state-changing decision uses a price whose publish slot is older than `MAX_STALENESS` — a stale read rejects the whole instruction, never silently falls back.
  - *Ranges over:* every price-consuming instruction across arbitrary `clock.slot` vs `price.publish_slot` gaps.
  - *Assert:* Trident with a mocked price account — set publish_slot to exceed the bound via `assume`, `assert!` the instruction reverts; `proptest` the pure `is_fresh(slot, publish_slot)` gate at the boundary (`= MAX` vs `> MAX`).

- **Confidence checked.**
  - *Statement:* a price is used only when its confidence interval (Pyth `conf/price`, or Switchboard variance) is within a configured bps cap — a too-wide band rejects.
  - *Ranges over:* the (price, conf) pair across the consuming instructions at varying confidence widths.
  - *Assert:* Trident — feed a wide-confidence price, `assert!` reject; `proptest` the `conf_bps = conf * 10_000 / price` gate for overflow-safety and the reject boundary.

---

## 7. Token-Registry / Listing Consumer

A registry (token list, canonical-asset mapping, risk score) is an off-chain identity oracle. The invariants below are for the *consumer* protocol or backend; the operator-side ranking / scoring invariants R1–R10 live in `references/methodologies/token-registry-risk.md`.

- **Value paths are mint-pinned.**
  - *Statement:* for every swap / transfer / payment / collateral path, the mint the transaction touches equals a mint present in the pinned config or on-chain allowlist at the time the path was entered — never a mint freshly resolved from a symbol, name or registry `assetId`.
  - *Ranges over:* every value-moving instruction / endpoint, across any registry response (including a hostile "primary variant" for the same symbol).
  - *Assert:* property test — fuzz the registry stub to return arbitrary mints for the same symbol / assetId and `assert!(tx.mint ∈ pinned_set)`; Trident post-condition on an on-chain allowlist program: an accepted mint set changes only through the admin / governance instruction.

- **Score never authorizes.**
  - *Statement:* the set of mints a listing / collateral / routing path accepts is invariant under the registry risk score, grade, tier or `verified` flag — flipping the score for a mint never changes acceptance without the on-chain checks (mint / freeze authority, permanent delegate, extension set, metadata mutability) also passing.
  - *Ranges over:* every acceptance decision, across all score values including `unavailable` / `insufficient data`.
  - *Assert:* differential test — same mint, score ∈ {A, C, unavailable, error}; `assert_eq!(accepted(mint, score_i), accepted(mint, score_j))` for every pair when on-chain facts are held constant; and `assert!(!accepted)` for a mint with a live freeze authority regardless of score.

- **Registry outage fails closed.**
  - *Statement:* when the registry / risk provider is unreachable, stale beyond the bound, or returns an unknown mint, no path yields a *verified* / *safe* / *listed* outcome.
  - *Ranges over:* every consumer path, across provider states {timeout, 5xx, 429, malformed, stale, unknown mint}.
  - *Assert:* stub each provider state and assert every outcome is in `{unverified, unavailable, rejected}`; UI snapshot test that *unavailable* renders distinctly from *clean*.

---

## Instantiation checklist (fast pass)

- [ ] Identify the protocol class(es) — pull the matching menu(s); a blend pulls from several (§1–§6)
- [ ] For each candidate invariant, keep only those whose violation is a real finding for *this* target; drop N/A
- [ ] Add target-specific invariants from `context-builder`'s per-function work (Phase 0.5)
- [ ] Mark each as **fuzz/proptest** (broad, no proof) vs **prove** (Certora/Kani — reserve for the 3–10 catastrophic ones)
- [ ] Wire the kept invariants into the harness (Trident stateful post-conditions + proptest on pure fns) and record them in the report's **invariant-property table** (property → asserted? → inputs exercised → not-yet-covered)
