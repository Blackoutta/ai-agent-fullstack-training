---
id: 129
title: "Keeper Request→Execute Front-Running & Reordering"
severity: 7
category: crypto
---

### 129 — Keeper Request→Execute Front-Running & Reordering

**Severity: 7** | **Real: OtterSec audit of Jupiter Perps (position-execution front-running, malicious-keeper wrong-program-id); Zenith audit of GMX-Solana (keeper reordering for MEV, claimable-close rent theft); Neodyme audit of Drift (keeper execution paths)**

Pool-vs-trader and RFQ perps (Jupiter Perps, GMX-Solana, Adrena) — and many vault/order programs — split an action into **two transactions**: the user submits a *request* PDA (open / increase / decrease / close), and a separate **keeper/crank** later *executes* it against a price fetched at execution time. The gap between submit and execute is the vulnerability. Two actors can abuse it:

- **The user gets a free option.** If the pending request's value-determining parameters (size, leverage, collateral delta, direction, acceptable-price / `min_out`) are NOT frozen at submit — or the user can amend/re-submit the request after observing the oracle — they submit at T0, watch the price, and let only the favorable requests execute while cancelling/mutating the rest. The keeper executes at a fresh price the user has already seen, so the fill is guaranteed to move in the user's favor.
- **The keeper extracts value.** The keeper is privileged over ordering and timing. If it can (a) reorder or omit pending requests, it front-runs its own execution queue for MEV (execute a large open just before a favorable move, defer the rest); (b) execute at a stale or out-of-window price, or ignore the user's committed acceptable-price bound, it prices fills adversarially; (c) settle/close/claim a position that still has an in-flight request, it double-spends the position or steals its rent / claimable balance; or (d) point the execution callback at an **attacker-chosen program id**, it redirects the settlement CPI.

The common root cause: the request→execute flow trusts that parameters are fixed and that the keeper is honest about price, ordering, and callback target — none of which is enforced in code.

> Cross-ref: perps methodology §12 (keeper request→execute lifecycle) and §1 (oracle staleness / slot gating). KV-119 (durable-nonce pre-signed admin tx) and the §9 admin-governance checks cover the privileged-actor-replay angle; this vector is the per-order two-step execution application. Related economic checks: ECON-006/ECON-009/ECON-010 (slippage & sandwich on the top-level path).

#### Verification Procedure

**Step 1: Confirm a two-step request→keeper-execute flow exists**
```
grep -rn --include="*.rs" -iE "request|pending|create_(order|request)|execute_(order|request|position)|keeper|crank|callback" programs/*/src/
```
- Record: the instruction that CREATES the request PDA, the instruction the KEEPER calls to execute it, and who is authorized to execute. If there is no submit/execute split (single-tx order), this vector is N/A.

**Step 2: Are request parameters frozen at submission?**
```
grep -rn --include="*.rs" -iE "size|leverage|collateral|direction|acceptable_price|min_out|trigger_price|request.*=|amend|update_request|modify" programs/*/src/
```
- ✅ PASS: size, leverage, collateral delta, direction, and the acceptable-price / slippage bound are written into the request PDA at submit time and there is NO instruction that mutates a pending request before execution.
- ❌ FAIL: a pending request is user-mutable (an `update_request`/`amend`, or submit-then-resubmit without invalidating the prior one) — the user gets a free option on price.

**Step 3: Is the execution price bound to the request?**
```
grep -rn --include="*.rs" -B3 -A6 -iE "execute_(order|request|position)" programs/*/src/ | grep -iE "slot|clock|staleness|acceptable_price|oracle|publish"
```
- ✅ PASS: the keeper executes against an oracle read gated to the request's slot window (staleness bound) AND honors the user's committed acceptable-price / slippage bound; a fill outside the bound reverts.
- ❌ FAIL: the keeper can execute at a stale or out-of-window price, or the committed acceptable-price bound is not re-checked at execution — adverse-selection fill.

**Step 4: Does close / claimable-close assert no pending request?**
```
grep -rn --include="*.rs" -B2 -A8 -iE "fn (close|settle|claim|cancel)" programs/*/src/ | grep -iE "pending|request|no_pending|in_flight|has_request"
```
- ✅ PASS: every close / settle / claim / rent-reclaim path asserts the position has NO in-flight request (`require!(position.pending_request.is_none())` or equivalent) before extracting value.
- ❌ FAIL: a position can be closed/claimed while a request is still pending — double-spend of the position, or theft of its rent / claimable balance (the claimable-close rent-theft class).

**Step 5: Can the keeper misdirect the callback or reorder/omit requests?**
```
grep -rn --include="*.rs" -iE "callback|program_id|invoke|cpi|remaining_accounts|order.*index|sequence|fifo" programs/*/src/
```
- ✅ PASS: the execution-callback target program id is pinned/validated in code (not taken from keeper-supplied accounts); execution ordering is FIFO / price-time or otherwise not a keeper-chosen value lever; the keeper cannot selectively drop requests to extract MEV.
- ❌ FAIL: the callback program id is read from keeper input (malicious keeper points it at their own program), or request ordering is keeper-controlled with a value impact (reordering MEV).

**Overall verdict:**
- ✅: Request parameters frozen at submit and immutable until executed; execution price gated to the request slot and honors the committed bound; close/claim asserts no pending request; callback program id pinned and ordering not a keeper value lever.
- ⚠️: Parameters frozen and price-bound correct, but ordering is keeper-controlled without a proven value impact, or the no-pending-request assertion is implied by flow rather than explicitly checked.
- ❌: A pending request is user-mutable (free option), OR the keeper can execute at a stale/unbound price, OR close/claim runs with an in-flight request (double-spend / rent theft), OR the callback program id / request ordering is keeper-controlled.
- N/A: Single-transaction order flow with no request→keeper-execute split.
