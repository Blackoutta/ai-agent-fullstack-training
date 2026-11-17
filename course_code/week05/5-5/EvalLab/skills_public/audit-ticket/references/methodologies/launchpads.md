# Methodology — Launchpads, Bonding Curves & Aggregators (Audit Checks)

> **Load when:** a token-launch / bonding-curve / swap-router protocol is detected — grep markers:
> `bonding_curve`, `reserve`, `graduate`, `virtual_reserves`, `route`, `swap`, `curve`
> (also: `virtual_sol_reserves`, `virtual_token_reserves`, `real_reserve`, `complete`, `migrate`,
> `lp_recipient`, `graduation_threshold`, `min_amount_out`, `route_leg`, `execute_swap`,
> `pool_program`, `dev_allocation`, `launch`, `curve_params`).
>
> **Purpose:** protocol-specific checks for two adjacent families that share an audit profile —
> **launchpads / bonding curves** (primary issuance: a program mints/sells a new token along a
> deterministic curve, then "graduates" its accumulated liquidity into a secondary AMM) and
> **aggregators / DEX routers** (secondary path-finders: accept a swap, route it across many AMMs,
> execute as one transaction). Covers constant-product curves (pump.fun-style), linear/step curves,
> Dutch and sealed-bid auctions, curve→AMM migration, multi-hop routers (Jupiter-style), and
> intent/RFQ DEXes. These sit **on top of** the language-agnostic checklists (`checklists/01`–`07`);
> where a generic check covers the base case the note says *"beyond `<ID>`, also verify…"*.
>
> **How to use:** each section is an auditor check — *safe shape*, *failure mode*, *grep*. PASS = safe
> shape enforced *in code*; FAIL = failure mode reachable.
>
> **Why the two families share this file:** both reduce to the same statement — *accept user funds,
> move them through a deterministic price mechanism, and deliver at least `min_out` or revert*. The
> shared surface is **curve/route validation, slippage discipline, atomic multi-step execution, and MEV
> exposure**. Launchpads add **curve math, graduation atomicity, dev-allocation transparency, anti-snipe**;
> aggregators add **third-party pool trust and Token-2022 breakage**. The route-validation section (§3
> S4) is the direct **arbitrary-CPI** defense: an unvalidated hop *is* an invocation of an
> attacker-controlled program. Curve math overlaps `references/methodologies/amm-clmm.md` (§10 there
> also covers bonding-curve launchpads); Token-2022 routing overlaps the extension methodology.

---

## 0. Classify the variant FIRST — math-heavy vs routing-heavy is a different audit

The bug surface differs sharply by variant. A launchpad audit is dominated by **curve math +
dev-allocation + graduation**; an aggregator audit is dominated by **route validation + MEV + Token-2022**.
A protocol doing both (a launchpad that also routes its own curves) needs both. Confirm which you are
auditing before scoping anything else:

| Variant | Pricing | Liquidity source | Distinctive risk |
|---|---|---|---|
| **Constant-product bonding curve** | `x·y = k` against a **virtual** reserve | none until graduation | dev-allocation rug; first-buyer snipe; curve-formula overflow |
| **Linear / step curve** | piecewise-linear vs total supply | none | step-boundary arbitrage; price-impact gaming; rounding |
| **Dutch auction** | descending price clock | reserve sold per tick | clock-tick manipulation; clock-source trust; bidder collusion |
| **English / sealed-bid auction** | bid-revealed | bidder-funded | commit-reveal correctness; refund completeness; reveal-phase griefing |
| **Curve → AMM migration (graduation)** | curve until threshold, then AMM | post-graduation: the AMM | migration atomicity; LP-recipient rug; price discontinuity at cutover |
| **Aggregator / router** | passthrough | composed from many AMMs | per-hop program trust (arbitrary CPI); end-to-end slippage; Token-2022 |
| **Intent / RFQ DEX** | solver quote | solver-provided | solver collusion; settlement replay; off-chain quote authenticity |

**Two structural facts shift the threat model:**
- **Bonding curves hold a global reserve that only leaves via graduation.** Graduation is therefore the
  single highest-risk operation — it spans multiple programs, moves the *entire* raise, and is usually
  the only path through which value exits the curve PDA. Most launchpad severity concentrates there and
  in the curve-math primitive.
