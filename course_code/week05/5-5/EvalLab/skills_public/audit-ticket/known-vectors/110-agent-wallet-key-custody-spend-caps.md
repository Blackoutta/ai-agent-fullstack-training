---
id: 110
title: "Agent Wallet Key Custody & Missing Spend Caps"
severity: 9
category: ai-agent
---

### 110 — Agent Wallet Key Custody & Missing Spend Caps

**Severity: 9** | **Real: AI trading-bot & "agent wallet" drainers (2024-2025) — a hot key held in-process signs unbounded value once the process (or its LLM) is subverted; mirrors classic backend-service-wallet compromises but with an autonomous signer**

An autonomous agent (trading bot, MCP-driven assistant, keeper) is handed a Solana keypair so it can sign without a human. If that key is readable by the agent process and no spend cap is enforced in code, then ANY path that makes the agent sign — a prompt injection, a poisoned tool result, a logic bug, a leaked env var — drains the wallet up to its full balance. The wallet's authority is only as bounded as the code around the signer, and here there is none.

This vector targets the CUSTODY and LIMITS around an agent's signing key. It is distinct from blind signing (see 113, which is about *what* gets signed): even a perfectly-decoded transaction is catastrophic if the key is exfiltratable or the per-tx/per-epoch value is unbounded.

#### Verification Procedure

**Step 1: Locate the agent's signing key material**
```
grep -rn --include="*.ts" --include="*.js" --include="*.rs" -iE "fromSecretKey|createKeyPairSignerFromBytes|createKeyPairSignerFromPrivateKeyBytes|Keypair\.fromSeed|readFileSync.*json|PRIVATE_KEY|SECRET_KEY|WALLET_KEY"
```
- Record: where the agent's key is loaded and from where (env, file, KMS handle)

**Step 2: Is the key plaintext / process-readable at rest?**
- ✅ PASS: Key lives in a KMS/HSM, secure enclave, or remote signer; the agent calls a sign RPC and never holds the 64 secret bytes
- ❌ FAIL: Key is loaded from a plaintext env var, a `*.json` keypair file, or a hard-coded byte array the agent process can read and therefore exfiltrate

**Step 3: Per-transaction spend cap enforced in code before signing**
```
grep -rn --include="*.ts" --include="*.rs" -iE "maxAmount|spendCap|MAX_LAMPORTS|per_tx|limit.*amount|amount.*>.*(max|cap)"
```
- ✅ PASS: Before any signature, the built tx's outgoing lamports and per-mint token amounts are checked against a hard maximum; over-limit aborts
- ❌ FAIL: No numeric ceiling on a single agent-signed transaction

**Step 4: Per-epoch / rolling-window cumulative cap, persisted**
- Check that cumulative signed value over a window (hour/day/epoch) is tracked and bounded, and that the counter survives a process restart (DB/persistent store, not in-memory only).
- ✅ PASS: Cumulative cap enforced and persisted — crashing/restarting the agent does not reset the budget
- ❌ FAIL: No cumulative cap, or the counter is in-memory and resettable by restarting the process

**Step 5: Program / instruction / destination allowlists**
```
grep -rn --include="*.ts" --include="*.rs" -iE "allowlist|allowedPrograms|allowedInstructions|whitelist|programId.*==|\.includes\(.*programId"
```
- ✅ PASS: Signer rejects any instruction whose `programId`, instruction type, or transfer/close destination is not on an explicit allowlist
- ❌ FAIL: Agent will sign instructions to arbitrary programs / arbitrary destinations (an injected `SetAuthority`, `Upgrade`, `Assign`, or transfer-to-attacker sails through)

**Step 6: Blast radius — hot vs. cold separation**
- ✅ PASS: The agent's key controls only working capital; treasury/reserves sit in a separate wallet the agent cannot sign for
- ❌ FAIL: The agent's single hot key controls the entire balance / treasury

**Overall verdict:**
- ✅: Key in KMS/remote signer, per-tx AND persisted per-epoch caps, program+instruction+destination allowlists, hot/cold split
- ⚠️: Some caps present but key is process-readable, OR caps exist but no destination/instruction allowlist
- ❌: Plaintext/env key with no spend cap — full-balance drain on any subversion
