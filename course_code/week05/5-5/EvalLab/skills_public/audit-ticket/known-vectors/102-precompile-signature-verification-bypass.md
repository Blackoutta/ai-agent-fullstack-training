---
id: 102
title: "Precompile Signature Verification Bypass (Ed25519 / Secp256k1)"
severity: 9
category: crypto
---

### 102 — Precompile Signature Verification Bypass (Ed25519 / Secp256k1)

**Severity: 9** | **Real: Recurring Solana audit finding — instruction-introspection signature checks that fail to bind the message/signer**

Solana verifies Ed25519/Secp256k1 signatures via native precompiled programs. An on-chain program "consumes" the result by introspecting the Instructions sysvar to confirm a sibling `Ed25519Program`/`Secp256k1Program` instruction ran. This is a notoriously fragile pattern: it is bypassable if the program does not (a) verify the precompile **program ID**, (b) verify the instruction is at the **expected index / actually present**, (c) parse the precompile's data layout to bind the **exact pubkey, message, and signature** to the current action. Attackers craft a transaction with a valid-but-unrelated precompile instruction (signed over a different message) to satisfy a loose check and authorize an action they never signed.

#### Verification Procedure

**Step 1: Detect introspection-based signature verification**
```
grep -rn --include="*.rs" -iE "load_instruction_at|get_instruction_relative|instructions_sysvar|ed25519_program|secp256k1_program|load_current_index" programs/
```
- If none: likely N/A (program relies on native `Signer` only)
- If present: this pattern requires deep manual review

**Step 2: Verify the precompile program ID is checked**
- ✅ PASS: Code asserts the introspected instruction's `program_id == ed25519_program::ID` (or secp256k1)
- ❌ FAIL: Program ID not checked — any instruction at that index satisfies the check

**Step 3: Verify message + pubkey binding**
- The precompile instruction data encodes offsets to the signed message, the pubkey, and the signature. The program MUST parse these and assert they equal the expected signer and the **exact message bytes** for THIS action (including a nonce/expiry to prevent replay).
- ✅ PASS: Pubkey, full message, and signature offsets are parsed and bound to the current instruction's parameters
- ❌ FAIL: Only "an ed25519 instruction exists" is checked — message/signer not bound (full bypass)

**Step 4: Verify index/position handling**
- ✅ PASS: Instruction index is computed safely (relative or validated absolute), no fixed-index assumption an attacker can shift
- ❌ FAIL: Hardcoded index that an attacker can offset by inserting instructions

**Step 5: Replay protection**
- ✅ PASS: Signed message includes a nonce/expiry/slot tied to state; replays rejected
- ❌ FAIL: Same signed payload can be replayed across transactions/accounts

**Overall verdict:**
- ✅: Program ID, signer, full message, offsets, and replay protection all verified
- ⚠️: Program ID + signer checked but message binding or replay protection weak
- ❌: Loose check (existence only) — signature can be satisfied by an unrelated precompile instruction
- N/A: No instruction-introspection signature verification used