- **Aggregators hold no liquidity.** Their entire security model is "accept funds, route through
  *attested* programs, deliver `min_out` or revert." Everything reduces to validating that sentence —
  and the weakest link is trusting a hop's target program (arbitrary CPI, §3 S4).

```
grep -rn -E "bonding_curve|virtual_reserves|virtual_sol_reserves|graduate|complete_launch|migrate|route|execute_swap|pool_program" programs/
```

---

## 1. Invariant catalog

Every launchpad/aggregator audit must produce evidence (test / proof / review note) for each. Numbered
for cross-reference from the worksheets (§2) and the fast-pass checklist. Grouped by concern.

**Curve math**

| # | Invariant | Failure = |
|---|-----------|-----------|
| **L1** | **Price monotonicity** — every `buy(Δ)` strictly **raises** the implied marginal price and every `sell(Δ)` strictly **lowers** it; no input (dust, zero, or rounding-induced) flips the direction | Rounding-reversal arbitrage; free value from a mispriced tick |
| **L2** | **Reserve conservation** — at every boundary the reserves reconcile: `virtual + real` at all times equals `initial_virtual + Σ net_in`; the curve never *loses* reserves to truncation or double-count | Slow reserve leak / silent insolvency of the curve |
| **L3** | **No round-trip profit** — `sell(buy(x)) ≤ x` net of fees; a single actor buying then immediately selling cannot end with more than they started | Instant drain via buy→sell cycling |
| **L4** | **Path-independence** — `buy(A)` then `buy(B)` reaches the same state as `buy(A+B)` (modulo rounding); order does not matter | MEV bots re-order to extract |
| **L5** | **Wide intermediate math** — every product that can reach `u64::MAX · u64::MAX` uses a `u128`(+) intermediate and a **checked** downcast (`try_into`), never a silent `as u64`; **no division before multiplication** where it loses precision | Overflow truncation mis-prices the whole curve |

**Graduation**

| # | Invariant | Failure = |
|---|-----------|-----------|
| **L6** | **Graduation atomicity** — AMM init + liquidity seed + LP mint + LP→sink + curve close happen in **one transaction** (ideally one instruction); there is no window where reserves sit exposed between the threshold firing and the pool being seeded | Anyone with curve write-access pulls reserves mid-migration |
| **L7** | **LP sink hard-coded** — the graduation instruction hard-codes the LP-token recipient (burn address / governance PDA / vesting escrow); it is **never** a caller-supplied parameter | Deployer redirects LP tokens = the rug |
| **L8** | **State-driven trigger** — the graduation threshold reads **on-chain state** (`real_sol_raised ≥ THRESHOLD`), and any time condition uses the `Clock` sysvar; never a caller parameter or off-chain hint | Premature / never / attacker-timed graduation |
| **L9** | **No double-graduation** — `complete_launch` is idempotent: a second call fails, reserves do not move, and the launch account is marked closed (non-revival) after migration | Re-run drains or re-seeds a second pool |

**Dev / authority**

| # | Invariant | Failure = |
|---|-----------|-----------|
| **L10** | **Dev-allocation transparency** — any tokens pre-minted to the deployer are fixed and **visible at init** (constants in init instruction data, not minted by a later instruction); ideally locked behind an on-chain vesting schedule | Hidden supply dumped on buyers |
| **L11** | **First-buyer / anti-snipe protection** — a launch that prices at ~0 initial price has one of: commit-reveal for the first N slots, escalating first-N-slot fees, an explicit dev-premint so the first public trade isn't at a price discontinuity, or atomic (bundle) init+first-trade | Bot captures the entire first-buyer surplus |
| **L12** | **Permissionless-listing rate-limiting** — anyone-can-list launchpads have spam controls (creation fee, per-creator cooldown, mint-discriminator namespacing) and the mint **namespace itself** is treated as part of the threat model | Bait/phishing infrastructure; ticker-collision scams |

**Aggregator routing**

