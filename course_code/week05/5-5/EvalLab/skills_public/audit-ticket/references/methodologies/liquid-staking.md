# Methodology — Liquid Staking & Restaking (Audit Checks)

> **Load when:** an LST / stake-pool / restaking program is detected — grep markers:
> `stake_pool`, `validator_list`, `exchange_rate`, `deposit_stake`, `withdraw_stake`,
> `unstake`, `withdrawer`, `staker`, `restak`, `delegate`, `vault`, `ncn`, `tip`.
>
> **Purpose:** What to verify in liquid-staking (LST) and restaking programs. Most bugs
> here are **not** in the program's own math — they are at the boundary between the LST
> program and Solana's native stake account, which has three authorities (staker,
> withdrawer, custodian) and an epoch-aligned activation/deactivation lifecycle.
>
> **Shared dependency.** Router/exchange-rate pricing and any LST-as-collateral surface
> read a price — see `references/methodologies/oracles.md` (LP/LST/share tokens must be
> priced from underlying, never spot). Cross-reference `checklists/01` (account
> validation), `03` (arithmetic), `05` (state machine), `07` (opsec/governance).
>
> **Public exploit provenance:** Step Finance (staker-vs-withdrawer authority confusion at
> an integration boundary) and SwissBorg ($41.5M, custodial SOL-staking backend / key-
> management failure) are credited as public incidents. The "phantom stake" and
> first-depositor-inflation classes are public stake-pool mechanics.

---

## 1. LST:SOL exchange rate — monotonic non-decreasing except fees

The exchange rate (SOL per LST) only ever **rises** as rewards accrue; the sole permitted
decrease is a fee deduction. Any other decrease is a stake leak. This is the headline
invariant for the family and the primary target for invariant fuzzing.

**Auditor check**
- PASS: every path that updates the rate can only increase it (or decrease it by a bounded,
  reward-sourced fee); the update is atomic with the balance recomputation.
- FAIL: a code path where the rate can fall for any reason other than fee accrual — e.g. a
  rebalance that loses lamports, a withdrawal that mis-accounts, a slashing debit taken from
  principal rather than the holder's pro-rata share.

```
grep -rn -E "exchange_rate|sol_per_lst|rate|pool_tokens|calc_lamports" programs/
```

---

## 2. Total-SOL conservation

`sum(stake_account.lamports) + reserve.lamports == LST_supply × exchange_rate +
accrued_fees` must hold across every operation. Deposits, withdrawals, splits, merges, and
rebalances move lamports between accounts but can never create or destroy them (outside
bounded fees). Encode this as a runtime assertion for fuzzing.

**Auditor check**
- PASS: total SOL under management is conserved across any instruction sequence; fees are
  the only sink and only draw from rewards (§8).
- FAIL: an operation where lamports can leak, duplicate, or where the accounted total
  diverges from `reserve + sum(stake)`.

```
grep -rn -E "lamports|reserve|total_lamports|total_stake|conservation" programs/
```

---

## 3. Staker vs Withdrawer authority confusion (the Step Finance class)

Native stake accounts have two distinct authorities:
- **Staker** — delegate, split, merge, deactivate.
- **Withdrawer** — close, withdraw lamports, **and change either authority** (strictly more
  powerful; a withdrawer can reach the staker, not vice versa).

Confusing them at the integration boundary is the Step Finance pattern: an integrator that
holds or transfers the *wrong* authority loses custody of stake. For every stake account the
program creates or accepts, the auditor must state: which authority the program holds, which
the user holds, and what a malicious/buggy program could do with what it holds.

The critical coupled requirement: on `deposit_stake`, the incoming stake account's
**withdrawer authority must be transferred to the pool atomically with the LST mint** — in
one instruction, not two. A gap between "user hands over withdrawer" and "pool mints LST"
(or the reverse) is a theft/free-mint window.

**Auditor check**
- PASS: authority roles are explicit and documented per stake account; `deposit_stake`
  transfers withdrawer to the pool PDA and mints LST atomically; withdrawer changes are the
  most tightly gated operation (multisig/governance).
- FAIL: staker used where withdrawer is required (or vice versa); withdrawer transfer and
  LST mint split across instructions; a user-held authority the program assumes it controls.
  Cross-link `checklists/02` (access control).

```
grep -rn -E "withdrawer|staker|authorize|AuthorizeWithStake|set_authority|StakeAuthorize" programs/
grep -rn -E "deposit_stake|mint.*lst|atomic" programs/
```

---

## 4. Phantom stake — no unaccounted on-chain stake

