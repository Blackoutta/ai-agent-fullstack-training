---
id: 131
title: "Write-Lock Account Contention DoS (Hot Shared Writable)"
severity: 6
category: crypto
---

### 131 — Write-Lock Account Contention DoS (Hot Shared Writable)

**Severity: 6** | **Real: Solana's parallel runtime (Sealevel) serializes any transactions that write-lock a common account; local fee markets (SIMD-0110) let a griefer out-bid or spam writes on a single hot account. Public post-mortems of high-contention launches (bonding-curve / mint-crank single-config accounts, single global-state DEX pools) and Anza/Jito write-lock-scheduling notes describe the same chokepoint.**

Solana executes non-conflicting transactions in parallel, but any two transactions that both take a **write lock** on the *same* account are forced to run **sequentially**. A program that funnels a critical, time-sensitive path through **one shared WRITABLE account** — a global config, a single shared vault, one oracle-crank / price-update account, a global counter or sequence number — turns that account into a throughput chokepoint: every writer to it lines up in a single-file queue no matter how many cores the validator has.

An attacker weaponizes this. Under **local fee markets** the priority-fee auction is scoped *per write-locked account*, so a griefer does not need to congest the whole network — only that one account:

- **Spam cheap writes.** The attacker submits a stream of low-cost transactions that each write-lock the hot account (a no-op update, a dust deposit, a counter bump). Each one consumes a slot in that account's serial queue and delays every legitimate writer behind it.
- **Out-bid the priority-fee auction on that account.** When the target path is economically time-critical — a liquidation, an auction settlement, an expiry/settlement crank, a first-to-act race — the attacker raises the priority fee on the contended account so their (adversarial or empty) writes win scheduling, starving the honest actor's transaction until the window closes. The victim's transaction is not rejected; it simply never lands in time.

The result is a **liveness / denial-of-service** failure that has direct economic impact: liquidations that cannot land leave bad debt, settlements/auctions that cannot land let a party escape or extract value, and a stalled crank freezes dependent state. Crucially, **no arithmetic or CU limit is exceeded** — each individual transaction is cheap and well within budget.

**Distinct from KV-025 (compute-budget exhaustion DoS).** KV-025 is about a *single transaction* blowing the 1.4M-CU limit via unbounded iteration — a per-transaction compute problem. This vector is *account-level write-lock contention*: the individual transactions are small and cheap; the failure is that they cannot run *in parallel* because they serialize on a shared writable account, and an attacker exploits that serialization to starve a time-critical path. One is "the work is too big for one transaction"; this is "too many transactions must queue behind one account."

The root cause is architectural: a hot path's correctness or timeliness depends on writing a **global mutable singleton**, so its throughput is capped at one-writer-at-a-time and its scheduling priority is auctionable by anyone willing to write the same account.

> Cross-ref: this is the account-lock sibling of KV-025 (per-tx CU DoS) and KV-127 (init/pre-creation DoS) — all three deny liveness rather than steal funds. The economic-impact framing (a starved liquidation/settlement path) overlaps KV-029 (withdraw-before-update race) and the keeper-lifecycle timing gap in KV-129; where a *specific* time-critical path can be starved, evaluate both. Related economic checks: ECON-071 (economic/liveness DoS) and checklist 06 (economic griefing). Account-partitioning/PDA-sharding remediation cross-refs `references/framework-idioms/anchor.md` §5 (collision-safe per-user/per-market seeds).

#### Verification Procedure

**Step 1: Enumerate shared WRITABLE accounts on critical / time-sensitive paths**
```
grep -rn --include="*.rs" -iE "#\[account\(mut" programs/*/src/ | grep -iE "config|global|state|vault|treasury|counter|sequence|nonce|registry|market|pool|crank|oracle|price"
```
- Record: every `mut` account whose seeds are **constant / global** (no per-user or per-market discriminator) that is touched by an instruction on a hot path (swap, deposit/withdraw, liquidate, settle, auction, crank/update). A global-seed `mut` account written by a high-frequency or time-critical instruction is the candidate chokepoint. If every hot-path writable account is already sharded per-user / per-market, this vector is largely N/A (spot-check the cranks only).