| # | Invariant | Failure = |
|---|-----------|-----------|
| **L13** | **Route validation — allowlist EVERY hop** — each hop's target program is validated against an allowlist of pool-program IDs (or a registry account owned by the aggregator), **and** each pool account's owner is checked to equal its declared program; the route is a **typed enum**, not a generic `Vec<AccountInfo>` | Direct arbitrary CPI — a "pool" that is a draining program |
| **L14** | **End-to-end slippage** — `min_amount_out` is enforced on the **final** output of the **whole route**, after fees, in the destination mint's units, from a **measured** balance delta (not a computed figure); per-hop-only checks are insufficient | Value leaked at intermediate hops |
| **L15** | **Route atomicity** — if any hop fails the **entire** transaction reverts; no intermediate token-account state or dust persists | Partial-route state pollution / stuck funds |
| **L16** | **Token-2022 awareness on the route** — `TransferFee` / `TransferHook` / `PermanentDelegate` mints are detected (mint owner + extension parse) and either baked into the expected output, routed only through compatible pools, or refused; **fail-closed**, never silent passthrough | Slippage broken; mid-route re-entrancy / clawback |

**MEV**

| # | Invariant | Failure = |
|---|-----------|-----------|
| **L17** | **Sandwich-resistant defaults** — the program refuses swaps whose `min_amount_out` is implausibly low relative to the quote without explicit acknowledgment; it does not push "infinite slippage to avoid failure" onto users; bundle-tip accounts (if any) are validated (not attacker-controlled) | Free sandwich value; tip-routing griefing |

---

## 2. Per-instruction review worksheets

Each worksheet lists the safe shape. FAIL if any line is missing on any reachable path.

### `initialize_launch` / `create`
- Curve params validated: `virtual_sol_reserves > 0`, `virtual_token_reserves > 0`, `total_supply > 0`,
  `fee_bps` within sane bounds (L2/L5).
- Mint authority set to the launch PDA; freeze authority `None` (or the launch PDA with a documented
  purpose).
- Dev allocation, if any, is a **constant init parameter** — visible on-chain now, not minted later (L10).
- Launch PDA derived from a **collision-resistant** seed (`[b"launch", mint.key().as_ref()]` is fine;
  `[b"launch", creator.key()]` allows cross-creator collision).
- **Exact init only** — no `init_if_needed` (reinit); initial `real_sol_reserve = 0` set explicitly,
  not inherited from account creation.

### `buy`
- `amount_in > 0`, `min_amount_out > 0`.
- Curve formula uses `u128`(+) intermediates and `try_into::<u64>()` with an explicit overflow error;
  **no division before multiplication** (L5). Div-by-zero guarded when `virtual + sold == 0`.
- **Slippage on the post-fee delivered amount:** `actual_out_after_fee ≥ min_amount_out` — not the
  gross, pre-fee figure (L14).
- SOL transferred **before** token mint; a revert reverts both legs; virtual + real reserves updated
  atomically with no read-modify-write window (L2).
- Anti-snipe applied if intended (first-N-slot fee escalation / rejection) (L11).
- No re-entrancy: no CPI into a Token-2022 **TransferHook** mint before the state update completes.
- `Buy` event emitted with `(user, amount_in, amount_out, new_reserves)`.

### `sell`
- All `buy` checks, symmetrically (L1/L2/L5/L14).
- `amount_in ≤ seller_token_balance` (pre-checked for a clean error even though the token program also
  enforces it).
- Reserve does not **underflow** when the curve is near-empty.
- **Round-trip property holds:** `sell(buy(x)) ≤ x` net of fees — asserted by a property test (L3).

### `complete_launch` / `graduate` (highest-risk instruction)
- Threshold check reads **on-chain state** (`real_sol_raised ≥ THRESHOLD`), not a parameter; any time
  gate uses `Clock` (L8).
- **One instruction** performing: AMM init + liquidity seed + LP mint + LP→sink + curve close (L6).
- LP recipient **hard-coded** (burn address / governance PDA / vesting escrow) — never a parameter (L7).
- Downstream AMM program id **validated** against the expected id (Raydium / PumpSwap / Orca / Meteora).
- Curve PDA closes to a **documented** destination (treasury / burn) — no rent leak to an attacker.
- **Idempotent:** a second `complete_launch` fails; the launch account is marked closed (`data[0]=0xff`)
  post-migration to prevent revival (L9).

### `claim_dev_share`
- Signer is the **recorded** dev (stored at `initialize_launch`), not a caller-supplied key.
- Vesting enforced if any: `now ≥ cliff_ts` (from `Clock`), linear-release math checked; claim
  `≤ total_dev_allocation − already_claimed` using `checked_sub` (L10).
- Dev share paid in the **post-graduation** asset (LP or AMM-tradeable tokens), not raw curve credits.

