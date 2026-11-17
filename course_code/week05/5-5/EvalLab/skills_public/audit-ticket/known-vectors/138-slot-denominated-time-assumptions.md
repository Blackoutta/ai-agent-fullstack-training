---
id: 138
title: "Slot-Denominated Time After SIMD-0525 (Slot Used as a Clock)"
severity: 7
category: crypto
---

### 138 — Slot-Denominated Time After SIMD-0525 (Slot Used as a Clock)

**Severity: 7** | **Real: SIMD-0525 cut mainnet slot time from 400 ms to 200 ms in four steps (epochs 1020, 1024, 1037 and 1053; final step Oct 9, 2026), so every duration a program measures in slots or epochs now elapses in half the wall-clock time; Alpenglow (epoch 1064, Oct 21, 2026) then made `Clock.unix_timestamp` a leader-set value inside a bounded range. The EVM precedent: Compound v2 hardcoded `blocksPerYear = 2,102,400` (15 s blocks). After the Merge fixed 12 s slots the realized rate runs about 25% above the configured one, and the same constant forked to BSC (3 s blocks) made Venus charge 5x the intended per-block rate (code4rena 2023-05, M-02). "Block number used as a clock" has been a standard EVM audit item since. Solana now has the same class with a bigger error: programs built from SPL token-lending (the base of Solend/Save, Port and most lending forks) against the pre-SIMD-0525 SDK carry `SLOTS_PER_YEAR = 63,072,000`, the Save fork hardcodes that literal and Kamino hardcodes `SLOTS_PER_SECOND = 2` on its legacy basis; a year at 200 ms is 157,680,000 slots.**

A slot is an ordering counter, not a clock. For six years 400 ms per slot was stable enough that programs, keepers and test suites quietly turned it into one: `432_000` slots meant "two days", `216_000` meant "a day", a 60-slot oracle bound meant "24 seconds", and `DEFAULT_TICKS_PER_SECOND / DEFAULT_TICKS_PER_SLOT` compiled into interest math. Two runtime upgrades broke the assumption without touching a single program, and the bugs they activated are silent: tests still pass, nothing reverts, the numbers are simply wrong. Each one hands something to an attacker:

- **Timelocks and voting windows halved.** A governance timelock of 432,000 slots was 48 h; it is 24 h now. Epoch-denominated lockups halved too (an epoch is still 432,000 slots, so ~24 h instead of ~48 h). The timelock is the control that gives the community time to notice a hidden-clause proposal (BonkDAO, Jul 2026, $20M); it now gives half the time it was designed to (KV-021, KV-119).
- **Interest and emission rates mis-scaled.** SPL token-lending derives `SLOTS_PER_YEAR = DEFAULT_TICKS_PER_SECOND / DEFAULT_TICKS_PER_SLOT * SECONDS_PER_DAY * 365`; against the SDK every deployed build used (160 ticks/s) that is `160 / 64` in integer math, which truncates to 2 and yields 63,072,000: a 500 ms assumption that was already 1.25x off at 400 ms (78,840,000 real slots) and is 2.5x off at 200 ms. The forks do not even derive it: Save hardcodes the literal `63072000` ("2 slots per second") and Kamino hardcodes `SLOTS_PER_SECOND = 2`. The SDK itself has moved on (`DEFAULT_TICKS_PER_SECOND` is 320 on master, with a module note that the cluster value is "changed dynamically by SIMD-0525" and must not be assumed from the SDK default), but a deployed binary does not recompile itself. Borrowers pay 2.5x the configured APR, positions cross the liquidation threshold earlier than the risk model says, liquidators collect the bonus, quoted supply APY is wrong and the utilization curve the risk team tuned no longer describes the market.
- **Oracle and TWAP windows shrink.** A 25-60-slot staleness bound is now 5-12 s; a TWAP window in slots covers half the time. Manipulation cost is capital × time, so moving the window costs half of what the protocol's documentation claims (KV-005, ECON-085..088).
- **Rate limits and circuit breakers admit twice the flow.** "Max X per N slots" lets 2x the outflow through per wall-clock second before the breaker trips; a leader window is 800 ms, not 1.6 s, so per-leader-window MEV assumptions changed as well.
- **Vesting, cliffs, cooldowns, auctions and grace periods unlock early.** Anything measured in slots releases, expires or becomes liquidatable in half the time; a liquidation grace meant to let a borrower top up is half as long (SM-070..072).
- **Signing-window pressure.** Blockhash expiry is still 150 blocks, which is now ~30 s instead of ~60 s. Teams whose multisig or cold-signing flow cannot land in 30 s reach for durable nonces, which is the exact pre-signed-admin-transaction setup behind the Drift drain (Apr 2026, $285M). Any such migration must carry the KV-119 controls.
- **Leader-set clock (Alpenglow).** `unix_timestamp` is no longer the stake-weighted median of vote timestamps; the leader sets it within `[parent_ts, parent_ts + 2 × elapsed slot duration]`, a range that grows with skipped slots (validators reject values outside it). A leader, or whoever buys the leader's slot, can bring an exact-second boundary forward by seconds: close an auction early, cross an expiry, end a grace period. The window is small, but every all-or-nothing gate at an exact second became leader-influenced.

