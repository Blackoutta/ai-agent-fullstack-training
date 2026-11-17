---
id: 8
title: "Rug Pull / Admin Backdoor"
severity: 10
category: crypto
---

### 8 — Rug Pull / Admin Backdoor
**Severity: 10** | **Real: Merlin DEX ($1.8M), billions annually in crypto rug pulls**

Hidden admin function drains vault, mints infinite tokens, pauses withdrawals forever, or redirects fees to attacker.

#### Verification Procedure

**Step 1: List ALL admin-only functions**
```
grep -rn --include="*.rs" "pub fn" programs/*/src/instructions/ | grep -viE "test"
```
- For each function: identify if it's admin-only (requires specific authority signer)
- Record: Complete list of admin functions with their powers

**Step 2: Check for unrestricted withdrawal by admin**
```
grep -rn --include="*.rs" -iE "withdraw.*admin\|admin.*withdraw\|emergency.*withdraw\|drain" programs/
```
- ✅ PASS: Admin cannot withdraw investor funds (only performance fees or admin fees from designated accounts)
- ❌ FAIL: Admin can withdraw arbitrary amounts from the main vault

**Step 3: Check for unrestricted mint authority**
```
grep -rn --include="*.rs" "mint_to\|MintTo" programs/ | grep -v test
```
- For each mint_to: verify it's constrained (e.g., only during deposit proportional to deposit amount)
- ✅ PASS: Every mint is proportional to a deposit or earned fee, with correct math
- ❌ FAIL: Admin can mint arbitrary shares

**Step 4: Check if admin can pause withdrawals permanently**
```
grep -rn --include="*.rs" -iE "pause|freeze|lock|disable.*withdraw" programs/
```
- ✅ PASS: No pause mechanism, or pause has timelock/governance, or users can always withdraw after timeout
- ❌ FAIL: Admin can pause withdrawals with no time limit or override

**Step 5: Check for hardcoded admin addresses**
```
grep -rn --include="*.rs" "Pubkey::new_from_array\|pub const.*Pubkey" programs/
```
- ✅ PASS: Admin/authority is stored on-chain in state (can be verified by anyone) and set during init
- ❌ FAIL: Hardcoded addresses that can't be audited or verified

**Step 6: Check fee redirection capability**
```
grep -rn --include="*.rs" -iE "fee.*destination\|treasury\|fee.*recipient\|fee.*account" programs/
```
- ✅ PASS: Fee destination is immutable (set at fund creation) or requires multi-party approval to change
- ❌ FAIL: Admin can silently redirect fees to any address

**Step 7: Check upgrade authority**
```
# In deployed program: who can upgrade?
grep -rn "upgrade_authority\|authority.*program" Anchor.toml
```
- ✅ PASS: Upgrade authority is multisig, governance, or revoked (immutable)
- ⚠️ PARTIAL: Single key upgrade authority with hardware wallet
- ❌ FAIL: Single hot wallet controls upgrades

**Overall verdict:**
- ✅: Admin powers are limited and transparent, no vault drain, no infinite mint, upgrade is secure
- ⚠️: Admin powers are appropriate but upgrade authority is single key
- ❌: Admin can drain vault, mint unlimited shares, or pause withdrawals permanently
