---
id: 91
title: "Upgrade Authority Not Secured"
severity: 10
category: devops
---

### 91 — Upgrade Authority Not Secured
**Severity: 10** | **Real: Wormhole governance exploit, multiple rug pulls via authority abuse**

Solana program upgrade authority is a single hot wallet — attacker compromises it and deploys malicious program.

#### Verification Procedure

**Step 1: Check current upgrade authority**
```
solana program show <PROGRAM_ID> 2>/dev/null | grep -i "authority"
```
- Record: Who is the upgrade authority?

**Step 2: Check if authority is multisig**
```
# If the authority is a known multisig program address (e.g., Squads):
# Verify it requires multiple signers
# If it's a single wallet: ❌
```
- ✅ PASS: Upgrade authority is a multisig (Squads, Realm, etc.)
- ⚠️ PARTIAL: Upgrade authority is a hardware wallet (single point of failure but not hot key)
- ❌ FAIL: Upgrade authority is a hot wallet or dev laptop key

**Step 3: Check for upgrade authority in code/config**
```
grep -rn "upgrade.*authority\|programAuthority\|deploy.*keypair" . --include="*.ts" --include="*.toml" --include="*.json" | grep -v node_modules | head -10
```
- ✅ PASS: No hardcoded upgrade authority keypairs
- ❌ FAIL: Upgrade authority keypair in repository

**Step 4: Check if program is frozen (immutable) where appropriate**
```
# For mature programs that don't need upgrades:
# solana program show <ID> should show "Authority: None"
```
- ✅ PASS: Production program frozen (no upgrades possible) or behind multisig timelock
- ⚠️ PARTIAL: Upgrade authority exists but secured with multisig
- ❌ FAIL: Upgrade authority is a single hot key, program upgradeable at any time

**Overall verdict:**
- ✅: Multisig authority or frozen program, no keys in repo
- ⚠️: Hardware wallet authority (acceptable for smaller protocols)
- ❌: Hot wallet as upgrade authority — program can be rug-pulled
