---
id: 127
title: "ATA / Account Pre-Creation DoS (Init Front-Running)"
severity: 6
category: dos
---

### 127 — ATA / Account Pre-Creation DoS (Init Front-Running)

**Severity: 6** | **Real: recurring across Accretion, Sec3, and Neodyme reports**

Account creation on Solana is permissionless: anyone can create an Associated Token Account for any (owner, mint) pair, or fund/allocate any address whose derivation is public. If a permissionless instruction hardcodes `init` (which requires the account to **not** already exist) on an account whose address an attacker can predict — most commonly an ATA, but any user-derivable PDA — the attacker simply creates that account first. The honest instruction then hits "account already in use" and reverts **every time**, with no path to recover. Because the target is fully determined by public inputs (owner + mint, or known seeds), the griefer can pre-create it the moment they see the victim intends to act (or pre-emptively for all likely victims), turning a one-time race into a durable denial of service on whatever flow depends on that init.

> This is distinct from reinitialization (KV-014 / AV-023–024): the attack is not re-running init on live state, it is **blocking the first init** so the legitimate instruction can never complete. The fix is the mirror image — instead of guarding against re-init, tolerate the pre-existing account.

#### Verification Procedure

**Step 1: Find `init` (not `init_if_needed`) on user-derivable accounts in permissionless instructions**
```
grep -rn --include="*.rs" -E "init\b|associated_token::|init_if_needed" programs/*/src/
```
- List every account created with plain `init` whose seeds/address depend only on public inputs (an ATA, or a PDA seeded by an attacker-known pubkey/mint)
- Flag those reachable from an instruction any user can call without prior authorization

**Step 2: Classify each — can an attacker pre-create the address?**
```
grep -rn --include="*.rs" -E "get_associated_token_address|find_program_address|create_associated_token|ATA|Associated" programs/*/src/
```
- ✅ PASS: the account is either created with `init_if_needed` **plus** explicit validation of its state (owner/mint/discriminator/initialized flag), or the instruction otherwise handles the already-exists case gracefully, or creation is gated behind a signer the attacker cannot impersonate
- ❌ FAIL: plain `init` on an attacker-derivable account in a permissionless path — front-runnable to permanent revert

**Step 3: Confirm the pre-existing path is safe, not just non-reverting**
- Where `init_if_needed` is used, verify the "already existed" branch re-validates the account so a pre-seeded/malicious account cannot smuggle attacker-chosen state into the flow (avoid trading a DoS for a reinit bug)
- ✅ PASS: pre-existing accounts are fully re-validated before use; the attacker gains nothing by pre-creating
- ❌ FAIL: `init_if_needed` accepts a pre-existing account without checking owner/authority/mint/flags

**Overall verdict:**
- ✅: No permissionless `init` on an attacker-derivable account, OR `init_if_needed` + full state validation of the pre-existing case, OR the already-exists case is explicitly and safely handled (documented)
- ⚠️: Uses `init_if_needed` but the pre-existing branch is only partially validated, or the risk is acknowledged but unmitigated
- ❌: Plain `init` on an ATA / user-derivable account in a permissionless instruction — an attacker front-runs creation and permanently bricks the honest call
- N/A: No on-chain program, or all `init` targets are non-predictable / gated behind an unforgeable signer
