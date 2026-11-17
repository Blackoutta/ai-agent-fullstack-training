---
id: 106
title: "Account Revival / Zombie After Close"
severity: 8
category: crypto
---

### 106 — Account Revival / Zombie After Close

**Severity: 8** | **Real: Solana close-account revival class (incomplete close → reuse of stale state)**

Closing an account safely requires three things in the same instruction: transfer ALL lamports out, zero/overwrite the data (Anchor sets the `CLOSED_ACCOUNT_DISCRIMINATOR`), and not rely on the runtime garbage-collecting it until end-of-transaction. An incomplete close — manual lamport transfer without rewriting the discriminator, or leaving the account funded above rent-exemption — leaves a "zombie": the account still exists and can be deserialized later in the same transaction (or refunded by an attacker to survive GC), exposing stale balances/positions. Combined with `init_if_needed`, a closed account can be "revived" with attacker-favorable stale data.

#### Verification Procedure

**Step 1: Find all account closes**
```
grep -rn --include="*.rs" -E "close = |close_account|\.close\(|CLOSED_ACCOUNT_DISCRIMINATOR|\*\*lamports|try_borrow_mut_lamports" programs/
```
- Separate Anchor `close = dest` (safe) from manual lamport-draining closes (review each)

**Step 2: Manual closes must zero the discriminator**
- ✅ PASS: Manual close sets data to the closed discriminator / zeroes it AND drains all lamports
- ❌ FAIL: Manual close only moves lamports — data still deserializable (zombie)

**Step 3: No stale access after close in the same transaction**
```
grep -rn --include="*.rs" -E "init_if_needed" programs/
```
- ✅ PASS: A closed account cannot be re-read or `init_if_needed`-revived with stale fields later in the tx
- ❌ FAIL: Subsequent instruction/CPI can read or re-init the closed account

**Step 4: Revival via lamport refund**
- For PDAs that gate a one-time action (claims, withdrawals): confirm that re-funding the closed address with lamports cannot resurrect stale "unclaimed" state
- ✅ PASS: State is re-derived/re-checked against authoritative source; refund cannot revive a claim
- ❌ FAIL: Re-funded address re-enables a completed action

**Overall verdict:**
- ✅: All closes use Anchor `close` or a complete manual pattern (zeroed + fully drained); no stale re-read/re-init
- ⚠️: Closes are safe but `init_if_needed` present without a revival guard
- ❌: Manual close leaves deserializable data, or refund can revive stale state
- N/A: Program never closes accounts
