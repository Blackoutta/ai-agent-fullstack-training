---
id: 122
title: "Inner-Instruction / Event-Log Spoofing (Off-Chain Consumers)"
severity: 7
category: crypto
---

### 122 — Inner-Instruction / Event-Log Spoofing (Off-Chain Consumers)

**Severity: 7** | **Real: Across Solana event-spoofing class (2026)**

Solana programs surface information off-chain in two spoofable ways: **program logs / `emit!` events** (Anchor events are just base64 log lines) and **inner instructions** (CPIs recorded in the transaction meta). Neither is an authenticated, state-backed fact. A malicious (or compromised) program can **self-CPI** — or simply emit — to fabricate an inner-instruction record or event that *looks* exactly like the one a legitimate action would produce. Any off-chain consumer — **bridge relayer, indexer, oracle, keeper, accounting/webhook backend** — that treats these emitted logs / inner-instruction data as the source of truth can be driven to act on a **forged event**: release funds on a destination chain, credit a balance, or trigger a payout for a transfer that never economically happened.

Two aggravating factors make this worse than a generic "don't trust logs" note:
- **Logs are not bound to success.** Logs and inner-instruction records can appear for instructions that later **revert** within the same transaction, or in transactions that ultimately fail — a consumer that scrapes logs without confirming the transaction reached a **finalized, successful** state acts on a rolled-back event.
- **Attacker-driven CPIs.** A program that lets an attacker cause it to CPI to (or emit as) another program can mint inner-instruction records that a relayer keyed on "program X emitted a Deposit" will accept — the emit is attacker-driven, not a byproduct of a real state change.

The correct posture is: **on-chain state is authoritative; emitted logs and inner-instruction data are hints, never proof.** Off-chain consumers must re-derive the fact from finalized account state (or an on-chain, tamper-evident commitment) rather than trusting what a program said it did.

#### Verification Procedure

**Step 1: Identify off-chain consumers of on-chain program output**
```
grep -rn -E "getTransaction|innerInstructions|meta\.logMessages|logs|parseLogs|onLogs|logsSubscribe" .
grep -rn -E "emit!|emit_cpi!|sol_log|msg!\(" programs/
grep -rn -iE "relayer|indexer|keeper|oracle|webhook|bridge" . --include="*.ts" --include="*.js" --include="*.rs"
```
- Record every place where a bridge/indexer/relayer/oracle/backend **ingests program logs or inner instructions** and takes an action based on them
- If nothing off-chain consumes program logs/inner-ix as truth: this vector is largely N/A on the consumer side (still confirm Step 4)

**Step 2: Consumers verify against finalized on-chain STATE, not emitted logs**
```
grep -rn -E "getAccountInfo|fetch\(|getMultipleAccounts|deserialize|account\.fetch" .
grep -rn -E "'finalized'|\"finalized\"|commitment.*finalized|confirmTransaction" .
```
- ✅ PASS: The action-triggering fact is re-derived from **finalized account state** (or an on-chain commitment), and the consumer confirms the transaction **succeeded and is finalized** before acting
- ❌ FAIL: The consumer acts directly on a scraped log line / `emit!` event / inner-instruction record as if it were authoritative

**Step 3: Events/inner-ix are bound to transaction success**
- ✅ PASS: No action is taken on logs from a transaction that reverted or is not yet finalized; log-derived events are cross-checked against post-state (balance delta, account flag, nullifier/sequence)
- ❌ FAIL: Logs are consumed at `processed`/`confirmed` without a success+finality check, or for instructions that can revert while still emitting

**Step 4: On-chain emits cannot be attacker-driven via CPI**
- ✅ PASS: A program cannot be induced to CPI to (or emit as) another program in a way that fabricates a legitimate-looking event; emissions accompany a real, validated state change and can't be replayed standalone
- ❌ FAIL: An attacker can cause the program to emit / self-CPI to produce an event that a downstream consumer treats as proof of a deposit/transfer that did not occur

**Overall verdict:**
- ✅: Off-chain consumers verify finalized on-chain state and bind to transaction success — they do not trust emitted logs / inner-instruction data as authoritative; on-chain emits cannot be attacker-forged via CPI
- ⚠️: State is checked but at a weak commitment (`processed`/`confirmed`), or logs are used as a fast path with a state re-check that has gaps
- ❌: A bridge/indexer/relayer/oracle acts on emitted logs or inner-instruction records as truth — forgeable via self-CPI and/or reverting-tx log emission
- N/A: No off-chain component consumes program logs / inner instructions to drive value-bearing actions
