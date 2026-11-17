---
id: 113
title: "Autonomous Agent Blind Signing (No Simulation / No Allowlist)"
severity: 8
category: ai-agent
---

### 113 — Autonomous Agent Blind Signing (No Simulation / No Allowlist)

**Severity: 8** | **Real: wallet-drainer kits & malicious-dApp payloads (2022-2025) generalized to autonomous signers — an agent signs whatever transaction it is handed with no simulation and no instruction allowlist**

A human blind-signing a drainer transaction (see vector 67) at least has a wallet UI and a chance to hesitate. An autonomous agent has neither. If the agent signs a transaction it never simulated and never decoded against an allowlist, an attacker who can shape the transaction bytes — via a malicious tool result, a compromised RPC/relayer, a crafted "opportunity" the agent was told to act on, or an upstream service that injects an extra instruction — gets the agent to authorize token approvals, `SetAuthority`, or transfers to the attacker.

This vector is about the SIGNING GATE: is the fully-built transaction simulated, decoded, and allowlist-checked *by the component holding the key* immediately before the signature? It complements 110 (key custody/caps): caps bound the loss, this bounds *what* can be authorized at all.

#### Verification Procedure

**Step 1: Find every place the agent produces a signature**
```
grep -rn --include="*.ts" --include="*.js" -iE "signTransaction|signAllTransactions|signAndSendTransaction|partialSign|\.sign\(|sendAndConfirmTransaction"
```
- Record: each signing call and what builds the transaction it signs

**Step 2: Simulation before signature**
```
grep -rn --include="*.ts" -iE "simulateTransaction|simulate\(|rpc\.simulate"
```
- ✅ PASS: Each transaction is `simulateTransaction`-ed before signing; simulation error aborts
- ❌ FAIL: Signature is produced with no prior simulation — agent signs blind

**Step 3: Simulation result is actually inspected (not just err-checked)**
- ✅ PASS: The simulation's writable-account balance deltas / token changes are compared against the agent's stated intent (expected mint, expected max delta) before signing
- ❌ FAIL: Code only checks `err == null` and signs — an attacker-shaped tx that simulates "successfully" still gets signed

**Step 4: Instruction / program allowlist at the signer**
```
grep -rn --include="*.ts" -iE "programId|instruction.*type|decode.*instruction|allowlist|allowedPrograms"
```
- ✅ PASS: The signer decodes each instruction and rejects any program or instruction type not on an explicit allowlist (e.g., blocks `SetAuthority`, `Approve`, `Upgrade`, unknown programs)
- ❌ FAIL: No decode/allowlist — any instruction set that arrives gets signed

**Step 5: No opaque bulk signing**
```
grep -rn --include="*.ts" -iE "signAllTransactions"
```
- ✅ PASS: No bulk signing, OR each element in the batch passes the same simulation + allowlist gate individually
- ❌ FAIL: `signAllTransactions` signs an opaque array in one shot — one poisoned element rides along

**Step 6: Human-in-the-loop threshold**
- ✅ PASS: Transactions above a configured value, or touching authority-changing instructions, escalate to explicit human approval instead of auto-signing
- ❌ FAIL: Agent auto-signs regardless of value or instruction sensitivity

**Overall verdict:**
- ✅: Simulate + inspect deltas + instruction allowlist + no opaque bulk sign + human threshold on high-value/authority ops
- ⚠️: Simulation present but result not inspected against intent, or no allowlist
- ❌: Signs unsimulated, undecoded transactions — attacker-shaped bytes are authorized blind