"Phantom stake" is stake that exists on-chain but is not reflected in the pool's accounted
total (or vice versa: accounted stake that can't be withdrawn). It arises when a
deposit/withdrawal/validator-add interleaves with a rebalance and the accounting desyncs.
The conservation invariant (§2) must hold *through* every interleaving, not just at rest.

**Auditor check**
- PASS: `update_validator_list_balance` / `update_stake_pool_balance` recompute the total
  from `reserve + sum(per-validator stake)` and update per-validator entries and the total
  atomically; no path leaves stake on-chain that the pool total ignores.
- FAIL: partial application on error; a rebalance that can add stake without incrementing the
  accounted total; a withdrawal accounted but not reflected on-chain.

```
grep -rn -E "update_validator_list_balance|update_stake_pool_balance|total_lamports|transient" programs/
```

---

## 5. Epoch-boundary constraints — activation/deactivation timing

Native staking is epoch-aligned. The rebalance/lifecycle logic must respect:
- A stake account **activating** in epoch N **cannot be split** before N+1.
- **Deactivating** stake **cannot be merged** before its cool-down completes.
- Validator-list mutation (add/remove/update) must be **atomic** — a partial update leaves a
  duplicate entry or an inconsistent stake total.

**Auditor check**
- PASS: split/merge/rebalance guard on epoch and activation state; validator add/remove
  checks the stake is fully (de)activated and the transient stake is empty; list mutations
  apply atomically.
- FAIL: split of activating stake, merge of deactivating stake before cool-down, or a
  validator-list update that can partially apply. Cross-link `checklists/05` (state machine).

```
grep -rn -E "epoch|activating|deactivat|cool_?down|split|merge|add_validator|remove_validator" programs/
```

---

## 6. Unstake ticket fees + front-running

Delayed-unstake tickets (and instant-unstake liquidity) are fee and ordering surfaces:
- The fee on unstake must round in the pool's favor and draw correctly.
- Instant-unstake pricing must not be front-runnable — an attacker seeing a large unstake
  should not be able to sandwich the ticket for profit, and ticket redemption must not let a
  user withdraw more than their pro-rata claim at the current rate.

**Auditor check**
- PASS: unstake fee rounds toward the pool with checked math; ticket redemption uses the
  current exchange rate and caps at the holder's pro-rata claim; instant-unstake liquidity
  pricing resists sandwiching.
- FAIL: unstake fee favors the user; ticket redeemable for more than pro-rata; front-runnable
  instant-unstake. Cross-link `checklists/06` (economic logic) and `03` (arithmetic).

```
grep -rn -E "unstake|ticket|instant|delayed|fee|claim" programs/
```

---

## 7. Vote-account validity on validator add

Adding a validator must verify the target **vote account is real and valid** — owned by the
Vote Program, not an arbitrary account the caller supplies. A pool that delegates to a fake
"validator" can have stake directed to an account the attacker controls.

**Auditor check**
- PASS: `add_validator` checks the vote account owner == Vote Program (and derives the
  transient/validator stake accounts correctly); rejects duplicates.
- FAIL: vote account accepted without an owner/type check. Cross-link `checklists/01`.

```
grep -rn -E "vote_account|vote::program|VoteState|add_validator|validator_vote" programs/
```

---

## 8. Fee accrual ≤ rewards earned — never from principal

Pool fees may only accrue from rewards, never from principal. A fee taken during a no-reward
epoch, or during a slashing event, is a stake leak that violates §1 and §2.

**Auditor check**
- PASS: fee minted/accrued is bounded by `rewards_this_epoch`; no fee is taken when rewards
  are zero or negative (slashing).
- FAIL: a flat fee draw that ignores whether rewards were earned; fee taken from principal or
  during slashing.

```
grep -rn -E "fee|manager_fee|epoch_fee|rewards|accrue" programs/
```

---

## 9. Restaking — delegation conservation

In restaking, `sum(vault.delegations_to_operators) <= vault.total_deposits`. Over-delegation
is the precursor to under-collateralization on slashing — if a vault delegates more than it
holds, a slash can't be honored. The delegation state machine (deposit → delegate →
undelegate → slash) must conserve at every transition; partial-slash accounting and the race
between a user withdrawal and a pending slash report are the high-density bugs.

**Auditor check**
- PASS: delegation never exceeds deposits; undelegate starts a cool-down and is blocked while
  a slash report is pending against the operator; user withdrawal and pending slash are
  ordered so the slash cannot be dodged.
- FAIL: delegation can exceed deposits; a user can withdraw ahead of a pending slash;
  partial-slash under-accounts the vault. Cross-link `checklists/05`.

```
grep -rn -E "delegat|undelegate|vault|operator|ncn|total_deposits|cool_?down" programs/
```

---

