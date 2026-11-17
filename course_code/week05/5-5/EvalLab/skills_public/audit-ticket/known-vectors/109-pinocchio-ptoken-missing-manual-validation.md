---
id: 109
title: "Pinocchio / p-token — Missing Manual Validation in Zero-Copy Native Programs"
severity: 8
category: crypto
---

### 109 — Pinocchio / p-token: Missing Manual Validation in Zero-Copy Native Programs

**Severity: 8** | **Real: 2025-2026 — Anza's p-token (SIMD-0266) replaced the SPL Token program at its canonical ID via feature-gate swap; the Pinocchio framework popularized writing native programs without Anchor's safety net**

Pinocchio (anza-xyz) is a zero-dependency, zero-copy Solana framework that reads the instruction input buffer directly instead of deserializing via `solana-program`/Anchor. **p-token** is the SPL Token program reimplemented on Pinocchio (SIMD-0266): it activates as a feature-gate swap at the **same program ID** (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), byte-for-byte identical in account layouts and instruction discriminators, cutting a transfer from ~4,645 CU to ~76 (`transfer_checked` ~6,200 → ~105). The canonical p-token was heavily vetted — audited by **Zellic**, formally verified by **Runtime Verification**, and equivalence/differential-tested by **Neodyme** (replaying recent mainnet transactions against both implementations and confirming identical output).

**That bar does NOT extend to third-party programs that adopt Pinocchio for their own logic**, where the CU win comes from removing abstractions — and every guarantee Anchor gives for free (owner, discriminator, signer, mut, bounds) becomes a manual check. This vector therefore targets: (a) **custom native/Pinocchio programs in the audited codebase**, and (b) **any fork or reimplementation of token logic** that must match canonical SPL Token semantics. Any check dropped to save CU — owner, signer, frozen-state, decimals, bounds — is exploitable.

#### Verification Procedure

**Step 1: Detect Pinocchio / native (no-Anchor) program**
```
grep -rn -iE "pinocchio|p-token|p_token|no_std" programs/ Cargo.toml */Cargo.toml
grep -rn -E "entrypoint!|program_entrypoint!|fn process_instruction" programs/
```
- If Anchor (`anchor-lang`) only: this vector is N/A (use AV/AC/CPI checklists as normal)
- If Pinocchio / native: every guarantee below is MANUAL — proceed

**Step 2: Manual owner check on every account**
```
grep -rn -E "\.owner\(\)|owner ==|assert.*owner|is_owned_by|key\(\) ==" programs/
```
- ✅ PASS: Every account that is deserialized/trusted has its `owner` explicitly verified against the expected program ID
- ❌ FAIL: An account is read/trusted without an owner check (Anchor would have done this automatically) — type cosplay / substitution

**Step 3: Manual signer & writability checks**
```
grep -rn -E "is_signer|is_writable" programs/
```
- ✅ PASS: Value-moving / authority operations explicitly assert `is_signer`; mutated accounts assert `is_writable`
- ❌ FAIL: Authority assumed without an explicit `is_signer` check

**Step 4: Account-count and data-length bounds before zero-copy reads**
```
grep -rn -E "get_unchecked|unsafe|from_raw_parts|as_ptr|\.add\(|borrow_data|try_borrow|\[0\.\.|len\(\)" programs/
```
- ✅ PASS: Number of accounts is validated; every byte-slice read is bounds-checked (`data.len() >= N`) before indexing; `unsafe` pointer math has a preceding length guard
- ❌ FAIL: Fixed-index account access (`accounts[3]`) or slice read without a length check — panic / OOB read / UB

**Step 5: Discriminator / type confusion (single-byte discriminators)**
- Pinocchio programs often use a 1-byte (or no) discriminator instead of Anchor's 8 bytes.
- ✅ PASS: Account type is disambiguated by owner + length + explicit tag; cannot be confused with another account of similar layout
- ❌ FAIL: Type inferred from a single byte without owner/length validation — cosplay

