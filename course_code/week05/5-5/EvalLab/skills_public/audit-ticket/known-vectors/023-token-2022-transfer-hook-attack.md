---
id: 23
title: "Token-2022 Transfer Hook Attack"
severity: 7
category: crypto
---

### 23 — Token-2022 Transfer Hook Attack
**Severity: 7** | **Real: Emerging attack surface (2024+), Token-2022 composability exploits**

Malicious token with transfer hook executes arbitrary code during transfer — reentrancy vector and unexpected state changes.

#### Verification Procedure

**Step 1: Check if protocol handles Token-2022 tokens**
```
grep -rn --include="*.rs" -iE "token.2022\|token_2022\|spl_token_2022\|TokenExtension\|transfer_hook" programs/
```
- If not handling Token-2022: N/A (but check step 2)
- If handling Token-2022: proceed

**Step 2: Check if arbitrary mints are accepted**
```
grep -rn --include="*.rs" "remaining_accounts.*mint\|token_mint\|accepted_mint" programs/*/src/instructions/
```
- If only whitelisted mints (SOL, USDC, etc.): lower risk
- If any mint accepted: high risk — must handle transfer hooks

**Step 3: Verify transfer hook awareness**
```
grep -rn --include="*.rs" "transfer_hook\|get_transfer_hook\|execute_transfer_hook" programs/
```
- ✅ PASS: Code explicitly handles or rejects tokens with transfer hooks
- ❌ FAIL: No transfer hook handling — state changes during hook execution are uncontrolled

**Step 4: Check state ordering around Token-2022 transfers**
```
# If Token-2022 transfers are used, state must be saved BEFORE the transfer
# (because transfer hook could call back)
```
- ✅ PASS: State saved before any Token-2022 transfer (checks-effects-interactions)
- ❌ FAIL: State written after Token-2022 transfer (reentrancy via transfer hook)

**Overall verdict:**
- ✅: Only whitelisted non-hook tokens, or explicit hook handling with state ordering
- ⚠️: Accepts arbitrary tokens but hooks unlikely in practice
- ❌: Accepts arbitrary Token-2022 tokens without hook handling
- N/A: Only handles SPL Token classic (not Token-2022)
