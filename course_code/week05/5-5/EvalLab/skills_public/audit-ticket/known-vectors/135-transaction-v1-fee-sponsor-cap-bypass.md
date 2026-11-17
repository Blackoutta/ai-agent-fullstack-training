---
id: 135
title: "Transaction v1 Fee-Sponsor Cap Bypass & Disabled ComputeBudget Gates"
severity: 8
category: backend
---

### 135 — Transaction v1 Fee-Sponsor Cap Bypass & Disabled ComputeBudget Gates

**Severity: 8** | **Real: SIMD-0385 transaction v1 (Agave v4.2 line, 2026) moves compute-unit limit, loaded-accounts data size, heap size and priority fee out of `ComputeBudgetProgram` instructions and into the message `config`; ComputeBudget instructions in a v1 transaction execute as successful no-ops. Every fee sponsor, paymaster, gasless relayer, co-signer and on-chain program that enforces a budget or fee policy by scanning those instructions binds nothing on v1 — a class called out publicly ahead of activation**

Two populations enforce policy by reading `ComputeBudgetProgram` instructions, and both are silently disabled by v1:

- **Off-chain fee sponsors / co-signers.** A service that signs as fee payer (or second signer) for user-built transactions typically caps its exposure by scanning the instruction list for `SetComputeUnitPrice` / `SetComputeUnitLimit`, computing `price × limit`, and rejecting above a threshold. A v1 transaction carries its priority fee as a **total in lamports in the message config**, which the scanner never looks at, and may still include harmless no-op ComputeBudget instructions that satisfy the scanner's expectations. The sponsor signs, the runtime charges the config's fee to the sponsor key, and the attacker repeats until the key is empty. The same scanner usually carries other stale assumptions: "≤ 1,232 bytes so it cannot hold much", "check the first N instructions", allowlists evaluated after an ALT-resolution step v1 does not have. v1 allows 64 instructions and 64 inline accounts.
- **On-chain programs introspecting the Instructions sysvar.** Priority-fee floors ("must attach ≥ X micro-lamports/CU", anti-bot), CU-limit assertions, "the budget instruction must be first / the only other instruction" checks. Under v1 no sysvar or syscall exposes the config, so the program either sees no ComputeBudget instruction (and rejects every v1 user) or sees no-op instructions that set nothing (and enforces nothing). The program cannot even tell which version it is running under.

The root cause in both is the same: **policy is derived from the instruction list, but v1 moved the policy-relevant fields to the message header.** The fix is structural version detection (wire byte 0 == `0x81`) followed by reading the config, with an explicit reject for unknown versions — never a fall-through to the v0 parser.

> Cross-ref: `references/vuln-classes/transaction-v1.md` (V1 detect-first, V4 sponsor binds the bytes it signs, V5 no on-chain ComputeBudget gates, §6 sponsor-bypass PoC); KV-136 (the reader / indexer sibling); KV-101 / KV-102 (Instructions-sysvar introspection — precompile checks remain valid, ComputeBudget checks do not); BE-102 (a sponsor key is custody), BE-127..131, AV-089..090, AI-002..006 (machine-signer spend caps).

#### Verification Procedure

**Step 1: Find every place that signs for someone else, and every ComputeBudget scan**
```
grep -rn -iE "feePayer|fee_payer|sponsor|paymaster|gasless|relay|cosign|co-sign|partialSign|signTransaction\(" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" . | grep -viE "test|spec"
grep -rn -iE "ComputeBudget|SetComputeUnitPrice|SetComputeUnitLimit|computeUnitPrice|unit_price|micro.?lamports" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
```
- Record: each service that adds its own signature to a client-supplied transaction, and each cap / allowlist it enforces before signing. If nothing signs for third parties and no program introspects ComputeBudget, this vector is N/A (state it).

**Step 2 (sponsor): Version is detected on the raw bytes before any policy check**
```
grep -rn -E "0x81|== *129|\[0\] *=== *129|getTransactionDecoder|VersionedTransaction::deserialize|from_bytes" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
```
- ✅ PASS: the sponsor decodes the exact submitted bytes with a v1-capable library, branches on byte 0 == `0x81`, and rejects anything the decoder does not recognise; policy runs on the decoded v1 message, never on a re-serialised v0 model
- ❌ FAIL: the transaction is parsed with a pre-v1 library (fails open into a "legacy" shape, or throws and is caught as "no budget instructions"), or version is inferred from `versioned` / size / the presence of a ComputeBudget instruction