### `update_curve_params`
- If it exists at all, **justify it** — most curves should be immutable post-init.
- If mutable: authority is a governance PDA (not a single key); **no** parameter change can retroactively
  alter outstanding token claims (e.g. changing `total_supply` after sales); a timelock gates changes.

### `execute_swap` (aggregator)
- Route is a **typed enum** (`RouteLeg::RaydiumV4 { … }`), not `Vec<AccountInfo>` (L13).
- **Every** hop's target program validated against the allowlist / registry; **every** pool account's
  `owner == its declared program`; each leg's input mint matches the previous leg's output mint (L13).
- Total user input transferred at the start; total user output at the end; **final** slippage check
  `user_balance_after − user_balance_before ≥ min_amount_out` — **measured**, not computed (L14).
- Any hop failure reverts the **whole** tx; no leftover intermediate ATA dust (L15).
- Token-2022 mints in the route trigger extension parsing → **refuse** incompatible hooks/fees rather
  than silently under-deliver (L16).
- Compute-budget instruction included so a long route can't exhaust CU mid-execution.

### `init_aggregator_route` / registry admin (registry-based routers)
- Only an **admin** (multisig / governance) can register a pool program; each registered pool has a
  pinned decoder/version; upgrades go through governance; a **deregistration** path exists for
  compromised pools (L13).

### admin / emergency (both families)
- A **pause** flag exists (launchpad: pause graduation; aggregator: pause new swaps) that **does not**
  freeze user exits — sellers must always be able to exit the curve; aggregator users must always be
  able to recover from any partial state.
- Admin can rotate authority but **cannot** drain reserves directly; emergency-unwind is documented for
  an upstream-AMM failure mid-graduation.

---

## 3. High-density surfaces (fastest findings)

- **S1 — Curve-math overflow / precision.** The `buy(amount_in) → amount_out` formula is the
  most-bugged primitive: `u64·u64` overflow on large reserves; a `u128` intermediate re-truncated by
  `as u64` (silent high-bit loss); div-by-zero when `virtual + sold == 0`; **division before
  multiplication** losing precision; rounding that favors the user on **both** buy and sell (reserves
  leak over time); curve params read from instruction data instead of init-time (L1/L2/L5). Beyond the
  integer-overflow and rounding-precision vuln-classes: the launchpad angle is that a single truncation
  mis-prices **the entire curve**, not one trade.
- **S2 — First-trade / first-buyer manipulation.** A launch tx that creates the curve at ~0 price plus a
  same-slot buy lets a bot capture the first-buyer surplus: same-bundle deployer front-run (init + buy in
  one Jito bundle), a subsequent-slot sniper racing public RPCs, or a "founder allocation" disguised as a
  first trade (L11). Mitigations are sociotechnical (bundle-atomic init + first public buyer, escalating
  first-N-slot fees, lockout windows).
- **S3 — Graduation race / non-atomic migration.** Graduation must **atomically** read threshold → init
  the downstream AMM → seed liquidity → mint LP → deliver to the sink → close the curve. Split across
  transactions, anyone with curve write-access pulls reserves between steps. Seen forms: two-instruction
  graduation (empty pool exploitable between init and seed), LP recipient as a parameter, and a
  deployer-*signed* graduation instead of a state predicate (L6/L7/L8). This is the surface behind the
  canonical pump.fun bonding-curve drain.
- **S4 — Aggregator route validation (the arbitrary-CPI defense).** The classic failure: the aggregator
  accepts a `Vec<AccountMeta>` and CPI-invokes the first program, and the attacker supplies a fake "pool"
  that is a draining program. **Allowlist every hop's program id, check every pool's owner, and parse the
  route as a typed enum** (L13). Beyond `CPI-010` (validate the program id in `invoke_signed`): here the
  *whole route* is untrusted input and **each** hop is a separate arbitrary-CPI opportunity.
- **S5 — Slippage sided wrong.** `require!(amount_out >= 0)` (a tautology); a check against the off-chain
  `expected` instead of the on-chain post-fee `actual`; a check on the **first** hop's output instead of
  the **last**; a check on the **gross** amount while the user receives the **net** (L14).
- **S6 — Token-2022 breaks the route.** `TransferFee` mints deliver less than the pool quoted;
  `TransferHook` mints can revert mid-route or run arbitrary CPI before the swap completes;
  `PermanentDelegate` lets the mint authority claw tokens back post-swap (L16). Enumerate which extension
  each pool type supports and record the **fail-closed** behavior (revert vs silent under-delivery).
  Cross-ref the Token-2022 extension methodology.