## 10. Slashing report → execution monotonic

Once a slashing report is validated, it **cannot be censored, replayed, or partially
applied**. The detection → execution chain (report submitted with on-chain evidence →
validated → applied to the vault → holders absorb pro-rata) must be deduplicated and
monotonic. Slashing amounts must respect per-operator and per-NCN caps.

**Auditor check**
- PASS: reports carry on-chain evidence (double-vote / equivocation proof), are deduplicated
  against prior reports, marked consumed on application, and bounded by caps; downstream LST
  holders absorb the loss pro-rata.
- FAIL: a report replayable or applyable twice; a validated report that can be dropped
  without execution; slashing that exceeds caps or debits the wrong parties.

```
grep -rn -E "slash|slash_report|process_slash|evidence|consumed|dedup" programs/
```

---

## 11. First-depositor exchange-rate inflation

If the first deposit creates the LST supply, a malicious first depositor can mint 1 lamport
of LST, then transfer a large amount directly into the reserve, inflating the rate before the
second depositor mints — the second depositor gets far fewer LST than fair.

**Auditor check**
- PASS: initialization seeds the reserve / mints a locked initial supply by the program, or
  enforces a minimum first deposit, so the rate can't be skewed by a dust-then-donate attack.
- FAIL: first deposit sets the rate with no seeding or minimum, and direct reserve transfers
  are unaccounted. Cross-link `checklists/06`.

```
grep -rn -E "first.*deposit|initial|min.*deposit|seed|reserve" programs/
```

---

## 12. MEV tip-router split — sums to 100%, no double-claim

For Jito-style MEV distribution, tips flow block-engine → tip-distribution PDA → recipients
(DAO, validators, NCN operators, stakers). The split percentages must **sum to exactly
100%**, the tip account must be the expected PDA for the `(validator, epoch)` pair, per-epoch
distribution must be **idempotent** (no double-claim), and per-recipient minimums prevent
dust griefing.

**Auditor check**
- PASS: split shares sum to 100%; tip account derived and checked as the `(validator, epoch)`
  PDA; each epoch's distribution is claim-once; changes to splits are time-locked.
- FAIL: splits that don't sum to 100% (silent revenue leak); a claimable-twice epoch; a tip
  account accepted without PDA derivation. Cross-link `checklists/04` (CPI/PDA).

```
grep -rn -E "tip|split|distribution|epoch|claim|100|basis" programs/
```

---

## 13. Custodial / operational surface (backend integrations)

When an exchange or wallet runs the staking backend (the SwissBorg class, $41.5M), the
on-chain code can be correct while the loss originates off-chain: deposit jobs that don't
reconcile against withdrawals, key compromise on the staking authority, off-by-one in
user-balance accounting, no fast pause path. This is an operational finding, but the entry
point is the LST staking backend.

**Auditor check**
- PASS: staking-authority keys are behind a multisig with rotation; deposit/withdrawal jobs
  reconcile; a fast pause path exists (council/security multisig, not a 7-day community vote).
- FAIL: a single hot key controls staking authority; no reconciliation between deposit and
  withdrawal jobs; no circuit breaker. Cross-link `checklists/07` and
  `references/methodologies/governance.md`.

```
grep -rn -E "pause|emergency|reconcil|custod|backend|hot_?key" programs/
```

---

## Liquid-staking checklist (fast pass)

- [ ] Exchange rate monotonic non-decreasing except bounded reward-sourced fees (§1)
- [ ] Total-SOL conservation across every operation (§2)
- [ ] Staker vs withdrawer roles explicit; `deposit_stake` transfers withdrawer + mints LST atomically (Step Finance, §3)
- [ ] No phantom stake — accounting holds through rebalance/deposit interleavings (§4)
- [ ] Epoch constraints: no split of activating, no merge of deactivating, atomic validator-list mutation (§5)
- [ ] Unstake fees favor the pool; tickets capped at pro-rata; instant-unstake not front-runnable (§6)
- [ ] `add_validator` verifies vote account owned by Vote Program (§7)
- [ ] Fees accrue only from rewards, never principal or during slashing (§8)
- [ ] Restaking: delegation ≤ deposits; withdrawal ordered behind pending slash (§9)
- [ ] Slashing report → execution is dedup'd, monotonic, cap-bounded (§10)
- [ ] First-depositor inflation guarded (seed / min deposit) (§11)
- [ ] MEV tip splits sum to 100%; per-epoch idempotent; tip account PDA-checked (§12)
- [ ] Custodial backends: multisig staking authority, job reconciliation, fast pause (§13)
- [ ] Router/exchange-rate and LST-as-collateral pricing pass `references/methodologies/oracles.md`