> Cross-ref: checklist 05 §5.11 (SM-073..074: slot-denominated durations, leader-set clock tolerance); checklist 06 §6.16 (ECON-090..092: slot-rate constants, oracle / TWAP windows, per-slot caps); checklist 07 §7.12 (OPS-086..087: governance timelocks, signing windows vs durable nonces); BE-132 (keepers and APIs); FV-073 (tests that model wall-clock); `references/methodologies/lending.md` §1 and §3; KV-119 (durable-nonce pre-signing); KV-005 (oracle manipulation); KV-021 (governance attack); SM-071 (slot vs timestamp units in vesting).

#### Verification Procedure

**Step 1: Inventory every place a slot or epoch number is used as time**
```
grep -rn --include="*.rs" -E "clock\.slot|Clock::get\(\)\?\.slot|\.slot\b|_slot\b|slots?_(per|until|since|remaining|elapsed)|epochs?_(per|until|since)|SLOTS_PER|DEFAULT_TICKS|DEFAULT_MS_PER_SLOT|\b(216_?000|432_?000|63_?072_?000|78_?840_?000)\b" programs/
```
- Classify each hit: **(a)** a duration, deadline, rate or window (this vector); **(b)** a freshness tag compared against a bound (`publish_slot`, `last_update_slot`: see Step 4); **(c)** a sequence, nonce or ordering value (fine). Record the live slot rate from `getRecentPerformanceSamples` (`numSlots / samplePeriodSecs`) or `solana -u m epoch-info` (epoch wall-clock ≈ 24 h at 200 ms); never assume it from a date.
- If there are no (a) or (b) hits and no epoch-denominated lockups, this vector is N/A (record this explicitly).

**Step 2: Compiled slot-rate constants in interest, funding and emission math**
```
grep -rn --include="*.rs" -iE "SLOTS_PER_YEAR|SLOTS_PER_DAY|DEFAULT_TICKS_PER_SECOND|DEFAULT_TICKS_PER_SLOT|slot_interest|per_slot|rate.*slot|slot.*rate|emission.*slot" programs/
```
- ✅ PASS: rates accrue on `unix_timestamp` deltas, or the slots-per-period value is an on-chain governable parameter already updated to the live slot rate, and the derivation has no integer-division truncation (`160 / 64 ⇒ 2`)
- ❌ FAIL: a compile-time constant from SDK defaults (`63,072,000`) or any literal assuming 400 ms; report the multiplier `real_slots_per_year ÷ constant` (2.5x for the SPL lending constant at 200 ms) as the economic impact, with who gains (liquidators, the protocol on borrow interest) and who loses (borrowers, depositors quoted the wrong APY)

