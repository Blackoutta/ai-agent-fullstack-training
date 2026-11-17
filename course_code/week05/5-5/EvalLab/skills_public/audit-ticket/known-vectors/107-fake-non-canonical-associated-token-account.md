---
id: 107
title: "Fake / Non-Canonical Associated Token Account (ATA)"
severity: 8
category: crypto
---

### 107 — Fake / Non-Canonical Associated Token Account (ATA)

**Severity: 8** | **Real: ATA-assumption class — programs that trust "a token account for owner X" instead of THE canonical ATA**

A wallet can hold many token accounts for the same `(owner, mint)` pair; only one is the canonical Associated Token Account (deterministically derived from the Associated Token Program). Two mistakes are common and exploitable:
1. The program assumes a passed token account **is** the owner's ATA without deriving it — an attacker passes a different token account they control to redirect credits/airdrops/refunds.
2. The program derives an ATA and assumes it exists / is initialized / is not frozen, or assumes the wrong token program (classic vs Token-2022) for derivation.

This is distinct from KV-016 (mint/authority mismatch): here the mint and owner can be *correct*, but the account is not the canonical ATA the protocol's off-chain/accounting layer expects.

#### Verification Procedure

**Step 1: Find ATA assumptions**
```
grep -rn --include="*.rs" -iE "associated_token|get_associated_token_address|ata|associated_token::authority|associated_token::mint" programs/
grep -rn --include="*.ts" -iE "getAssociatedTokenAddress|createAssociatedTokenAccount|getOrCreateAssociatedTokenAccount" apps/ packages/
```

**Step 2: On-chain ATA accounts are constrained, not just typed**
- ✅ PASS: ATA accounts use Anchor `associated_token::mint = …`, `associated_token::authority = …` (+ correct `associated_token::token_program`), which enforces canonical derivation
- ❌ FAIL: A plain `Account<TokenAccount>` with only `token::authority`/`token::mint` is accepted where the canonical ATA is assumed (any of the owner's token accounts passes)

**Step 3: Correct token program in derivation**
- ✅ PASS: ATA derivation uses the matching token program (classic vs Token-2022) and the program asserts it
- ❌ FAIL: Hardcoded classic Token Program ATA derivation while accepting Token-2022 mints (or vice versa) → wrong/derivable address

**Step 4: Initialization & state assumptions**
- ✅ PASS: Program creates the ATA if needed (or requires it) and checks it is not frozen before relying on it
- ❌ FAIL: Assumes ATA exists/unfrozen — transfer fails or funds route to an unintended account

**Step 5: Off-chain consistency**
- For airdrops/refunds/credits computed off-chain by owner: confirm the destination is the canonical ATA, not "first found" token account
- ✅ PASS: Off-chain resolves canonical ATA and on-chain re-asserts it
- ❌ FAIL: Off-chain trusts a client-supplied token account

**Overall verdict:**
- ✅: Canonical ATA enforced on-chain via `associated_token::*` with correct token program; state checked
- ⚠️: Derivation correct but freeze/existence assumptions unchecked
- ❌: Any owner-controlled token account accepted where the canonical ATA is assumed
- N/A: Program does not use ATAs / does not credit per-owner accounts