---

## 4. Cross-cutting concerns

- **Permissionless listings ARE spam infrastructure.** Anyone-can-list launchpads produce hundreds of
  thousands of tokens, mostly scams — the program may be clean but the **namespace** is the threat model;
  ticker-collision is a phishing surface, and "non-custodial launchpad" does **not** mean "user funds
  safe" since per-launch authority is the deployer. Treat this as an operational/repudiation finding, not
  a code bug (L12).
- **Front-end / RPC fairness.** Launch price discovery resolves in milliseconds, so a user on a
  rate-limited public RPC loses every race to one on a paid tier (Helius / Jito / Triton) — connection
  latency alone decides who captures the edge. Not a program bug, but a fairness finding to raise against
  any "fair launch" claim (L17).
- **Bundle ≠ transaction atomicity.** A Jito bundle can be dropped, leaving a launch tx unbundled and
  snipeable — bundle-based atomicity is **not** on-chain atomicity. Where the program routes bundle tips,
  validate the tip account (a program routing tips to attacker-controlled accounts is a griefing vector),
  and treat bundle-tip pricing oracles as poisonable (L11/L17).
- **Insider / privileged-access abuse.** The canonical launchpad incident combined **retained insider
  access** with flash loans to drain active bonding curves before they could migrate. Two lessons for the
  audit: (a) admin instructions must be multisig + timelock with **no** single-key drain path, and (b)
  the curve invariant (reserve conservation, no round-trip profit) must hold **even under a
  single-transaction flash-loan-scale insert-and-remove** — fuzz with large in/out in one tx (L2/L3).
- **Token-2022 compatibility (aggregators).** Most routers silently break on `TransferFee`,
  `TransferHook`, `PermanentDelegate`, `MintCloseAuthority`. The audit must enumerate which extensions
  each pool type supports and identify the fail-closed behavior. Cross-ref the extension methodology (L16).
- **Off-chain quote authenticity (RFQ / intent).** Solver quote signatures, replay protection (`nonce`,
  `expiry`), and quote-account binding to the executor must all be present; missing any one is a
  solver-collusion or settlement-replay vector.

---

## 5. Attacker goals (frame the review)

Work backward from what an attacker wants; each maps to invariants to break:

1. **Drain the curve reserve** — overflow/precision mis-pricing (L5), round-trip profit (L3), or a
   graduation race that exposes reserves mid-migration (L6).
2. **Redirect the graduation LP** — LP recipient as a parameter (L7).
3. **Graduate early / never / on my timing** — a caller-controlled or off-chain trigger (L8).
4. **Re-run graduation** — non-idempotent migration (L9).
5. **Capture the first-buyer surplus** — same-slot/same-bundle snipe on a ~0 price launch (L11).
6. **Route funds into my own program** — an unvalidated aggregator hop = arbitrary CPI (L13).
7. **Skim on the route** — slippage checked pre-fee / per-hop / against the off-chain quote (L14).
8. **Break delivery with a weird mint** — Token-2022 fee/hook/clawback passthrough (L16).
9. **Dump hidden supply** — an opaque dev allocation minted after launch (L10).

---

## 6. Test / PoC strategy

- **Curve-math property tests (L1–L5) — Trident / `proptest`.** Assert **monotonicity** (N random buys →
  spot price strictly increases; N random sells → strictly decreases); **reserve conservation**
  (`virtual_sol + real_sol == initial_virtual + Σ net_sol_in` after every op); **round-trip
  non-profitable** (`sell(buy(x)) ≤ x` net of fees); **path-independence** (`buy(A);buy(B)` == `buy(A+B)`
  modulo rounding); and **no overflow** on `u64::MAX`-scale inputs (must error, not truncate).
- **Differential test against a reference impl (L1/L5).** A Python/Rust reference of the curve formula
  replayed against the on-chain result — confirm the formula matches the whitepaper and the **rounding
  direction** matches the spec.
- **Graduation atomicity + idempotency tests (L6/L9) — MANDATORY, LiteSVM/Bankrun.** Attempt to move
  reserves *between* a two-step graduation → must be impossible (single-instruction) or must revert;
  call `complete_launch` a **second** time → must fail with reserves unmoved; attempt graduation below
  the threshold → must reject; attempt to pass an LP recipient → the parameter must not exist / be ignored
  in favor of the hard-coded sink.
