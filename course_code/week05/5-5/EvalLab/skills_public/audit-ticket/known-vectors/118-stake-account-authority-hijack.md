---
id: 118
title: "Stake Account Authority Hijack (Staker Reassignment)"
severity: 8
category: crypto
---

### 118 — Stake Account Authority Hijack (Staker Reassignment)

**Severity: 8** | **Real: SwissBorg/Kiln $41.5M (Sep 2025), Step Finance $27.3M (Jan 2026)**

Solana stake accounts carry **two** independent authorities: **Staker** (delegate, deactivate, split, and set new authorities) and **Withdrawer** (move lamports out, and set new authorities). An attacker slips a hidden `StakeInstruction::Authorize` (or `AuthorizeChecked`) into a larger, legitimate-looking batch/multisig transaction that reassigns **only the Staker** authority to an attacker key — deliberately leaving Withdrawer untouched so that account-level monitoring keyed on "who can withdraw" sees nothing change. With Staker control the attacker redelegates the stake (redirecting rewards) and can deactivate/split at will; in the SwissBorg/Kiln and Step Finance incidents this drained staked SOL and rewards. The pattern is "**Authorize is the new `approve(max)`**": a single authority-change instruction, buried in a batch, hands over ongoing control without an obvious balance movement at signing time.

This is an on-chain finding: a program that performs, proxies, or governs stake operations — or a multisig/governance program that can emit stake CPIs — must treat a Staker authority change with the same severity as a Withdrawer change.

#### Verification Procedure

**Step 1: Find native Stake-program CPIs and Authorize usage**
```
grep -rn --include="*.rs" -iE "stake::instruction|StakeInstruction|solana_program::stake|Stake11111111111111111111111111111111111111|Authorize|AuthorizeChecked|StakeAuthorize" programs/*/src/
```
- Record every path that constructs or forwards a stake `Authorize`/`AuthorizeChecked` instruction, and whether it distinguishes `StakeAuthorize::Staker` vs `StakeAuthorize::Withdrawer`

**Step 2: Confirm both authority roles are handled with equal severity**
```
grep -rn --include="*.rs" -iE "Staker|Withdrawer|staker_authority|withdrawer_authority|new_authority" programs/*/src/
```
- ✅ PASS: any change to **Staker** authority is validated, logged/evented, and allowlisted with the **same** rigor as a Withdrawer change (no asymmetry an attacker can exploit)
- ❌ FAIL: only Withdrawer changes are gated/monitored; Staker reassignment passes unchecked or unlogged

**Step 3: Inspect batched / multi-instruction paths for hidden Authorize**
```
grep -rn --include="*.rs" -iE "remaining_accounts|Vec<Instruction>|invoke(_signed)?|batch|execute_transaction|CpiContext" programs/*/src/
```
- For any batch/proxy/multisig execution path, confirm each inner instruction is inspected and a stake `Authorize` cannot ride along undetected
- ✅ PASS: batched instructions are enumerated and stake-authority changes are surfaced/allowlisted before execution
- ❌ FAIL: batches are executed opaquely — a hidden `Authorize` in a larger tx is not detected

**Step 4: Verify off-chain monitoring/allowlist covers both roles**
```
grep -rn -iE "Authorize|Staker|Withdrawer|stake.*authority" --include="*.ts" apps/ packages/ scripts/
```
- ✅ PASS: monitoring/alerting and any signer allowlist treat Staker and Withdrawer changes identically (equal severity), and unexpected authority changes trigger an alert/block
- ❌ FAIL: monitoring keys only on Withdrawer or on balance movement — a Staker-only reassignment is invisible

**Overall verdict:**
- ✅: Both Staker and Withdrawer authority changes are validated, evented, allowlisted, and monitored with equal severity; batched authorize instructions are inspected
- ⚠️: Withdrawer is well-guarded but Staker changes are only logged, not allowlisted/alerted
- ❌: Staker authority can be reassigned via a batched `Authorize` with no equal-severity gate or monitoring
- N/A: Program never touches, proxies, or governs stake accounts
