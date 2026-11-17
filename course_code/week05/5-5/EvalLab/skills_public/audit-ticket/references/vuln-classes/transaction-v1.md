# Vuln Classes — Transaction v1 (SIMD-0296 / SIMD-0385): Migration & Runtime-Upgrade Blind Spots

> **Load when:** the target **reads, indexes, sponsors, co-signs, builds or introspects Solana transactions** — grep markers:
> `getTransaction` · `getBlock` · `blockSubscribe` · `maxSupportedTransactionVersion` · `max_supported_transaction_version` ·
> `yellowstone` · `geyser` · `ComputeBudgetProgram` · `ComputeBudgetInstruction` · `SetComputeUnitPrice` · `SetComputeUnitLimit` ·
> `computeUnitPrice` · `priorityFee` · `feePayer` / `fee_payer` (as a *service*) · `sponsor` · `paymaster` · `gasless` · `relayer` ·
> `VersionedTransaction` · `TransactionMessage` · `compileToV0Message` · `AddressLookupTable` · `load_instruction_at` ·
> `get_instruction_relative` · `instructions_sysvar` · `transactionConfig` · `0x81` · `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`.
>
> **Purpose:** a runtime upgrade that changes the **transaction wire format** breaks software that never opted in.
> Transaction v1 (spec: SIMD-0385; size increase: SIMD-0296) is opt-in to *send* and mandatory to *read*: once
> one v1 transaction lands in a block, every reader, indexer, fee sponsor, co-signer and introspecting program that
> still assumes the legacy / v0 shape either errors, wedges, or — worst — **keeps running with silently wrong
> values**. This file is the audit playbook for that seam: what changed, who breaks, what "correct" looks like per
> role, and how to test it. It complements `known-vectors/135` (fee-sponsor cap bypass + program introspection)
> and `known-vectors/136` (reader wedge + zero-budget indexing). Checklist items: AV-089..090, TS-061..064,
> BE-127..131, FE-083..084, DEP-087..089, RS-018..021, FV-072, LM-064..065.
>
> **How to use:** §0 is the fact sheet (cite it, do not re-derive); §1 maps roles to failure modes; §2 is the
> invariant catalog; §3 per-role worksheets; §4 fastest findings; §5 grep recipes; §6 tests; fast pass at the end.
>
> **Status at time of writing (Sept 2026):** feature gate `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL` is active
> on testnet and devnet and scheduled for mainnet with the Agave v4.2 line. Always verify with
> `solana -u <cluster> feature status txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL` — never assume from a date.

---

## 0. Fact sheet — what changed (public spec, do not re-derive)

| Limit / behaviour | legacy | v0 | **v1** |
|---|---|---|---|
| Max serialized size | 1,232 B | 1,232 B | **4,096 B** |
| Account addresses | ~32 (size-bound) | 64 via lookup tables | **64 inline** (explicit cap at sanitization) |
| Address lookup tables | no | yes | **not supported** |
| Duplicate addresses in the address list | allowed | allowed | **rejected** at sanitization |
| Instructions | size-bound | size-bound | **≤ 64** (explicit cap) |
| Compute / fee configuration | `ComputeBudgetProgram` instructions | same | **message `config` (mask + fixed-width values)** |
| `ComputeBudgetProgram` instructions | honoured | honoured | **ignored for configuration; execute as successful no-ops** (still cost ~150 CU + one instruction slot) |
| Wire discriminator | signature count first | signature count first; message byte `0x80` | **byte 0 = `0x81`**, signatures at the **tail** (no length prefix) |
| Base58 encoding | ok | ok | **cannot carry > 1,232 B — use base64** for simulate / send |

**Message `config` fields (v1 only) and their defaults when unset:**

| Field | Units | v0 equivalent | **Unset in v1** |
|---|---|---|---|
| `computeUnitLimit` | compute units | `SetComputeUnitLimit` (default 200k/ix, max 1.4M) | **0 → transaction fails** |
| `loadedAccountsDataSizeLimit` | bytes | `SetLoadedAccountsDataSizeLimit` (default 64 MiB) | **0 → fails (`MaxLoadedAccountsDataSizeExceeded`)** |
| `heapSize` | bytes, 32 KiB–256 KiB, multiple of 1 KiB | `RequestHeapFrame` | 32 KiB (the only field with a real default) |
| `priorityFee` (`priorityFeeLamports`) | **total lamports** | `SetComputeUnitPrice` = **micro-lamports per CU** | 0 |

