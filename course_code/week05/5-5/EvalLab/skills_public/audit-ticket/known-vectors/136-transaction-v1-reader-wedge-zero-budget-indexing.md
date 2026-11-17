---
id: 136
title: "Transaction v1 Reader Wedge & Zero-Budget Indexing"
severity: 7
category: backend
---

### 136 — Transaction v1 Reader Wedge & Zero-Budget Indexing

**Severity: 7** | **Real: SIMD-0385 transaction v1 (Agave v4.2 line, 2026). Reading v1 is not optional: once one v1 transaction lands, `getTransaction` without `maxSupportedTransactionVersion: 1` returns error `-32015`, `getBlock` fails for the entire block, `blockSubscribe` emits `block: null` and stops advancing; Geyser plugins before 15.1.1 downgrade v1 to v0 on the wire and stale protobuf stubs drop the config field; every indexer that derives fees or compute limits by scanning ComputeBudget instructions records zero for every v1 transaction without an error**

Three failure modes, in increasing order of danger:

- **Loud.** `getTransaction` / `getBlock` without the opt-in (or with the literal `0` / `"legacy"`) error on v1. One v1 transaction anywhere in a block fails the whole `getBlock` response — there is no partial result. Loud is survivable *unless* the error path is misinterpreted: a deposit verifier that treats the error as "transaction not found" never credits the user, and one that retries on error can credit twice.
- **Wedge.** `blockSubscribe` emits `block: null` at the first v1 slot and never advances. A consumer that treats `null` as "empty block" waits forever; a consumer that reconnects re-wedges at the same slot. Pre-15.1.1 Yellowstone plugins do not wedge — they **downgrade** v1 to v0 before the wire, which is worse because nothing errors.
- **Silent.** Indexers, fee estimators, MEV / priority-fee dashboards, keeper pricing and accounting that extract `SetComputeUnitPrice` / `SetComputeUnitLimit` from the instruction list find nothing on v1 and record zero (or "default 200k CU"). gRPC consumers that test `versioned` before checking `Message.config` (proto field 7) classify every v1 as v0. Stubs generated before field 7 existed discard the config on decode. Version bumps of the client crate are not enough: `yellowstone-grpc-client` 13.3.0 only *requires* `yellowstone-grpc-proto` 12.5.0, which lacks the field — the proto crate must be pinned to ≥ 12.6.0 directly. Units changed too: v0 priority fee is micro-lamports **per CU**, v1 is **total lamports**; a pipeline that stores both in one column corrupts every comparison.

The root cause is that the reader / indexer assumed the transaction shape was fixed. The fix is opt-in on every read, structural version detection (`config` first, then `versioned`), a version-agnostic budget accessor that normalises units, persisted `transactionConfig`, and liveness alarms for the wedge case.

> Cross-ref: `references/vuln-classes/transaction-v1.md` (V1–V3, V9–V10, §3 reader and indexer worksheets, §6 fixture block); KV-135 (the sponsor / program sibling); KV-122 (off-chain consumers must bind to finalized, successful transactions — a `-32015` is neither); BE-021 (deposit verification), TS-061..063, RS-018..020, LM-064..065, DEP-087..089, FV-072.

#### Verification Procedure

**Step 1: Enumerate every transaction / block read and stream**
```
grep -rn -E "getTransaction|getBlock|blockSubscribe|get_transaction_with_config|get_block_with_config|getParsedTransaction|getParsedBlock|onLogs|logsSubscribe" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
grep -rn -iE "yellowstone|geyser|SubscribeRequest|SubscribeUpdateTransaction|SubscribeUpdateBlock|carbon|substreams" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" . | grep -v node_modules
```
- Record: each call site and what depends on it (deposit crediting, accounting, fee estimation, keeper pricing, dashboards, archival).

