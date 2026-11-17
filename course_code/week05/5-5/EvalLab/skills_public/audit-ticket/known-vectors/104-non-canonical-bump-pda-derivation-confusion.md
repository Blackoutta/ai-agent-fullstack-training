---
id: 104
title: "Non-Canonical Bump / PDA Derivation Confusion"
severity: 7
category: crypto
---

### 104 — Non-Canonical Bump / PDA Derivation Confusion

**Severity: 7** | **Real: Sealevel Attacks — "bump seed canonicalization"**

`find_program_address` returns the **canonical** (highest valid) bump for a set of seeds. `create_program_address` accepts ANY bump and will succeed for multiple non-canonical bumps, yielding several valid PDAs for the same logical seeds. A program that accepts a user-supplied bump and derives with `create_program_address` (or Anchor `seeds::bump` without storing/reusing the canonical bump) lets an attacker create "shadow" accounts for the same entity — duplicate positions, parallel vaults, or bypassed one-per-user invariants.

#### Verification Procedure

**Step 1: Find PDA derivations and bump handling**
```
grep -rn --include="*.rs" -E "create_program_address|find_program_address|Pubkey::create_program_address|bump" programs/
```

**Step 2: Flag user-supplied bumps fed to create_program_address**
- ✅ PASS: Bumps come from `find_program_address` / Anchor canonical `bump` and are stored in state, then reused via `bump = account.bump`
- ❌ FAIL: An instruction argument bump is passed into `create_program_address` without proving it is canonical

**Step 3: Verify stored-bump reuse on all subsequent access**
```
grep -rn --include="*.rs" -E "bump = [a-z_]+\.bump|bump,\s*$" programs/*/src/instructions/
```
- ✅ PASS: Every access after init uses the stored canonical bump
- ❌ FAIL: Bump re-derived or re-supplied per call (allows non-canonical variant)

**Step 4: Verify one-per-entity invariants hold under non-canonical bumps**
- For "one position per user", "one vault per fund", etc.: confirm a second non-canonical PDA cannot be initialized for the same seeds
- ✅ PASS: `init` uses canonical seeds+bump; duplicates impossible
- ❌ FAIL: Attacker can `init` a parallel account with a non-canonical bump

**Overall verdict:**
- ✅: Canonical bumps only, stored and reused; no `create_program_address` with untrusted bump
- ⚠️: Canonical at init but re-derived elsewhere (defense-in-depth gap)
- ❌: User-supplied bump used in derivation — shadow PDAs possible
