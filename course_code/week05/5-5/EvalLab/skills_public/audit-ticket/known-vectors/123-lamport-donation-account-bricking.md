---
id: 123
title: "Lamport-Donation Account Bricking (King-of-the-SOL)"
severity: 6
category: dos
---

### 123 — Lamport-Donation Account Bricking (King-of-the-SOL)

**Severity: 6** | **Real: OtterSec "king-of-the-SOL" (2025)**

Anyone can transfer lamports **into** any account permissionlessly (a plain System-program transfer needs no signature from the recipient). If a program's logic depends on the **exact lamport balance** of a `#[account(mut)]` recipient — or requires **write access** to an account whose writability can change — an attacker can **donate** lamports to permanently brick the instruction:

- **RentState-transition rejection ("King-of-the-SOL").** The Solana runtime rejects a transaction if a writable account ends in an invalid **RentState** transition (e.g., a previously rent-paying account becoming rent-exempt in a way the runtime disallows, or an unexpected lamport delta on an account the program didn't intend to fund). By pre-funding the target account with extra lamports, an attacker forces the instruction's own lamport bookkeeping to produce a runtime-rejected RentState transition every time it runs — a permanent, un-routable DoS with no graceful degradation. If the bricked instruction is on the sole withdrawal/settlement path, funds lock.
- **Executable / builtin lamport-change rejection.** The runtime also rejects lamport changes on executable accounts, and a **feature-gate activation** can silently **demote a writable builtin/sysvar/precompile to read-only**. An instruction that hardcodes `#[account(mut)]` on such an account (or otherwise requires it be writable) breaks the moment the demotion lands — the account can no longer be written, so every call fails.

The common root cause is **assuming an account's lamport balance or writability is under the program's control** when either is externally influenceable (donations) or protocol-versioned (feature gates).

#### Verification Procedure

**Step 1: Find exact-lamport-balance assumptions on donatable accounts**
```
grep -rn -E "\.lamports\(\) ==|lamports\(\) !=|to_account_info\(\)\.lamports|try_lamports|assert.*lamports|== rent|minimum_balance" programs/
```
- Record any instruction that asserts an **exact** lamport value, or computes bookkeeping that assumes the recipient held exactly what the program deposited
- ✅ PASS: No logic assumes an exact balance on any account an attacker can fund; balance checks use `>=` (sufficiency), not `==`
- ❌ FAIL: An instruction requires an account to hold an exact lamport amount (or assumes zero prior balance) — donatable → RentState-transition brick

**Step 2: Find `#[account(mut)]` on shared / builtin / sysvar / precompile accounts**
```
grep -rn -E "#\[account\(mut" programs/
grep -rn -E "mut,?\s*(address\s*=|sysvar|Sysvar|program::ID|system_program|SlotHashes|Instructions|ed25519_program|secp256k1_program)" programs/
```
- ✅ PASS: `mut` is only on accounts the program legitimately mutates; no write access is required on builtins/sysvars/precompiles that a feature-gate could demote to read-only
- ❌ FAIL: An instruction requires write access to a builtin/sysvar/precompile (or any account it does not actually modify) — breaks on demotion

**Step 3: Confirm RentState safety of writable recipients**
- For each writable account that receives lamports: confirm the instruction does not depend on it ending in a specific RentState, and tolerates a pre-existing (donated) balance without a runtime-rejected transition
- ✅ PASS: Deposits/transfers are computed as deltas and the account can absorb extra lamports without an invalid RentState transition
- ❌ FAIL: A donated balance forces an invalid RentState transition, reverting the instruction permanently

**Overall verdict:**
- ✅: No exact-balance assumptions on donatable accounts; no required write access on accounts an attacker can fund or that a feature-gate may demote to read-only; writable recipients tolerate donated lamports
- ⚠️: Uses `>=` balance checks but still marks a shared/builtin account `mut` unnecessarily (fragile to a future demotion)
- ❌: An instruction can be permanently bricked by donating lamports (RentState-transition rejection) or requires writability of an account subject to executable/demotion lamport-change rejection
- N/A: No on-chain program, or no instruction depends on exact balances or writability of donatable/shared accounts