Unit conversion for cross-version comparison: `v0_price_µL_per_CU × computeUnitLimit ÷ 1_000_000 = lamports`.

**RPC:** `getTransaction` / `getBlock` / `blockSubscribe` require `maxSupportedTransactionVersion: 1` (JSON integer).
Without it: `getTransaction` → error `-32015`; `getBlock` → **the whole block errors** (no partial result);
`blockSubscribe` → emits `block: null` and **stops advancing**. `getSignaturesForAddress` is unaffected. Opted-in
responses carry `message.transactionConfig` (v1 only; absent for legacy / v0; unset fields are `null`).

**Geyser / gRPC:** no version parameter exists; v1 arrives as `Message.config` (**proto field 7**). Stale stubs
silently drop unknown fields; Yellowstone geyser plugins before 15.1.1 **downgrade v1 to v0 before the wire**.
Detect version structurally, in this order: `config` present → v1; else `versioned` → v0; else legacy.
(`versioned` is true for both v0 and v1 — testing it first misclassifies every v1 as v0.)

**On-chain:** nothing exposes the message config to programs — no sysvar, no syscall; the Instructions sysvar
carries instructions only. Programs cannot tell which version they run under.

**Minimum library versions (read / send):** `@solana/kit` 8.0.0 · `@solana/web3.js` 3.0.0-rc.3 (1.x ≥ 1.99.0 is
**read-only**, never sends v1) · Rust `solana-*` 4.2.x · `solders` 0.29.0 · `solana-go` 1.23.0 / v2.0.0 ·
`yellowstone-grpc-proto` 12.6.0 (pin directly; `yellowstone-grpc-client` 13.3.0 only requires 12.5.0) ·
Yellowstone geyser 15.1.1 · `@triton-one/yellowstone-grpc` 6.0.0 · Agave / CLI 4.2.0 · Surfpool 1.5.
`@solana/kit-plugin-rpc` can read v1 but its planner **throws on send**; use the manual `pipe()` path.
Hardware-wallet apps may reject v1 with a generic "invalid message" (Ledger app-solana issue #248 at time of writing).

---

## 1. Who breaks, and how

The failure modes split into three kinds. Severity in an audit follows the *kind*, not the component.

| Role in the target | Loud (errors) | Wedge (stops, no error) | **Silent (wrong values, keeps running)** |
|---|---|---|---|
| **RPC reader** (backend verifying deposits, explorer, accounting) | `getTransaction` `-32015`; `getBlock` whole-block error | `blockSubscribe` `block: null`, slot never advances | a "not found / error" path that is caught and treated as *tx does not exist* → deposit never credited, or worse, a retry loop that credits twice |
| **Indexer / Geyser consumer** | none | stalled stream if the plugin build predates 15.1.1 and the consumer errors on shape | **ComputeBudget scan finds nothing → priority fee = 0, CU limit = "default" for every v1 tx**; v1 classified as v0; `config` dropped by stale protobuf stubs; fee analytics, MEV dashboards, cost models all wrong |
| **Fee sponsor / paymaster / co-signer** (service that signs as fee payer or second signer) | decode failure on `0x81` if the library is old (good — it fails closed) | — | **fee / CU cap enforced by scanning ComputeBudget instructions binds nothing on v1**; the attacker sets `priorityFee` in the config (total lamports, any size) and ships harmless no-op ComputeBudget instructions to satisfy the scanner; the sponsor signs and pays. Size / account / instruction-count assumptions (1,232 B, "first N instructions", ALT-resolved allowlists) are also stale |
| **On-chain program introspecting ComputeBudget** (priority-fee floors, "CU limit must be ≥ X", "budget ix must be first", anti-bot fee gates) | — | — | **the gate is silently disabled**: the no-op instructions are present and look valid, but set nothing; or the program *rejects* v1 users because the expected budget ix is absent |
| **Sender** (keeper, bot, backend, dApp) opting into v1 | tx fails: `computeUnitLimit` 0, data-size 0, base58 > 1,232 B, ALT present, duplicate address, plugin-client planner throws | — | priority fee carried over as micro-lamports-per-CU into a lamports field (pays 10⁶× less → never lands, or the reverse: overpays) |
| **Wallet / custody** (dApp → wallet adapter → hardware signer) | signer rejects `0x81` as "invalid message" | user stuck with no fallback | dApp retries with blind-sign prompts; multisig proposal formats that embed v0 messages cannot represent v1 |
| **Infra** (relayers, QUIC ingress, archives, long-term storage) | oversized v1 rejected at a 1,232 B stream window | — | archive read paths that round-trip through a v0-only model drop the config |

**Consequence framing for severity.** Silent fee-cap bypass on a funded sponsor key = direct loss (8–9).
Reader wedge on a deposit-crediting path = availability + double-credit risk (6–8). Zero-budget indexing =
integrity of analytics / fee estimation (4–6, higher if a keeper *prices* from it). Disabled on-chain fee gate =
whatever the gate protected (bot-resistance, MEV floor) — usually 5–7.

---

## 2. Invariant catalog

| # | Invariant | Failure = |
|---|-----------|-----------|
| **V1** | **Version is detected structurally before any policy or parse** — wire byte 0 == `0x81` ⇒ v1; RPC JSON: `transactionConfig` present ⇒ v1; gRPC: `Message.config` (field 7) present ⇒ v1, *then* `versioned` ⇒ v0, else legacy. Unknown / unsupported version ⇒ **reject, never fall through to the v0 parser** | v1 parsed as v0: silent zero budgets; sponsor signs unbounded fee |
| **V2** | **Resource limits and fees are read from one version-agnostic accessor** — config for v1, ComputeBudget scan for legacy / v0 — that normalises units (lamports total) and never returns "0 / default" for a v1 tx because the scan found nothing | Fee analytics and caps silently wrong |
| **V3** | **Every reader opts in** — `maxSupportedTransactionVersion: 1` (integer) on every `getTransaction` / `getBlock` / `blockSubscribe`; no literal `0` / `"legacy"`; `block: null` from a subscription is a **failure**, not an empty block | Wedge / whole-block errors after activation |
| **V4** | **Sponsor / co-signer policy binds the bytes it signs** — decode the exact wire bytes, branch on V1, enforce priority-fee cap in **total lamports** (`5_000 × signatures + priorityFee`), CU and data-size caps from config, program / instruction allowlist over **all** ≤ 64 instructions and **all** ≤ 64 inline accounts, ignore no-op ComputeBudget instructions in v1, simulate the same base64 bytes with the same limits, and keep a per-key / per-user lamport budget as a backstop | Sponsor drain |
| **V5** | **No on-chain gate depends on ComputeBudget introspection** — programs do not read `SetComputeUnitPrice` / `SetComputeUnitLimit` / `RequestHeapFrame` from the Instructions sysvar to enforce anything; precompile (ed25519 / secp256k1) introspection is unaffected but bounds its search to ≤ 64 instructions | Gate silently disabled or v1 users rejected |
| **V6** | **v1 senders set `computeUnitLimit` and `loadedAccountsDataSizeLimit` explicitly** (estimate by simulation with both maxed, add margin, round data size up to 32 KiB pages, size for accounts created between simulate and send), strip ComputeBudget instructions, convert priority fee to total lamports, no ALT, no duplicate addresses, `encoding: 'base64'`, version-aware size assert | Transactions fail on landing, or over / under-pay |
| **V7** | **Feature-gate awareness** — code that sends v1 asserts the gate is active on the target cluster; code that reads is upgraded *before* activation; a tracked-gate monitor alerts on activation | Cryptic failures, or readers wedge at activation |
| **V8** | **Wallet paths degrade explicitly** — a dApp detects signer support for v1 (adapter / hardware app) and falls back to v0 / legacy or blocks with a clear message; it never loops a blind-sign prompt | Users stuck; blind-signing pressure |
| **V9** | **Dependencies meet the minimums and are pinned** — libraries, protobuf stubs (regenerated, not just bumped), geyser plugin, validator / CLI for local testing | Field 7 dropped; v1 downgraded to v0 on the wire |
| **V10** | **Persisted schemas carry version + config** — indexers store `version` and `transactionConfig` per tx; dashboards label fee units; alerts exist for slot-not-advancing, `-32015` rate, and a spike in "zero-budget" transactions | Corruption goes unnoticed |

---

## 3. Per-role worksheets

Each worksheet lists the safe shape. FAIL if any line is missing on any reachable path.

### RPC reader (deposit verification, accounting, explorers) — V1, V3, V10
- Every `getTransaction` / `getBlock` / `blockSubscribe` call site passes `maxSupportedTransactionVersion: 1`
  (integer). Grep for the literal `0` as well as for absence. Beyond `BE-021` (verify the signature on-chain):
  a `-32015` or block error is **not** "transaction not found" — the error path must not mark a deposit as
  absent, and must not retry into a double-credit.
- Subscriptions treat `block: null` and a non-advancing slot as a health failure with an alert (LM-065).
- Library at or above the read-capable minimum; `web3.js` 1.x ≥ 1.99.0 is acceptable **for reading only**.

### Indexer / Geyser consumer — V1, V2, V9, V10
- Version discrimination on `Message.config` presence **before** `versioned`; protobuf stubs regenerated from
  a schema that has field 7 (`yellowstone-grpc-proto` ≥ 12.6.0, pinned directly); geyser plugin ≥ 15.1.1.
- Budget / fee extraction goes through one accessor that returns `{ version, computeUnitLimit,
  loadedAccountsDataSizeLimit, heapSize, priorityFeeLamports }` for every version; v0 price is multiplied by the
  CU limit and divided by 10⁶; v1 no-op ComputeBudget instructions are ignored.
- `transactionConfig` is persisted (v0 has no equivalent field — the schema gains nullable columns, not a
  reuse of the v0 price column with different units).
- Fee estimators, MEV / priority-fee dashboards and keeper pricing that read from this pipeline are listed and
  each has been re-validated against a v1 fixture (§6).

### Fee sponsor / paymaster / co-signer — V1, V4, V6, V7
- Decode the raw bytes the client submitted (base64); byte 0 == `0x81` ⇒ v1 branch; anything the decoder does
  not recognise ⇒ reject (fail closed). Never re-serialize from a parsed v0 model and sign *that*.
- Caps: `priorityFee` (lamports total) + base fee (5,000 × required signatures) ≤ policy; `computeUnitLimit`,
  `loadedAccountsDataSizeLimit`, `heapSize` within policy; for legacy / v0 derive the same numbers from the
  ComputeBudget scan and **normalise before comparing**.
- Allowlists (program ids, instruction discriminators, destination accounts) evaluate **every** instruction and
  **every** inline account — no "first three instructions", no "≤ 1,232 B so it cannot hold much", no ALT
  resolution step that v1 does not have. No-op ComputeBudget instructions in a v1 tx are neither required nor
  trusted.
- Simulate the exact bytes (base64) with the same config; reject on `MaxLoadedAccountsDataSizeExceeded`,
  unexpected fee-payer debits (balance delta of the sponsor key beyond fee), or any writable use of the sponsor
  key as an account other than fee payer (cross-ref BE-102, AI-002..006).
- Per-key and per-user daily lamport budget enforced independently of the per-tx check.

### On-chain program — V5
- No `load_instruction_at` / `get_instruction_relative` read of `ComputeBudgetProgram` instructions feeds a
  `require!` (fee floor, CU floor, "budget must be first", "no other instructions"). If such a gate exists,
  document that it is **disabled under v1** and either remove it or replace the protection (e.g. economic
  bonding) — there is no on-chain read of the v1 config.
- Instruction-introspection loops are bounded and correct for ≤ 64 instructions; `remaining_accounts` and
  positional assumptions hold for ≤ 64 inline accounts (KV-103 posture, now without ALTs).
- Program tests include a run under a runtime with the v1 gate active (`solana-test-validator` ≥ 4.2 or
  Surfpool ≥ 1.5) so no-op ComputeBudget instructions and 4,096-byte transactions are exercised.

### Sender (keeper, bot, backend, dApp) — V6, V7, V8
- `computeUnitLimit` and `loadedAccountsDataSizeLimit` are set explicitly from simulation with margin;
  data size rounded up to the next 32 KiB; accounts that will be created after simulation are sized in.
- Priority fee converted to total lamports (`setTransactionMessagePriorityFeeLamports` / `with_priority_fee`);
  no `SetComputeUnitPrice` carried over; all ComputeBudget instructions stripped.
- No ALT, no duplicate addresses, `encoding: 'base64'`, version-aware size assertion, kit ≥ 8 manual `pipe()`
  path (plugin planner throws), `v1::Message::try_compile_with_config` in Rust.
- Feature gate asserted for the target cluster before the first v1 send; fallback to v0 when the connected
  wallet / signer cannot sign v1.

### Infra — V7, V9
- QUIC / relayer stream windows accept 4,096-byte transactions; archive and cold-storage read paths round-trip
  a v1 transaction without downgrading through a v0-only model; staging validator has the gate enabled.

---

## 4. High-density surfaces (fastest findings)

- **S1 — Sponsor cap via instruction scan (V4).** `for ix of tx.instructions: if programId == ComputeBudget …`
  in a service that signs as fee payer. Confirm it binds nothing for `0x81` bytes. This is the money finding.
- **S2 — Missing / zero `maxSupportedTransactionVersion` on a deposit-verification path (V3).** Then trace what
  the `catch` does: "not found" ⇒ funds never credited; retry ⇒ double-credit.
- **S3 — `versioned` tested before `config` in a gRPC consumer (V1).** Every v1 becomes v0 with empty budget.
- **S4 — Stale stubs (V9).** `yellowstone-grpc-proto` < 12.6.0 or vendored `.pb.go` / generated TS predating
  field 7 — the config is dropped with no error.
- **S5 — On-chain fee floor via introspection (V5).** `require!(cu_price >= MIN)` reading a ComputeBudget ix.
- **S6 — v1 sender with defaults (V6).** `createTransactionMessage({ version: 1 })` with no config setter, or a
  priority fee copied from a per-CU field into `priorityFeeLamports`.

---

## 5. Detection recipes

```
# Readers — opt-in present, and no literal 0
grep -rn -E "getTransaction|getBlock|blockSubscribe|get_transaction_with_config|get_block_with_config" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" . | grep -viE "maxSupportedTransactionVersion|max_supported_transaction_version"
grep -rn -E "maxSupportedTransactionVersion\s*:\s*0|max_supported_transaction_version\s*:\s*Some\(0\)|\"legacy\"" .

# Indexers — ComputeBudget scanning and version detection order
grep -rn -iE "ComputeBudget|SetComputeUnitPrice|SetComputeUnitLimit|computeUnitPrice|micro.?lamports" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
grep -rn -E "\.versioned|is_versioned|\.config\b|transactionConfig|transaction_config" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .
grep -rn -E "yellowstone-grpc-proto|yellowstone-grpc-client|@triton-one/yellowstone-grpc|yellowstone_grpc" Cargo.toml Cargo.lock package.json */package.json 2>/dev/null

# Sponsors / co-signers — who signs as fee payer for someone else
grep -rn -iE "feePayer|fee_payer|sponsor|paymaster|gasless|relay|cosign|co-sign|partialSign|signTransaction\(" --include="*.ts" --include="*.rs" --include="*.py" . | grep -viE "test|spec"
grep -rn -E "0x81|== *129|\[0\] *=== *129" --include="*.ts" --include="*.rs" --include="*.py" --include="*.go" .

# Programs — ComputeBudget introspection
grep -rn -E "load_instruction_at|get_instruction_relative|instructions_sysvar|sysvar::instructions" programs/ | grep -iE "compute_budget|ComputeBudget|unit_price|unit_limit|heap"

# Senders — v1 without explicit limits / with per-CU fee
grep -rn -E "version: *1|v1::Message|TransactionConfig::empty|setTransactionMessageConfig|priorityFeeLamports|with_priority_fee" --include="*.ts" --include="*.rs" .
grep -rn -E "compileToV0Message|AddressLookupTable|lookupTable" --include="*.ts" . | grep -iE "version: *1|v1"

# Feature gate
grep -rn -E "txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL|feature status|getFeatureActivation|is_feature_active" .
```

---

## 6. Test / PoC strategy

- **v1 fixture block (V3, V10).** A block containing at least one v1 transaction (from `solana-test-validator`
  ≥ 4.2 or Surfpool ≥ 1.5 with the gate active). Every reader / indexer path must round-trip it: no error, no
  wedge, version = v1, `transactionConfig` persisted with correct units.
- **Sponsor bypass PoC (V4).** Build a v1 transaction with `priorityFee` far above the sponsor's cap **and**
  harmless `SetComputeUnitPrice` / `SetComputeUnitLimit` no-op instructions that satisfy the old scanner; submit
  to the sponsor endpoint. PASS only if the sponsor rejects. Repeat with 64 instructions where the disallowed one
  is last, and with 64 inline accounts where the disallowed destination is beyond the old scan window.
- **Detection-order test (V1).** Feed the version function a v1 message with `versioned: true` — must return v1.
- **Reader error-path test (V3).** Point the deposit verifier at a v1 signature with the opt-in removed; the
  system must surface an operational error, not "deposit not found" and not a double credit.
- **On-chain gate test (V5).** Run the program under the active gate with a v1 transaction carrying no
  ComputeBudget instruction and one carrying no-op instructions; the fee-floor gate must be shown to be
  unenforceable (finding) or absent (pass).
- **Sender negative tests (V6).** v1 with unset limits → fails at landing; per-CU fee value copied into
  `priorityFeeLamports` → detected by a unit assertion; > 1,232 B over base58 → rejected before send.
- **Wallet fallback (V8).** Simulate a signer that rejects `0x81`; the dApp must fall back or block with a
  message, never loop.

---

## Transaction v1 readiness checklist (fast pass)

- [ ] Version detected structurally (wire `0x81`; JSON `transactionConfig`; gRPC `config` before `versioned`); unknown version rejected (V1)
- [ ] One version-agnostic budget / fee accessor; units normalised to lamports; v1 never reads as "zero budget" (V2)
- [ ] `maxSupportedTransactionVersion: 1` on every reader; no literal 0; `block: null` / stalled slot is an alert (V3)
- [ ] Sponsor / co-signer caps and allowlists bind the exact bytes signed: config-based fee cap in lamports, all ≤ 64 instructions and accounts, no-op ComputeBudget ignored, same-bytes simulation, per-key budget (V4)
- [ ] No on-chain gate reads ComputeBudget instructions from the Instructions sysvar; introspection bounded to ≤ 64 (V5)
- [ ] v1 senders: explicit CU + data-size limits with margin, fee in total lamports, no ComputeBudget ix, no ALT / duplicates, base64, version-aware size check (V6)
- [ ] Feature gate asserted before sending; readers upgraded before activation; gate-activation monitor (V7)
- [ ] Wallet / hardware-signer v1 support detected; explicit fallback (V8)
- [ ] Dependencies at minimums and pinned; protobuf stubs regenerated; geyser plugin ≥ 15.1.1 (V9)
- [ ] Indexer schema stores version + config; dashboards label units; alerts for wedge, `-32015` rate, zero-budget spike (V10)
- [ ] v1 fixture block, sponsor-bypass PoC, detection-order and reader-error-path tests exist and pass (§6)

*Public references: SIMD-0385 (transaction v1 format), SIMD-0296 (larger transactions), the Solana
"Larger Transaction Sizes" upgrade page and `solana-foundation/transaction-v1-examples` (per-language readers,
senders, gRPC indexers with version-agnostic budget readers), Yellowstone geyser / gRPC release notes
(`Message.config` field 7, 15.1.1 downgrade fix), the Solana developer-skill `transactions-v1` reference, and
public write-ups on reader wedges and fee-sponsor cap bypass ahead of activation. Cross-refs: `KV-101` (sysvar
introspection), `KV-103` (ALT positional trust — v0 only), `KV-067` / `KV-113` (blind signing), `BE-102`
(session ≠ custody; sponsor keys are custody), `AI-002..006` (spend caps and allowlists for machine signers),
`checklists/20` (off-chain Rust indexers / keepers).*