**Step 3 (sponsor): Fee and resource caps read the config for v1 and normalise units**
```
grep -rn -E "transactionConfig|transaction_config|\.config\b|priorityFeeLamports|priority_fee|computeUnitLimit|loadedAccountsDataSizeLimit" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
```
- ✅ PASS: for v1 the cap is `5_000 × required_signatures + config.priorityFee` in **total lamports** and `computeUnitLimit` / `loadedAccountsDataSizeLimit` / `heapSize` come from the config; for legacy / v0 the same quantities are derived from the ComputeBudget scan (`price × limit ÷ 10⁶`) so both branches compare like units; no-op ComputeBudget instructions in a v1 tx are ignored, and an *absent* config field is treated as the runtime treats it (0), not as "use the v0 default"
- ❌ FAIL: the cap only inspects ComputeBudget instructions; or a v1 `priorityFee` (lamports) is compared against a micro-lamport-per-CU threshold

**Step 4 (sponsor): Allowlists cover the whole v1 envelope and the sponsor key is protected**
- ✅ PASS: program-id / instruction / destination allowlists evaluate **every** instruction (≤ 64) and **every** inline account (≤ 64); no "first N" or size-based shortcuts; the sponsor key appears only as fee payer (never writable elsewhere, never a signer for an instruction); the exact base64 bytes are simulated with the same config and rejected on `MaxLoadedAccountsDataSizeExceeded` or an unexpected sponsor-balance delta; a per-key / per-user daily lamport budget is enforced independently
- ❌ FAIL: allowlists assume the v0 shape, an ALT step, or a 1,232-byte ceiling; the sponsor key can be referenced as a writable account; no same-bytes simulation; no budget backstop

**Step 5 (program): No on-chain gate depends on ComputeBudget introspection**
```
grep -rn -E "load_instruction_at|get_instruction_relative|instructions_sysvar|sysvar::instructions" programs/ | grep -iE "compute_budget|ComputeBudget|unit_price|unit_limit|heap|priority"
```
- ✅ PASS: no `require!` / branch reads a ComputeBudget instruction; precompile introspection (ed25519 / secp256k1) bounds its search to ≤ 64 instructions and does not assume a ComputeBudget instruction precedes it
- ❌ FAIL: a fee floor, CU floor, "budget must be first", or "exactly one other instruction" check reads ComputeBudget instructions — disabled under v1 (no-ops set nothing) or rejects v1 users (instruction absent); the program has no way to read the v1 config
- N/A: the program does not introspect the Instructions sysvar

**Step 6: Tests prove the bypass is closed**
- ✅ PASS: a test submits a v1 transaction with `priorityFee` above the cap plus satisfying no-op ComputeBudget instructions, and the sponsor rejects it; a test with 64 instructions where the disallowed one is last is rejected; the program test-suite runs under a runtime with the v1 gate active
- ❌ FAIL: sponsor tests only use legacy / v0 fixtures; the "cap" test passes because the fixture puts the fee in a ComputeBudget instruction

**Overall verdict:**
- ✅: Sponsor / co-signer detects version on the raw bytes, enforces fee and resource caps from the config in normalised units over the whole envelope, simulates the same bytes, and keeps a budget backstop; no on-chain gate reads ComputeBudget instructions
- ⚠️: Version detection and config caps exist but allowlists still assume the v0 envelope (first N instructions, ALT step), or the daily budget backstop is missing; or the program's ComputeBudget gate is documented as disabled but not removed
- ❌: A service that pays or co-signs enforces its cap only by scanning ComputeBudget instructions — a v1 transaction with a config-level fee (and optional no-op budget instructions) is signed and paid; or an on-chain fee / CU gate reads ComputeBudget instructions and is silently unenforced under v1
- N/A: Nothing in scope signs transactions built by third parties, and no program introspects ComputeBudget instructions
