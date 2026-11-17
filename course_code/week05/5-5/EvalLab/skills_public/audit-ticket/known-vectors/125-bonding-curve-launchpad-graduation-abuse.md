---
id: 125
title: "Bonding-Curve Launchpad Graduation & Migration Abuse"
severity: 7
category: crypto
---

### 125 — Bonding-Curve Launchpad Graduation & Migration Abuse

**Severity: 7** | **Real: Zenith audit of Meteora Dynamic Bonding Curve (DBC); Accretion audit of MetaDAO launchpad; Halborn Raydium LaunchLab findings (2025-26 launchpad surface)**

Launchpad / bonding-curve programs move a token from a curve into a real AMM pool at a "graduation" (a.k.a. completion / migration) threshold. The graduation and migration paths are the highest-value surface on these programs and repeatedly ship with distinct, severe bugs:

- **Eligibility ignores locked/reserved buckets.** The completion check compares only the *freely-tradable* sold amount (or the SOL raised) against the threshold, while tokens sitting in locked/vesting/reserved/team buckets are not counted (or, conversely, are wrongly counted). The curve graduates with the wrong reserve composition — over- or under-migrating liquidity, or letting a curve "complete" that is not actually solvent.
- **Pre-created target mint with attacker-held authority.** The migration destination (pool mint / LP mint / the token mint itself) is created ahead of time, and its **freeze authority (or mint authority) is retained by the deployer/attacker rather than renounced or handed to the protocol**. After buyers acquire tokens on the curve, the authority holder freezes the buyers' token accounts (or mints dilutive supply) — bought tokens become unsellable, a rug that passes happy-path graduation tests.
- **Migration DoS via a missing `mut`.** An account that must be written during migration (pool state, vault, curve state, reserve) is declared read-only, so the graduation instruction always fails once the threshold is hit. Funds are trapped on a curve that can never migrate — a permanent liveness rug.
- **Reserve accounting wrong at graduation.** The SOL/token split transferred into the new pool at migration is computed from stale virtual reserves, double-counts fees, or omits the buckets from bullet 1 — the pool opens mispriced or under-collateralized, instantly arbitrageable against the curve's final price.

> Cross-ref: ECON-079..081 (bonding-curve/AMM integrity in checklist 06) and ECON-082..084 (vault reachability & cumulative caps). KV-105 covers the Token-2022 freeze/extension abuse primitive in general; this vector is the launchpad-graduation-specific application.

#### Verification Procedure

**Step 1: Locate the graduation / migration / completion path**
```
grep -rn --include="*.rs" -iE "graduat|migrat|complete|completion|threshold|finaliz|launch|bonding|curve" programs/*/src/
```
- Record: the instruction(s) that flip the curve to a terminal state and move liquidity into the destination pool, and the exact condition that gates them.

**Step 2: Check eligibility counts ALL buckets correctly**
```
grep -rn --include="*.rs" -iE "sold|reserved|locked|vesting|team|threshold|real_reserve|virtual_reserve|total_supply|remaining" programs/*/src/
```
- ✅ PASS: the completion condition excludes locked/reserved/vesting buckets from "tradable sold" (or includes them deliberately and consistently), and the terminal reserve composition is asserted solvent.
- ❌ FAIL: threshold compares raw sold/raised against a constant while locked/reserved tokens are ignored or double-counted — curve graduates with the wrong reserves.

**Step 3: Check the destination mint's authorities are renounced or protocol-controlled**
```
grep -rn --include="*.rs" -iE "freeze_authority|mint_authority|create_mint|InitializeMint|set_authority|renounce|COption" programs/*/src/
```
- ✅ PASS: the token mint AND pool/LP mint have freeze authority disabled (`None`) and mint authority renounced or set to a program PDA — no external key can freeze/dilute post-purchase.
- ❌ FAIL: a pre-created mint retains freeze or mint authority under a deployer/user-supplied key — bought tokens can be frozen (unsellable) or diluted.

**Step 4: Check migration cannot be DoS'd by account mutability / ordering**
```
grep -rn --include="*.rs" -B3 -iE "pool|vault|reserve|curve_state|lp_mint" programs/*/src/ | grep -iE "mut|AccountInfo|Account<|UncheckedAccount"
```
- ✅ PASS: every account written during migration is `mut`; migration is permissionless (or crankable) so it cannot be withheld, and it is atomic (no partial-migration state).
- ❌ FAIL: a written account lacks `mut` (migration always errors → funds trapped), or migration is gated on a single privileged signer who can grief by never calling it.

**Step 5: Check reserve accounting transferred into the pool**
- Confirm the SOL/token amounts moved into the new pool at graduation are derived from real custodied balances (minus already-accounted fees and excluded buckets), not stale virtual reserves, and that a post-migration solvency/backing invariant holds.
- ✅ PASS: pool opens with reserves matching the curve's final state; `actual_moved == expected` asserted.
- ❌ FAIL: pool seeded from stale virtual reserves or with fees double-counted — opens mispriced/under-collateralized.

**Overall verdict:**
- ✅: Locked/reserved buckets excluded from eligibility; token & pool mint freeze/mint authority renounced or protocol-controlled; migration permissionless, atomic, and solvent (reserves match).
- ⚠️: Graduation logic correct but migration depends on a single privileged caller (griefable liveness), or a solvency invariant is implied but not explicitly asserted.
- ❌: Eligibility ignores locked buckets, OR the destination mint retains attacker-usable freeze/mint authority, OR a missing `mut` traps funds at migration, OR the pool is seeded from stale/double-counted reserves.
- N/A: Program is not a launchpad/bonding-curve and has no graduation/migration path.