**Step 2: Every RPC read opts in, and the error path is safe**
```
grep -rn -E "getTransaction|getBlock|blockSubscribe|get_transaction_with_config|get_block_with_config" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" . | grep -viE "maxSupportedTransactionVersion|max_supported_transaction_version"
grep -rn -E "maxSupportedTransactionVersion\s*:\s*0\b|max_supported_transaction_version\s*:\s*Some\(0\)|\"legacy\"" .
```
- ✅ PASS: every call passes `maxSupportedTransactionVersion: 1` (JSON integer / `Some(1)`), no literal `0`; a `-32015` or block error is surfaced as an **operational** error — a deposit is neither marked absent nor retried into a double credit; `web3.js` 1.x is ≥ 1.99.0 (read-only support)
- ❌ FAIL: a read omits the opt-in or passes `0`; the catch block maps the error to "not found" / empty; a reader library predates v1 support

**Step 3: Subscriptions treat `block: null` and a stalled slot as failure**
- ✅ PASS: `blockSubscribe` / geyser consumers alarm when the slot does not advance for N seconds or a `null` block arrives; reconnect logic does not silently resume from the same wedge point without alerting
- ❌ FAIL: `null` is treated as an empty block; no slot-liveness alarm; reconnect loops without paging

**Step 4 (gRPC): Version is discriminated on `Message.config` before `versioned`, with regenerated stubs**
```
grep -rn -E "\.versioned|is_versioned|\.config\b|has_config|config *!=|config *is not None" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
grep -rn -E "yellowstone-grpc-proto|yellowstone-grpc-client|@triton-one/yellowstone-grpc" Cargo.toml Cargo.lock package.json */package.json 2>/dev/null; ls **/*.pb.go **/geyser*.ts 2>/dev/null | head
```
- ✅ PASS: order is `config present → v1`, else `versioned → v0`, else legacy; `yellowstone-grpc-proto` ≥ 12.6.0 is pinned directly, stubs (`.pb.go`, generated TS / Python) were regenerated from a schema containing field 7, and the geyser plugin the service consumes is ≥ 15.1.1 (or the operator has confirmed no v1 → v0 downgrade)
- ❌ FAIL: `versioned` is tested first; stubs predate field 7 (config silently dropped); plugin version unknown or < 15.1.1

**Step 5: Budget / fee extraction is version-agnostic and unit-normalised**
```
grep -rn -iE "ComputeBudget|SetComputeUnitPrice|SetComputeUnitLimit|computeUnitPrice|unit_price|micro.?lamports" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
grep -rn -E "transactionConfig|transaction_config|priorityFeeLamports|priority_fee|computeUnitLimit|loadedAccountsDataSizeLimit|heapSize" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
```
- ✅ PASS: one accessor returns `{ version, computeUnitLimit, loadedAccountsDataSizeLimit, heapSize, priorityFeeLamports }` for every version — config for v1, ComputeBudget scan for legacy / v0 with `price × limit ÷ 10⁶` — and a v1 transaction with no ComputeBudget instruction is never recorded as "no priority fee" / "default CU"; the schema stores `version` and `transactionConfig` in dedicated nullable fields and dashboards label units
- ❌ FAIL: fees / limits come only from the instruction scan; v0 price and v1 total share a column; no version column

**Step 6: Downstream consumers of the pipeline are re-validated**
- ✅ PASS: every consumer of the indexed budget / fee data (fee estimator, keeper pricing, MEV dashboard, cost accounting, alerting on "zero-fee" spam) has been run against a v1 fixture block and its output checked; an alert exists for a spike in zero-budget transactions (the signature of silent misparse)
- ❌ FAIL: consumers untested; no fixture; no zero-budget alarm

**Overall verdict:**
- ✅: Every read opts in with a safe error path, subscriptions alarm on wedge, gRPC detection is config-first on regenerated stubs against a ≥ 15.1.1 plugin, budget extraction is version-agnostic with normalised units and persisted config, and downstream consumers are validated on a v1 fixture
- ⚠️: Reads opt in but the error path or the wedge alarm is missing; or detection is correct but stubs / plugin versions are unverified; or units are normalised but not persisted per version
- ❌: A read omits the opt-in (or passes 0) on a path that credits or accounts value; a subscription treats `null` as empty; `versioned` is tested before `config`; fees / limits are derived from ComputeBudget scanning only — v1 transactions silently index as zero-budget
- N/A: Nothing in scope reads transactions or blocks from RPC or Geyser (state the grep evidence)
