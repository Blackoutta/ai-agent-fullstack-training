---
id: 101
title: "Sysvar Spoofing & Instructions-Sysvar Introspection Abuse"
severity: 8
category: crypto
---

### 101 — Sysvar Spoofing & Instructions-Sysvar Introspection Abuse

**Severity: 8** | **Real: Solana sysvar substitution class (programs reading Clock/Rent from a passed account instead of the syscall)**

A program that reads a sysvar (Clock, Rent, RecentBlockhashes, SlotHashes, Instructions) from a passed-in `AccountInfo` instead of the runtime syscall (`Clock::get()`, `Rent::get()`) can be fed an attacker-controlled account with forged contents. Forged `Clock` enables timestamp/slot manipulation (bypass cooldowns, vesting, auction windows, staleness checks). Forged `Instructions` sysvar enables introspection bypass (see KV-102). Anchor's `Sysvar<'info, T>` validates the address, but raw `AccountInfo` or `UncheckedAccount` typed sysvars do not.

> Note (transaction v1, SIMD-0385): introspecting `ComputeBudgetProgram` instructions is unreliable even with a correctly pinned Instructions sysvar — under v1 those instructions are no-ops and the real compute / fee config lives in the message header, which no sysvar or syscall exposes. Any gate built on them is covered by KV-135 and AV-089.

#### Verification Procedure

**Step 1: Find all sysvar usage**
```
grep -rn --include="*.rs" -iE "Clock|Rent|RecentBlockhashes|SlotHashes|instructions::|Sysvar|sysvar" programs/*/src/
```
- Record every sysvar read and how it is obtained (syscall vs passed account)

**Step 2: Prefer syscall reads over passed accounts**
```
grep -rn --include="*.rs" -E "Clock::get\(\)|Rent::get\(\)" programs/
```
- ✅ PASS: Time/rent obtained via `Clock::get()` / `Rent::get()` syscalls (cannot be spoofed)
- ❌ FAIL: `clock.unix_timestamp` / rent read from a passed-in account field

**Step 3: If a sysvar is passed as an account, verify its type and address**
```
grep -rn --include="*.rs" -E "Sysvar<'info,|UncheckedAccount.*[Cc]lock|AccountInfo.*[Cc]lock" programs/
```
- ✅ PASS: Passed sysvars are typed `Sysvar<'info, Clock>` / `Sysvar<'info, Rent>` (Anchor checks the canonical address), OR the address is asserted equal to the known sysvar ID
- ❌ FAIL: Sysvar is `UncheckedAccount`/`AccountInfo` with no address check — fully spoofable

**Step 4: Check time-dependent logic for spoofing impact**
- For each cooldown / vesting / auction / TWAP-staleness / expiry check: confirm the timestamp source is non-spoofable
- ✅ PASS: All time-gated logic uses `Clock::get()`
- ❌ FAIL: A cooldown or staleness guard can be bypassed by passing a forged Clock account

**Overall verdict:**
- ✅: All sysvar reads use syscalls, or passed sysvars are typed/address-checked
- ⚠️: Sysvars typed correctly but some time logic reads from passed account fields
- ❌: Any security-relevant sysvar read from an unchecked passed account
- N/A: Program reads no sysvars
