# 05 — State Machine & Lifecycle Checklist

> Domain: On-chain Solana Program  
> Severity if missed: HIGH to MEDIUM  
> References: QEDGen SM properties, Withdrawal lifecycle, Fund lifecycle

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 5.1 — State Enum Completeness

- [ ] **SM-001**: List every state enum in the program (e.g., status enums for withdrawals, funds, positions, etc.)
- [ ] **SM-002**: For each enum, list ALL variants
- [ ] **SM-003**: For each enum variant, verify there is at least ONE instruction that transitions INTO that variant
- [ ] **SM-004**: For each enum variant, verify there is at least ONE instruction that transitions OUT of that variant (unless it's a terminal state)
- [ ] **SM-005**: Identify dead variants — enum values that are never set by any instruction. Flag as LOW (dead code)
- [ ] **SM-006**: Dead variants cannot be set via manual data manipulation (Anchor discriminator prevents external writes)
- [ ] **SM-007**: Terminal states are clearly identified (e.g., "Completed" after withdrawal finalization)
- [ ] **SM-008**: Terminal state accounts are closed (freed/rent returned) — not left as zombie accounts

## 5.2 — Withdrawal Lifecycle

> Adapt instruction names below to your program's actual withdrawal flow (e.g., `initiate_withdrawal`, `finalize_withdrawal`, etc.)

- [ ] **SM-009**: Withdrawal initiation instruction — sets status to `Initiated` from no-state (account creation)
- [ ] **SM-010**: Withdrawal initiation — requires investor signer and position with sufficient shares
- [ ] **SM-011**: Withdrawal swap/conversion instruction — is it restricted to `Initiated` status only? Or also allows later states?
- [ ] **SM-012**: If swap/conversion allows multiple statuses — is that intentional and safe?
- [ ] **SM-013**: Intermediate readiness instruction — transitions from `Initiated` to `ReadyToFinalize` (or equivalent). Does this instruction exist?
- [ ] **SM-014**: If readiness instruction is MISSING — flag as CRITICAL (broken withdrawal flow)
- [ ] **SM-015**: Withdrawal finalization — requires intermediate status (not `Initiated`)
- [ ] **SM-016**: Withdrawal finalization — closes the withdrawal account (returns rent to investor)
- [ ] **SM-017**: Withdrawal finalization — burns shares, transfers tokens/SOL to investor
- [ ] **SM-018**: Withdrawal cancellation — only valid from `Initiated` status (not `ReadyToFinalize`)
- [ ] **SM-019**: Withdrawal cancellation — restores investor's shares / position correctly
- [ ] **SM-020**: Withdrawal cancellation — closes the withdrawal account
- [ ] **SM-021**: Can an investor have multiple active withdrawals simultaneously? If no, verify uniqueness enforcement
- [ ] **SM-022**: Withdrawal timeout: is there a deadline after which a withdrawal can be cancelled/expired?
- [ ] **SM-023**: Can a withdrawal be stuck forever if admin/manager never advances it? (Griefing vector)
- [ ] **SM-024**: Partial withdrawal: can investor withdraw some shares and keep others?

## 5.3 — Fund Lifecycle

- [ ] **SM-025**: `initialize_fund` — creates fund with all required fields initialized
- [ ] **SM-026**: `initialize_fund` — sets manager, fee, name, vault, shares_mint correctly
- [ ] **SM-027**: Fund cannot be re-initialized after creation (reinitialization protection)
- [ ] **SM-028**: Fund closure: is there an instruction to close a fund? If yes, what are the preconditions?
- [ ] **SM-029**: Fund closure: all investor positions must be settled before fund can close
- [ ] **SM-030**: Fund closure: all pending withdrawals must be finalized or cancelled
- [ ] **SM-031**: If no fund closure instruction exists — flag as INFO (funds live forever, rent locked)
- [ ] **SM-032**: Fund name uniqueness: can two funds by the same manager have the same name? (PDA collision)
- [ ] **SM-033**: Fund deposit lifecycle: deposit → position created/updated → shares minted
- [ ] **SM-034**: Fund deposit: position.shares increases by correct amount after deposit

## 5.4 — Investor Position Lifecycle

- [ ] **SM-035**: Position creation: when is a position first created? On first deposit?
- [ ] **SM-036**: Position tracking: does position correctly track `total_deposited`, `total_withdrawn`, `shares`?
- [ ] **SM-037**: Position closure: when all shares are withdrawn, is the position account closed?
- [ ] **SM-038**: Position cannot go negative: `shares` field cannot underflow below 0
- [ ] **SM-039**: Position `total_deposited` and `total_withdrawn` are updated atomically with share changes
- [ ] **SM-040**: Can a position exist with 0 shares? What happens if further operations are attempted on it?

## 5.5 — Transition Guard Consistency

- [ ] **SM-041**: Every state transition checks the CURRENT status before transitioning (pre-condition)
- [ ] **SM-042**: No transition allows skipping states (e.g., Initiated → Completed without ReadyToFinalize)
- [ ] **SM-043**: State transitions are atomic — no partial state where transition started but didn't complete
- [ ] **SM-044**: If a transaction fails mid-execution, no account is left in an inconsistent state
- [ ] **SM-045**: Replay protection: can the same state transition be triggered twice? (e.g., finalize called twice on same withdrawal)
- [ ] **SM-046**: After `close`, the PDA's seeds can be reused for a new account — is this safe? No stale associations?

## 5.6 — Event Emission

- [ ] **SM-047**: Every financial state transition emits an event (`emit!` macro) — deposit, withdrawal, swap, fee
- [ ] **SM-048**: Events contain all relevant data: amounts, parties, timestamps, account addresses
- [ ] **SM-049**: Events cannot be spoofed (they're emitted by program execution, not user input)
- [ ] **SM-050**: Off-chain indexers rely on events — verify events are complete for accurate off-chain state reconstruction

## 5.7 — Invariant Checks

- [ ] **SM-051**: `fund.total_shares == shares_mint.supply` — this invariant holds after every instruction
- [ ] **SM-052**: `fund.total_shares == Σ(all investor_position.shares)` — verify no shares are lost or created
- [ ] **SM-053**: Fund vault balance is consistent with total_assets tracking (if tracked on-chain)
- [ ] **SM-054**: After every deposit: `fund.total_shares` increased, `fund.total_assets` increased
- [ ] **SM-055**: After every withdrawal: `fund.total_shares` decreased, `fund.total_assets` decreased
- [ ] **SM-056**: After every swap: `fund.total_shares` unchanged, token balances changed but NAV approximately same

## 5.8 — Lifecycle Hardening Patterns

> Adapted from safe-solana-builder shared-base §26 (state machine & lifecycle integrity). These target subtle lifecycle foot-guns that pass happy-path tests but invert permissions, trap funds, or allow illegal rewrites.

- [ ] **SM-057**: Sentinel-timestamp safety — no timestamp field uses `0` (or an epoch-era value) as a "special" sentinel while also feeding time arithmetic. `expiry_ts = 0` then `require!(now < expiry_ts + grace)` anchors the window to 1970 and expires instantly. For immediate expiry, store `clock.unix_timestamp` (now), not `0`
- [ ] **SM-058**: If a timestamp sentinel is genuinely required, it is handled by an explicit branch/flag that bypasses the arithmetic path — the magic value never reaches a comparison like `sentinel + grace_period`
- [ ] **SM-059**: Terminal-state cleanup is centralized — every instruction path that reaches the same terminal state (`Failed`, `Closed`, `Settled`) calls ONE shared helper (e.g. `on_terminate()`) that applies identical side effects (drain, zero accounting, close). No terminal path re-implements cleanup inline
- [ ] **SM-060**: List each terminal state and enumerate every transition INTO it; confirm all of them invoke the shared cleanup — a single path that skips it (missing lamport drain, un-zeroed reserve) can trap funds or leave phantom liquidity
- [ ] **SM-061**: Draining assets and zeroing the matching accounting fields happen in the same transaction, with a post-drain backing-invariant check (`actual_balance == expected`) before finalizing — status flags alone never gate a priced/redeemed/paid action against tracked reserves
- [ ] **SM-062**: Paired time-gates share ONE canonical `deadline_ts` — when a single timestamp controls two opposite permissions ("allowed until deadline" vs "cleanup allowed after deadline"), both are derived from the same computed value. Time-gate math is not duplicated inline across handlers
- [ ] **SM-063**: The two inequalities of a paired gate are exact complements (`now <= deadline` / `now > deadline`) — no off-by-one or divergent direction that creates a gap (both false) or overlap (both true) inverting intended permissions
- [ ] **SM-064**: State transitions are validated against an explicit allowlist matrix — `is_allowed_transition(current, next)` is checked before any side effect. Exclusion-style guards (`status != Initial`) are NOT used; they silently permit terminal states
- [ ] **SM-065**: Terminal states are absorbing — once entered they cannot transition back to a non-terminal state by default. Any intentional recovery path is modeled as a distinct, strictly-precondition'd transition with its own audit event, not an implicit escape
- [ ] **SM-066**: Access control is not treated as a substitute for transition validation — confirm an authorized actor (admin/manager) still cannot perform an illegal lifecycle rewrite (e.g. `Settled → Active`) because the transition matrix rejects it independently of who signed
- [ ] **SM-067**: Sub-state (secondary status / lifecycle locks) is preserved across primary-state transitions, not blindly reset — a primary transition that hardcodes `secondary_status = Open` can clear a migration-readiness or lockup flag; restore from persisted state or retain conditionally

## 5.9 — Fixed-Slot Collection & Cached-Aggregate Integrity

> These target two subtle, high-loss lifecycle bugs found in real Solana lending/margin programs: iterating fixed-slot arrays that stop at the first empty slot, and stale denormalized aggregates that are not recomputed on same-program mutations. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "Pubkey::default|== \[0|is_empty|break|for .*positions|for .*obligations|slot|total_collateral|cached|health|cross_margin|recompute|invalidate|dirty" programs/
> ```

- [ ] **SM-068**: Fixed-slot collections skip empties, never stop at the first — when a fixed-size collection (positions / obligations / deposits array) is iterated to compute health, total value, or collateral, does the loop CONTINUE past empty slots (`Pubkey::default()` / zeroed entries) instead of `break`/returning at the first empty one, AND are closed middle slots compacted so no filled slot after a gap is skipped? (PASS: iterate all slots, skip-if-empty (`continue`), or compact-on-close so filled entries are contiguous; FAIL: `break` on first empty slot causes filled entries beyond a freed gap to be ignored — a user closes a middle position to hide later collateral/debt from the health calc. Jet Protocol had ~$25M at risk from exactly this stop-at-first-empty pattern.)
- [ ] **SM-069**: Cached aggregates recomputed on EVERY contributing mutation — is any denormalized/cached aggregate (total collateral, account health, cross-margin sums, total value) recomputed or explicitly invalidated on EVERY instruction that mutates a contributing sub-account — including same-PROGRAM state changes (isolate/close/mode-flip/position-move), not only after CPIs? (PASS: every mutator refreshes or dirties the aggregate before it is next read; FAIL: the aggregate is refreshed only on deposit/withdraw or only after a CPI, so an internal state flip — closing a position, switching isolated↔cross, changing margin mode — leaves a stale health/collateral value that under-reports risk. Cypher lost $1.04M this way. This is DISTINCT from the post-CPI `.reload()` rule (anchor.md): the mutation is in-program, not an external CPI.)

## 5.10 — Vesting / Cliff Time Math

> Vesting, cliff, and lockup schedules are a recurring source of high-severity lifecycle bugs: elapsed-time subtraction that underflows before the start, time units (slot vs unix-timestamp) silently mixed inside one calculation, and cliff/linear boundaries computed off-by-one so the schedule pays out too fast, too early, or double. These pass happy-path tests (which start the clock at a sane value) but break when `now < start`, at the exact cliff boundary, or under a units mismatch. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "vest|cliff|lockup|unlock|elapsed|start_(ts|time|slot)|linear|schedule|is_.*started|now *-|current.*-.*start" programs/
> ```

- [ ] **SM-070**: Elapsed-time subtraction cannot underflow — every `elapsed = now - start` (and any `now - last_claim`, `now - cliff_end`) uses checked or saturating subtraction and explicitly guards the `now < start` case (schedule not yet begun ⇒ `elapsed = 0`, not a wrapped huge value). (PASS: `now.checked_sub(start)` / `saturating_sub` with a pre-start early-return of zero vested; FAIL: raw `now - start` in unsigned math panics or wraps when `now < start` — a claim before the start time either bricks or, on a wrapping build, unlocks the entire schedule. Halborn Raydium: cliff-underflow class.)
- [ ] **SM-071**: Time units are consistent across the whole vesting calc — the schedule's `start`, `cliff`, `duration`, and the value read from `Clock` are ALL in the same unit (all unix-timestamp seconds OR all slots), never mixed. Confirm the units of every operand feeding the elapsed/vested computation. (PASS: one unit end-to-end, and if slots are used the slot→time assumption is documented and stable; FAIL: `start`/`duration` stored as slots but compared against `Clock::unix_timestamp` — or vice versa — so the vest runs at the wrong rate. Accretion Ellipsis: slot/SlotWindow confusion made vesting complete ~4× too fast.)
- [ ] **SM-072**: Cliff gate and linear-after-cliff payout are correct and tested — the "has the cliff been reached?" check tests the actual cliff boundary (`now >= cliff_end`), not merely that vesting was configured/started (`start > 0` / `is_vesting_started`); before the cliff exactly zero is claimable, and after it the linear portion is `total * (now - cliff_end) / (duration - cliff)` (or the documented formula), never counting pre-cliff time toward the linear release. (PASS: distinct cliff-boundary test plus a linear-release test at, just before, and just after the cliff; FAIL: `is_vesting_started` only checks a nonzero/started flag and treats that as "cliff passed," releasing cliff tokens early or letting the linear term run from `start` instead of `cliff_end`. Halborn Raydium: `is_vesting_started` checks only `> 0`; Zenith MetaDAO: cliff/vesting boundary math.)

## 5.11 — Slot-Denominated Time (SIMD-0525 200 ms Slots / Alpenglow Clock)

> A slot is an ordering counter, not a clock. SIMD-0525 halved mainnet slot time to 200 ms (final step epoch 1053, Oct 9, 2026), so every duration a program measures in slots or epochs now elapses in half the wall-clock time; Alpenglow (epoch 1064, Oct 21, 2026) made `Clock.unix_timestamp` a leader-set value inside a bounded range. The EVM learned this at the Merge (Compound's `blocksPerYear`), and "block number used as a clock" has been a standard EVM audit item since. See KV-138. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "clock\.slot|\.slot\b|_slot\b|slots?_(per|until|since|remaining)|epochs?_(per|until)|SLOTS_PER|DEFAULT_TICKS|216_?000|432_?000" programs/
> ```

- [ ] **SM-073**: No duration, deadline, cooldown, timelock, vesting or lockup is measured in slots or epochs under a fixed ms-per-slot assumption; durations use `Clock::unix_timestamp`. Every slot / epoch-denominated window that remains is converted at the live slot time (200 ms since Oct 2026: a 432,000-slot "2-day" timelock is 24 h, an N-epoch lockup is ~N days) and compared with the security intent it protects. (PASS: seconds end-to-end, or slot / epoch values re-set at activation with the policy re-validated; FAIL: a window that silently halved, giving a hidden-clause proposal, a cliff or a liquidation grace half the reaction time the design assumed. Extends SM-071: "documented and stable" is no longer enough, the slot-to-time ratio changed four times in 2026.)
- [ ] **SM-074**: Exact-second boundary logic tolerates a leader-set clock: under Alpenglow the leader sets `unix_timestamp` within `[parent_ts, parent_ts + 2 × elapsed slot duration]` (the room grows with skipped slots; validators reject values outside it). Any all-or-nothing outcome decided at an exact second (auction close, order expiry, grace end, cliff, option exercise) carries a tolerance at least as large as that bounded drift, or settles through an explicit crank / commit-reveal rather than a leader-timed boundary. (PASS: buffer or crank; FAIL: a leader, or whoever buys the leader's slot, brings the boundary forward by seconds and closes an auction, expires an order or ends a grace period early. Verify activation with `getAgGenesisCert` (non-null), never by date.)
