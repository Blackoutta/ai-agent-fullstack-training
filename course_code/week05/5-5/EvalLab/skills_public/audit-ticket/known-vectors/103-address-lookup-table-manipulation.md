---
id: 103
title: "Address Lookup Table (ALT) Manipulation"
severity: 7
category: crypto
---

### 103 — Address Lookup Table (ALT) Manipulation

**Severity: 7** | **Real: Versioned-transaction account substitution via attacker-supplied lookup tables**

Versioned (v0) transactions resolve some accounts by index into one or more Address Lookup Tables supplied by the transaction author. The runtime still enforces signer/writable flags and program ownership, but a program that trusts **account ordering or positional assumptions** — rather than re-deriving and asserting each account's address — can be fed substituted accounts through a malicious ALT. This is most dangerous for `remaining_accounts`, for "config"/"authority"/"treasury" accounts that are not `has_one`-bound, and for off-chain clients that build instructions assuming a fixed account list.

> Scope note (transaction v1, SIMD-0385): v1 transactions carry **no** lookup tables — all ≤ 64 accounts are inline and duplicates are rejected at sanitization. The ALT substitution path below applies to v0 only; the underlying rule (bind privileged accounts by derivation, never by position) applies to every version, and v1 raises the positional surface to 64 inline accounts and 64 instructions (AV-090, `references/vuln-classes/transaction-v1.md`).

#### Verification Procedure

**Step 1: Identify positional / ordering assumptions**
```
grep -rn --include="*.rs" -E "remaining_accounts|ctx.accounts\.[a-z_]+\.key\(\)|accounts\[[0-9]+\]" programs/*/src/instructions/
```
- Record any logic that depends on account position or an unconstrained account identity

**Step 2: Verify every security-relevant account is bound, not positional**
- ✅ PASS: Treasury/authority/config/mint accounts are validated via `has_one`, `seeds`+`bump`, `address = …`, or `require_keys_eq!` — never "whatever is in slot N"
- ❌ FAIL: A privileged account's identity is assumed from ordering and can be swapped via ALT

**Step 3: Validate remaining_accounts independent of resolution path**
- ✅ PASS: Each remaining account is re-derived (PDA) or owner/mint/authority-checked before use (see AV-032..039)
- ❌ FAIL: Remaining accounts trusted by index — ALT can substitute them

**Step 4: Check client-side instruction construction**
```
grep -rn --include="*.ts" -iE "lookupTable|AddressLookupTable|TransactionMessage|compileToV0Message" apps/ packages/
```
- ✅ PASS: Clients pin known ALTs or do not rely on ALT-resolved accounts for security decisions
- ❌ FAIL: Clients accept arbitrary ALTs that feed privileged accounts

**Overall verdict:**
- ✅: No positional trust; every privileged account is cryptographically bound
- ⚠️: Mostly bound, but some unconstrained config accounts resolved positionally
- ❌: Privileged accounts or remaining_accounts trusted by position — ALT substitution possible
