---
id: 3
title: "Reentrancy (CPI)"
severity: 10
category: crypto
---

### 3 — Reentrancy (CPI)
**Severity: 10** | **Real: The DAO ($60M), Curve ($70M)**

Malicious contract calls back during state change — Solana version: CPI to untrusted program that calls back before state is saved.

#### Verification Procedure

**Step 1: Find all CPI calls**
```
grep -rn --include="*.rs" "invoke(\|invoke_signed(\|CpiContext::new" programs/
```
- Record: Every CPI call with file:line

**Step 2: For each CPI, verify state is saved BEFORE the CPI**
```
# For each CPI location found in step 1, check the surrounding code
# State writes (to account data) must happen BEFORE invoke/invoke_signed
```
- ✅ PASS: All state mutations complete before CPI call (checks-effects-interactions pattern)
- ❌ FAIL: Any CPI call where state is written AFTER the call returns

**Step 3: Check for Anchor reentrancy guard**
```
grep -rn --include="*.rs" "ReentrancyGuard\|reentrancy_guard\|#\[account.*realloc" programs/
```
- ✅ PASS: Reentrancy guard is used on state-modifying instructions, OR program only CPIs to trusted programs (SPL Token, System)
- ⚠️ PARTIAL: No explicit guard, but all CPIs are to well-known programs

**Step 4: Verify CPI targets are trusted programs**
```
grep -rn --include="*.rs" -B3 "CpiContext::new" programs/ | grep -E "program|\.key\(\)"
```
- ✅ PASS: Every CPI target is a hardcoded well-known program (Token, System, Associated Token)
- ❌ FAIL: Any CPI target comes from user-supplied account or remaining_accounts

**Step 5: Check for callback patterns**
```
grep -rn --include="*.rs" "remaining_accounts.*invoke\|invoke.*remaining" programs/
```
- ✅ PASS: No CPIs to accounts from remaining_accounts
- ❌ FAIL: Program invokes unknown programs from remaining_accounts

**Overall verdict:**
- ✅: All state written before CPI, all CPIs to trusted programs, no user-controlled CPI targets
- ⚠️: CPIs to trusted programs only but state ordering is inconsistent
- ❌: CPI to user-controlled program AND state written after CPI