**Step 2: Does any liquidation / settlement / auction path write-lock a single shared account?**
```
grep -rn --include="*.rs" -B3 -A10 -iE "fn (liquidate|settle|close_auction|execute|crank|expire|resolve)" programs/*/src/ | grep -iE "mut|global|config|counter|sequence|state"
```
- ✅ PASS: the time-critical path writes only accounts scoped to the *position/order being acted on* (per-user, per-obligation, per-order PDAs); no shared global-config / global-counter / single-crank account is write-locked on the path that must win a race.
- ❌ FAIL: a liquidation / settlement / auction / expiry path takes a write lock on a single shared account (global config, global counter, one shared vault, one update account) — every actor on that path serializes through it and can be out-bid / spammed off it.

**Step 3: Can the contended state be sharded / PDA-partitioned to remove contention?**
```
grep -rn --include="*.rs" -B2 -A6 -iE "seeds *= *\[" programs/*/src/ | grep -iE "b\"config\"|b\"global\"|b\"state\"|b\"counter\"|b\"vault\"|b\"registry\""
```
- ✅ PASS: state that is written on hot paths is partitioned so concurrent actors touch **different** accounts — per-user vaults, per-market state, per-user counters/nonces, or a sharded set of N sub-accounts — so honest transactions do not conflict and cannot be forced into one queue. A truly-global value that must be shared is read-only on the hot path (writes are confined to a cold admin path).
- ❌ FAIL: hot-path writes are funneled through one global-seed PDA that *could* be split per-user / per-market but is not — an unnecessary shared write lock caps throughput and hands an attacker a single account to grief.

**Step 4: Are liquidation / settlement paths isolated from admin-config writes?**
```
grep -rn --include="*.rs" -iE "fn (set_|update_config|update_params|admin|governance)" programs/*/src/ | grep -iE "config|global|state"
```
- ✅ PASS: the account(s) an admin path write-locks (config/params) are **not** also write-locked by the hot liquidation/settlement path — a config update cannot contend with (or be used to stall) an in-flight liquidation, and vice-versa; config the hot path needs is read-only there.
- ❌ FAIL: the hot path and an admin/config path both take a write lock on the same account, so routine config churn (or an attacker spamming a permissionless config-adjacent write) serializes against time-critical execution.

**Step 5: Is there a single global crank / update account on the hot path?**
```
grep -rn --include="*.rs" -iE "crank|update_price|refresh|tick|heartbeat|sequence|global_nonce" programs/*/src/ | grep -iE "mut|single|global"
```
- ✅ PASS: cranks/updates that gate time-critical execution are either not required to be single-account (multiple independent crank accounts / per-market update accounts), or the critical path does not *write* the crank account on the same transaction that must win the race (it reads a recently-updated value from a per-market account).
- ❌ FAIL: one global crank / update / heartbeat account must be written (or written-then-read) on the critical path, so contention on that single account throttles or starves the whole mechanism.

**Overall verdict:**
- ✅: No time-critical path write-locks a single shared account; hot-path state is per-user / per-market partitioned; liquidation/settlement is isolated from admin-config writes; cranks are not a single global writable chokepoint.
- ⚠️: State is mostly sharded but one non-critical hot path still write-locks a shared account (throughput cap without a proven time-critical starvation), or a global value is written on a warm path that is close to but not on the liquidation/settlement critical path.
- ❌: A liquidation / settlement / auction / crank path write-locks a single shared global account that could be partitioned — an attacker spams cheap writes or out-bids the per-account priority-fee auction to starve the time-critical path (economic-impact liveness DoS).
- N/A: All hot-path writable accounts are already PDA-partitioned per-user/per-market and no single-account crank gates a time-critical path (contention is not reachable).
