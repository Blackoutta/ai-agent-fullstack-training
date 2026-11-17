---
id: 119
title: "Durable-Nonce Pre-Signed Governance Transaction Abuse"
severity: 9
category: crypto
---

### 119 — Durable-Nonce Pre-Signed Governance Transaction Abuse

**Severity: 9** | **Real: Drift $285M (Apr 2026) — 2nd-largest Solana exploit**

Normal Solana transactions expire when their recent blockhash ages out (~60–90s), which naturally time-bounds a signed transaction to the context in which it was authorized. A **durable nonce** (`SystemInstruction::AdvanceNonceAccount` as the first instruction, using a nonce account instead of a recent blockhash) removes that expiry — the signed transaction stays valid indefinitely until the nonce advances. When admin/governance actions are reachable via durable-nonce transactions, a transaction signed under one authorizing context (e.g. an old multisig configuration, before a migration or membership change) **outlives that context** and can be replayed later against the current state. In the Drift incident, pre-signed durable-nonce admin/governance transactions survived a multisig migration and, with no timelock to catch them, were executed afterward to drain the protocol.

This is an on-chain program-audit finding: any instruction that mutates admin/governance state, moves treasury funds, or changes authorities must not be executable from a pre-signed transaction that can survive the authorizing context.

#### Verification Procedure

**Step 1: Find durable-nonce usage on admin/governance paths**
```
grep -rn --include="*.rs" -iE "AdvanceNonceAccount|nonce_account|durable.?nonce|NonceAccount|recent_blockhashes" programs/*/src/
grep -rn -iE "AdvanceNonceAccount|nonceAccount|createNonceAccount|DurableNonce|advanceNonce" --include="*.ts" apps/ packages/ scripts/
```
- Record whether admin/governance transactions are (or can be) built with a durable nonce rather than a recent blockhash

**Step 2: Confirm admin/governance instructions cannot outlive their authorizing context**
- ✅ PASS: privileged instructions are documented/enforced to use a **recent blockhash only** (natural ~60–90s expiry), and/or a monotonic epoch/`config_version` on the authority account invalidates transactions signed under a prior configuration (a migration bumps the version so stale pre-signed txs revert)
- ❌ FAIL: an admin/governance/treasury instruction can be executed from a durable-nonce (pre-signed) transaction with no version/epoch guard — it survives a multisig migration or membership change and can be replayed

**Step 3: Verify a timelock gates privileged actions**
```
grep -rn --include="*.rs" -iE "timelock|delay|eta|not_before|execute_after|unlock_ts|queued_at" programs/*/src/
```
- ✅ PASS: privileged actions are queued behind an on-chain timelock, so a surfaced pre-signed/stale transaction is visible and cancellable before it can execute
- ❌ FAIL: privileged actions execute instantly — a replayed durable-nonce tx takes effect with no window to react

**Step 4: Verify an aggregate-outflow circuit breaker exists**
```
grep -rn --include="*.rs" -iE "circuit.?breaker|max.*outflow|rate.?limit|withdraw.*cap|daily.*limit|paused|guardian" programs/*/src/
```
- ✅ PASS: an aggregate-outflow / rate-limit circuit breaker caps how much value any admin path (including a replayed one) can move per window, and a guardian can pause
- ❌ FAIL: no outflow cap — a single replayed governance transaction can drain the protocol

**Overall verdict:**
- ✅: Admin/governance instructions are recent-blockhash-only (or version/epoch-guarded), gated by a timelock, and bounded by an aggregate-outflow circuit breaker
- ⚠️: Recent-blockhash-only or version-guarded, but no timelock or no outflow cap
- ❌: Privileged actions reachable via durable-nonce pre-signed transactions that outlive the authorizing context, with no timelock and no circuit breaker
- N/A: Program has no admin/governance/treasury-mutating instructions
