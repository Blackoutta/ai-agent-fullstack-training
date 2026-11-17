---
id: 20
title: "Program Upgrade Hijack"
severity: 10
category: crypto
---

### 20 — Program Upgrade Hijack
**Severity: 10** | **Real: Multiple Solana rug pulls via upgrade authority compromise**

Attacker compromises the upgrade authority wallet → deploys malicious program version → drains all funds in next transaction.

#### Verification Procedure

**Step 1: Check current upgrade authority**
```
# For mainnet-deployed program:
solana program show <PROGRAM_ID> --url mainnet-beta
# Look for "Authority" field
```
- ✅ PASS: Authority is a multisig, governance program, or `none` (immutable)
- ⚠️ PARTIAL: Authority is a single hardware wallet
- ❌ FAIL: Authority is a hot wallet or unknown address

**Step 2: Check Anchor.toml configuration**
```
grep -rn "upgrade_authority\|authority\|wallet\|program_id" Anchor.toml
```
- Record: The configured upgrade authority

**Step 3: Verify upgrade process is documented**
```
# Check for deploy/upgrade documentation
find . -name "*.md" | xargs grep -li "upgrade\|deploy" 2>/dev/null
```
- ✅ PASS: Documented upgrade process with multi-party approval
- ❌ FAIL: No upgrade documentation, ad-hoc process

**Step 4: Check for timelock on upgrades**
```
grep -rn "timelock\|delay.*upgrade\|buffer.*deploy" . --include="*.ts" --include="*.rs" --include="*.md"
```
- ✅ PASS: Timelock or governance vote required before upgrade takes effect
- ⚠️ PARTIAL: Manual review process but no on-chain timelock
- ❌ FAIL: Instant upgrades possible

**Step 5: Verify program is verified on explorer**
```
# Check if program is verified on Solana FM, Solscan, or similar
# Verified means the deployed bytecode matches the published source
```
- ✅ PASS: Program is verified and source matches
- ❌ FAIL: Program not verified — users can't confirm the running code

**Overall verdict:**
- ✅: Multisig authority, timelock, verified on explorer, documented process
- ⚠️: Single hardware wallet, manual review, verified
- ❌: Hot wallet authority, no timelock, not verified