**Step 5b: Zero-copy layout — padding/alignment UB and `wincode` deserialization validation**
Pinocchio's CU win comes from zero-copy casts (`bytemuck::from_bytes`, `wincode` in-place). A cast is only *sound* if the layout is fully defined — otherwise it is undefined behaviour, not merely a logic bug.
```
grep -rn -E "repr\(C\)|repr\(C, *packed\)|Pod|Zeroable|from_bytes|from_bytes_mut|_padding|_pad" programs/
grep -rn -E "wincode::deserialize|ZeroCopy::deserialize|SchemaRead|SchemaWrite" programs/
```
- ✅ PASS: every zero-copy struct is `#[repr(C)]`, fields ordered largest→smallest with an **explicit `_padding` field** filling every gap to natural (typically 8-byte) alignment, and `_padding` is **zeroed on construction**. No `&` reference is taken to a field of a `#[repr(C, packed)]` struct. `wincode` zero-copy structs are additionally **tuple-free** (Rust does not guarantee tuple layout).
- ❌ FAIL: a `bytemuck`/zero-copy struct lacking `#[repr(C)]`, or with **implicit padding** (small-before-large field order and no `_padding`) — casting over uninitialized gap bytes is **UB and can leak stale memory** across instructions; `_padding` declared but never zeroed (same leak); an unaligned reference into a `packed` struct.
- ❌ FAIL: `wincode::deserialize(...).unwrap()` inside a handler, or decoded values used without range checks (`wincode` guarantees byte layout, **not** business logic — amounts, deadlines, and enum variants must be validated after decode); dynamic-`Vec` max-size limit raised without a documented upper bound (allocation-exhaustion DoS). Errors must map to `ProgramError::InvalidInstructionData`, never a silent default.

**Step 6: Unsafe account resize bounds**
```
grep -rn -E "unsafe-account-resize|resize|realloc|set_data_length" programs/ Cargo.toml */Cargo.toml
```
- ✅ PASS: If the `unsafe-account-resize` feature is used, the program itself validates the new size stays within permitted bounds (the framework does NOT)
- ❌ FAIL: Runtime resize without a bounds check

**Step 7: p-token / SPL Token semantic compatibility (if reimplementing token logic)**
- Confirm parity with canonical SPL Token on the dangerous edge cases: zero-amount transfer, frozen account rejection, multisig M-of-N signer parsing, `transfer_checked` decimals/mint binding, self-transfer, immutable-owner, and exact error codes.
- The gold-standard method (used by Neodyme for p-token) is **differential testing**: replay the same instructions/transactions against both the reimplementation and canonical `spl-token` and assert identical state + return data + error codes.
- ✅ PASS: A CU optimization never removed a check the canonical program enforces; behavior matches on edge cases (differential-tested against `spl-token`)
- ❌ FAIL: A check (e.g., frozen-state, decimals, signer threshold) was dropped or diverges to save CU

**Step 7b: Batch / deferred-validation instructions — validate at each step, not just final state** (p-token deferred-validation class, 2026)
- p-token / zero-copy **batch** instructions may mutate an account, then **reverse** the change before the instruction returns, so that the *final* account state passes the runtime's post-instruction owner/state check even though an **intermediate** state was invalid (or an account it had no right to touch was transiently written). Validating only the end state — or relying on the runtime's deferred owner check — misses the transient violation.
- ✅ PASS: Every sub-operation in a batch validates owner/signer/bounds **before it acts**, so no intermediate step touches an account it hasn't authorized; correctness does not depend on a later reversal restoring valid final state
- ❌ FAIL: A batch modifies then reverses account data such that only the final state is checked (by the program or the runtime's deferred owner check) — an intermediate invalid write slips through

**Overall verdict:**
- ✅: All owner/signer/bounds/discriminator checks present and explicit; unsafe code guarded; token semantics match canonical
- ⚠️: Mostly validated but some reads lack explicit bounds checks or rely on layout assumptions
- ❌: Missing manual owner/signer/bounds checks, or token semantics diverge from SPL Token
- N/A: Pure Anchor/standard program with no native/Pinocchio code of its own — CPIs to the canonical Token program are unaffected (p-token is byte-compatible at the same program ID)