**Step 3: Governance, vesting, lockups, cooldowns and grace periods**
```
grep -rn --include="*.rs" -iE "timelock|hold_up|voting_(time|period|slots)|cooldown|grace|unlock_slot|cliff|lockup|\bepochs?\b" programs/ | grep -iE "slot|epoch"
```
- For each window compute the wall-clock at 200 ms (slots × 0.2 s; epochs × ~24 h) and compare it with the documented policy and the threat it protects against (the reaction time a hidden-clause proposal is supposed to give the community; the time a borrower gets before liquidation; the cliff an investor was promised)
- ✅ PASS: seconds-denominated, or slot / epoch values re-set at activation with the policy re-validated and a governance record
- ❌ FAIL: a window that silently halved; severity follows the control it weakened (a governance or upgrade timelock is High)

**Step 4: Oracle staleness, TWAP windows, rate limits and breakers**
```
grep -rn --include="*.rs" -iE "max_staleness|stale|publish_slot|last_update_slot|twap|observation|window|per_slot|rate_limit|max_per|circuit|breaker" programs/ | grep -iE "slot"
```
- ✅ PASS: bounds and windows defined in seconds, or slot values resized at activation with a documented manipulation-cost analysis (how much capital for how long now moves the window or trips the breaker)
- ❌ FAIL: a 25-60-slot staleness bound that now means 5-12 s, a TWAP or rate-limit window half as long as the design assumed, a per-slot cap that admits twice the outflow (KV-005, ECON-091..092)

**Step 5: Off-chain keepers, signing flows and the test suite**
```
grep -rn -E "\* ?400\b|\b400 ?\*|0\.4 ?\*|\* ?0\.4\b|216_?000|432_?000|warp_to_slot|MAX_PROCESSING_AGE|150 ?\* ?(400|0\.4)" apps/ packages/ clients/ services/ tests/ programs/*/tests 2>/dev/null
```
- ✅ PASS: keepers derive deadlines from `getBlockTime` / on-chain `unix_timestamp` or a slot rate fetched at runtime; tests advance `unix_timestamp` consistently with the live slot duration and assert each security-relevant duration in seconds (FV-073); multisig and cold-signing flows use proposal / transaction buffers, or durable nonces with the KV-119 controls
- ❌ FAIL: a keeper's grace, auction or expiry fires at half the wall-clock (an operator liquidates or sweeps early); a suite passes with a timelock that is half as long on mainnet; the answer to the 30 s blockhash window was "switch to durable nonces" with no nonce-authority custody, no inventory of pre-signed transactions and no execution timelock

**Step 6: Exact-second gates under the Alpenglow leader-set clock** (verify activation first: `getAgGenesisCert` non-null on the target cluster)
```
grep -rn --include="*.rs" -E "unix_timestamp *(>=|<=|>|<|==)|(>=|<=|>|<|==) *[a-z_.]*unix_timestamp" programs/ | grep -iE "auction|expir|deadline|grace|cliff|end_|close|exercise|settle"
```
- ✅ PASS: every all-or-nothing outcome decided at an exact second carries a tolerance at least as large as the bounded leader drift (2 × elapsed slot duration, more after skipped slots), or settles through an explicit crank / commit-reveal rather than a leader-timed boundary
- ❌ FAIL: an auction close, option exercise, order expiry or grace end that a leader can bring forward by seconds to decide the outcome

**Overall verdict:**
- ✅: No duration, rate or window is denominated in slots or epochs under a fixed ms-per-slot assumption (or every remaining one was re-derived at the live slot rate with its policy re-validated); interest constants accrue on time; keepers and tests model wall-clock; exact-second gates tolerate the leader-set clock; any durable-nonce flow carries the KV-119 controls
- ⚠️: Slot-denominated values were resized at activation but no manipulation-cost or policy analysis backs the new numbers, or the test suite still asserts durations in slots, or exact-second gates are unbuffered on a cluster where Alpenglow is not yet active
- ❌: A governance / upgrade timelock, vesting cliff, oracle window, rate limit or interest constant silently halved or mis-scaled after SIMD-0525, or a leader can decide an exact-second outcome, or the team migrated cold signing to uncontrolled durable nonces
- N/A: No slot or epoch value in scope is used as a duration, rate, deadline or freshness bound
