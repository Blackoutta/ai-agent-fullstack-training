---
id: 124
title: "Custodial Cleartext Key Export / Recoverable Signing Material"
severity: 8
category: crypto
---

### 124 — Custodial Cleartext Key Export / Recoverable Signing Material

**Severity: 8** | **Real: DEXX $30M (Nov 2024) — custodial trading platform exposed users' raw private keys, one breach drained thousands of wallets**

A custodial product holds signing material on behalf of its users and exposes it in the clear **by design**. Two shapes: (1) an `export_wallet` / "reveal private key" / "backup seed" path renders or transmits the raw private key or mnemonic to the client (or an admin), and (2) custodial signing material is stored server-side in a recoverable form — plaintext, or reversibly encrypted with a key that lives alongside it (a `.env` secret, a hard-coded constant, the same DB). In both cases the platform, not the user, is the single point of failure: one server breach, one leaked backup, one rogue admin, and **every** user's funds are drainable at once, because the operator can reconstruct every key. This is categorically worse than a per-user key leak — the blast radius is the entire user base.

The correct model for a custodial signer is that raw key bytes never leave a hardware boundary: keys are generated inside and never exit an HSM / MPC cluster / secure enclave, signing is a request-response against that boundary, and there is **no** code path — user-facing or administrative — that returns the raw secret. If users must be able to self-custody, hand them a key generated client-side that the server never sees, rather than exporting a server-held one.

#### Verification Procedure

**Step 1: Find any key/seed export or reveal path**
```
grep -rn --include="*.ts" --include="*.js" --include="*.rs" --include="*.py" -iE "export.?(wallet|key|seed|mnemonic|privateKey)|reveal.?(key|seed|secret)|backup.?(phrase|seed|key)|show.?(private|secret|mnemonic)|dump.?key|getPrivateKey|exportPrivateKey"
```
- Record every endpoint/function that could return raw key or seed bytes to a client, a log, or an admin surface

**Step 2: Determine whether signing material is stored recoverably server-side**
```
grep -rn --include="*.ts" --include="*.js" --include="*.rs" --include="*.py" -iE "secretKey|privateKey|mnemonic|seed_phrase|keypair|SigningKey|fromSecretKey|Keypair\.from" | grep -ivE "test|mock|fixture|example"
grep -rn --include="*.ts" --include="*.js" --include="*.rs" --include="*.py" -iE "encrypt\(|decrypt\(|AES|createCipher|Fernet|nacl\.secretbox|sealBox" | head -40
```
- ✅ PASS: Signing material is generated inside and never leaves an HSM / MPC / secure enclave; the server holds only a key handle/reference, never the raw bytes; no decrypt path can reconstruct a usable private key
- ❌ FAIL: Raw keys/seeds are stored in the DB or filesystem in plaintext, OR reversibly encrypted with a key the same system can access (env var, hard-coded constant, co-located KMS key with no separation) — the operator can reconstruct every user's key

**Step 3: Confirm no user-facing or admin path returns the raw secret**
- Trace each hit from Step 1: does it end in the raw private key / seed being serialized into a response body, a QR code, a downloadable file, a log line, or an internal admin/debug tool?
- ✅ PASS: No code path (user or admin) returns raw key/seed material; "export" if present hands over only a client-generated key the server never held
- ❌ FAIL: A reveal/export/backup endpoint or admin tool surfaces the raw secret

**Step 4: Check where key generation happens for custodial wallets**
```
grep -rn --include="*.ts" --include="*.js" --include="*.rs" --include="*.py" -iE "generateKeyPair|Keypair\.generate|new Keypair|randomBytes\(32\)|generateMnemonic|createWallet|deriveKey"
```
- ✅ PASS: Custodial keys are generated inside the HSM/MPC/enclave (or, for self-custody, in the user's browser) — the plaintext key never exists in the application process
- ❌ FAIL: Keys are generated in the app server process (where they can be logged, dumped, or persisted before reaching any secure store)

**Overall verdict:**
- ✅: Signing material lives only in an HSM/MPC/enclave; non-recoverable server-side; NO raw-key export path (user or admin); custodial keys generated inside the boundary
- ⚠️: Keys encrypted at rest but the decryption key is co-located / operator-accessible, OR an export path exists but is gated (still a design SPOF — flag it)
- ❌: Raw private keys/seeds stored plaintext or reversibly-encrypted, or an `export_wallet`/reveal path returns them — one breach drains all users
- N/A: Product is fully non-custodial and never holds, stores, or can reconstruct user signing material
