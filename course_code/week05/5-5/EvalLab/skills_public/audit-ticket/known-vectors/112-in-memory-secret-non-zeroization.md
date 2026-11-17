---
id: 112
title: "In-Memory Secret Non-Zeroization (Off-Chain Rust)"
severity: 6
category: crypto
---

### 112 — In-Memory Secret Non-Zeroization (Off-Chain Rust)

**Severity: 6** | **Real: Pattern — cryptographic key material left resident in process memory (recoverable from heap dumps, core dumps, and swap)**

An off-chain Rust service — keeper bot, signer service, indexer with a hot wallet — loads a private key or seed into a `Vec<u8>`, `String`, `[u8; 64]`, or an SDK `Keypair`/`SecretKey` and never wipes it. When that value is dropped, Rust frees the heap allocation **without zeroing it**; the plaintext bytes linger in freed heap, in `Vec` spare capacity, in stack slots, and — if the process is paged out — in swap. Any core dump (a panic-triggered `abort`, a crash handler, `gcore`, a container OOM dump), a swapped-out page read from disk, or a later heap allocation that reads uninitialized memory can recover the key. Unlike a source-code key leak, nothing is committed to git: the exposure is purely at runtime, which makes it invisible to secret scanners and easy to overlook. The idiomatic mitigation is the `zeroize` crate: wrap secret-bearing values in `Zeroizing<...>` or derive `ZeroizeOnDrop` so the memory is overwritten when the value goes out of scope. This applies to off-chain Rust services only — on-chain programs hold no long-lived keys. (Applies to the off-chain Rust scope covered by `checklists/20-rust-offchain-services.md`.)

#### Verification Procedure

**Step 1: Confirm the service holds long-lived key material**
```
grep -rn --include="*.rs" -E "Keypair|SecretKey|SigningKey|from_bytes|read_keypair|secret_key|private_key|seed_phrase|mnemonic|from_base58" src/
```
- If the service never loads a signing key / seed (read-only indexer, no hot wallet): this vector is N/A
- Otherwise: record every type and variable that carries a secret

**Step 2: Check for the `zeroize` dependency and its use**
```
grep -rn -E "^zeroize|zeroize =|secrecy =" Cargo.toml */Cargo.toml
grep -rn --include="*.rs" -E "Zeroizing|ZeroizeOnDrop|\.zeroize\(\)|use zeroize|use secrecy|Secret<|SecretString" src/
```
- ✅ PASS: `zeroize` (or `secrecy`) is a dependency AND every secret-bearing type is wrapped/zeroized
- ❌ FAIL: Secrets loaded (Step 1) but `zeroize`/`secrecy` absent or unused

**Step 3: Secrets stored in raw `Vec<u8>` / `String` without a zeroizing wrapper**
```
grep -rn --include="*.rs" -B2 -A2 -E "let (mut )?(seed|key|secret|priv|mnemonic|entropy)[a-z_]* *(:|=)" src/
```
- ✅ PASS: Secret bytes live in `Zeroizing<Vec<u8>>`, `SecretVec`, `Zeroizing<String>`, or a `#[derive(ZeroizeOnDrop)]` struct
- ❌ FAIL: A key/seed sits in a plain `Vec<u8>`, `String`, or fixed array with no `Drop`-time wipe

**Step 4: Verify a `Drop` / `ZeroizeOnDrop` exists on custom secret-holding structs**
```
grep -rn --include="*.rs" -B3 -A8 -E "struct [A-Za-z0-9_]*(Signer|Wallet|Key|Secret|Vault|Config)" src/
```
- For each struct with a secret field: confirm `#[derive(ZeroizeOnDrop)]` or a manual `impl Drop` that calls `.zeroize()`
- ✅ PASS: Every custom struct carrying a secret zeroizes it on drop
- ❌ FAIL: A struct owns a key/seed field with no zeroization on drop

**Step 5: `Vec` capacity, clones, and intermediate copies**
- `Vec::truncate`/`clear` do NOT wipe the backing buffer; format/base58/hex decode steps often leave intermediate copies. `.clone()` of a secret doubles the resident copies.
- ✅ PASS: Intermediate decode buffers are zeroized; no unnecessary `.clone()` of secrets; the full-capacity buffer (not just len) is wiped
- ❌ FAIL: Secret cloned freely, or an intermediate decode buffer is dropped without zeroizing

**Step 6: Core dumps and swap disabled as defense-in-depth**
```
grep -rn -iE "RLIMIT_CORE|setrlimit|prctl|PR_SET_DUMPABLE|mlock|madvise|MADV_DONTDUMP" src/
grep -rn -iE "core_pattern|ulimit -c|LimitCORE" . --include="*.sh" --include="*.service" --include="*.yaml" --include="*.toml"
```
- ✅ PASS (bonus): Process disables core dumps for the secret-holding process and/or `mlock`s key pages (`MADV_DONTDUMP`)
- ⚠️ PARTIAL: Zeroization present but core dumps not disabled — narrower window remains

**Fix:** Add `zeroize` and wrap every secret in `Zeroizing<...>` or derive `ZeroizeOnDrop`; prefer the `secrecy` crate's `SecretVec`/`SecretString` for values passed around. Zeroize intermediate decode buffers, avoid cloning secrets, and disable core dumps (`PR_SET_DUMPABLE = 0`) for the process holding keys. See `checklists/20-rust-offchain-services.md` §20.5 (RS-011 through RS-014) for the full secrets checklist.

**Overall verdict:**
- ✅: `zeroize`/`ZeroizeOnDrop` (or `secrecy`) applied to ALL secret-bearing types; intermediate copies wiped; no free cloning
- ⚠️: Primary key zeroized, but intermediate decode buffers or clones remain un-wiped, or core dumps not disabled
- ❌: Key/seed held in a plain `Vec<u8>`/`String`/array with no zeroization — recoverable from heap, core dump, or swap
- N/A: Off-chain service holds no long-lived private key or seed (pure read-only indexer)