- **Flash-loan-scale curve fuzz (L2/L3) — the insider-incident lesson.** Fuzz with large
  insert-then-remove in a **single transaction**; the reserve/price relationship must still hold — no
  net extraction.
- **Route-parser fuzz (L13/L15/L16) — MANDATORY for aggregators, cargo-fuzz / Trident on `execute_swap`.**
  Feed malformed `RouteLeg`s, mixed Token / Token-2022 mints, and every extension combination; each must
  **revert**, never silently under-deliver. Explicitly submit a route whose hop program is **not** on the
  allowlist, and a pool whose `owner != declared program` → both must reject.
- **Slippage-edge tests (L14).** `min_amount_out = u64::MAX` → reverts; `= actual` → succeeds;
  `= actual + 1` → reverts; a route that under-delivers at an intermediate hop but meets the per-hop
  bound → the end-to-end check must still catch it.
- **MEV simulation (L11/L17) — custom Jito-bundle harness.** First-buyer-snipe scenarios, sandwich
  resistance, and JIT-LP-on-first-block scenarios where an attacker adds CLMM liquidity right before a
  known swap to capture the fee.
- **Mainnet-fork replay — Surfpool.** Replay an aggregator route against real Raydium / Orca / Meteora
  pools, and replay a graduation against the real downstream AMM so integration reflects mainnet
  conditions.

---

## Launchpads / aggregators checklist (fast pass)

- [ ] Variant classified (curve vs auction vs router vs intent); math-heavy vs routing-heavy scoped (§0)
- [ ] Price strictly monotonic on buy (up) and sell (down); no dust/rounding reversal (L1)
- [ ] Reserves conserved: `virtual + real == initial_virtual + Σ net_in` at every boundary (L2)
- [ ] No round-trip profit: `sell(buy(x)) ≤ x` net of fees — property-tested (L3)
- [ ] Path-independent: `buy(A);buy(B)` == `buy(A+B)` modulo rounding (L4)
- [ ] `u128`(+) intermediates + checked downcast; no division-before-multiplication (L5)
- [ ] Graduation atomic: AMM init + seed + LP mint + LP→sink + curve close in one tx (L6)
- [ ] LP sink hard-coded (burn / governance / vesting) — never a caller parameter (L7)
- [ ] Graduation trigger reads on-chain state; time gates use `Clock` — not a parameter (L8)
- [ ] No double-graduation: idempotent; launch marked closed post-migration (L9)
- [ ] Dev allocation fixed and visible at init; vesting on-chain if any (L10)
- [ ] First-buyer / anti-snipe protection present on ~0-price launches (L11)
- [ ] Permissionless-listing rate-limiting; mint namespace treated as threat model (L12)
- [ ] Route validation: allowlist EVERY hop's program + owner-check every pool; typed-enum route (L13)
- [ ] Slippage on final route output, post-fee, from a measured delta (not computed) (L14)
- [ ] Route atomic: any hop failure reverts the whole tx; no dust persists (L15)
- [ ] Token-2022 mints on the route detected and handled fail-closed, never silent passthrough (L16)
- [ ] Sandwich-resistant defaults; bundle-tip accounts validated (L17)
- [ ] MANDATORY negatives pass: graduation atomicity/idempotency, route-parser fuzz, non-allowlisted-hop, flash-loan curve fuzz (§6)

*Public exploit referenced: pump.fun (2024, ~$1.9M) — retained insider access combined with flash loans
to drain active bonding curves before graduation; reference for dev-allocation transparency (L10),
graduation atomicity (L6), and the flash-loan-scale reserve-invariant test (§6). Curve mechanics
(constant-product / linear / Dutch), graduation lifecycle, and aggregator route-validation are public
protocol architecture. Cross-refs: `references/methodologies/amm-clmm.md` §10 (bonding-curve launchpad
specifics + the AMMs aggregators compose over), the Token-2022 extension methodology (extension-aware
routing), `references/methodologies/governance.md` (DAO-controlled curves / graduation), plus base checks
`CPI-010` (invoke_signed program-id — the per-hop arbitrary-CPI defense), `SM-027` (reinit), and
`EXT-012`/`EXT-013`/`EXT-014` (extension enumeration / delta accounting).*
