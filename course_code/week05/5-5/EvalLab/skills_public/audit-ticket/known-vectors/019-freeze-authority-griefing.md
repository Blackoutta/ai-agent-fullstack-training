---
id: 19
title: "Freeze Authority Griefing"
severity: 6
category: crypto
---

### 19 — Freeze Authority Griefing
**Severity: 6** | **Real: SPL Token freeze attacks on Solana DeFi**

Token issuer uses freeze authority to freeze the fund's token account — locking assets permanently.

#### Verification Procedure

**Step 1: Check which tokens the protocol handles**
```
grep -rn --include="*.rs" -iE "mint|token" programs/*/src/state/ | grep -v test
```
- Record: All mints/tokens the protocol interacts with

**Step 2: Check if freeze authority is validated on accepted tokens**
```
grep -rn --include="*.rs" "freeze_authority\|FreezeAccount" programs/
```
- ✅ PASS: Protocol validates that accepted tokens have freeze authority = None (or acceptably governed)
- ⚠️ PARTIAL: Protocol handles only well-known tokens (SOL, USDC) where freeze is acceptable risk
- ❌ FAIL: Accepts any token without checking freeze authority — fund could be permanently locked

**Step 3: Check for emergency withdrawal path if frozen**
```
grep -rn --include="*.rs" -iE "emergency\|rescue\|recover\|frozen" programs/
```
- ✅ PASS: Emergency mechanism exists to handle frozen accounts (e.g., skip frozen position in NAV)
- ❌ FAIL: Frozen token account blocks all operations with no recovery path

**Overall verdict:**
- ✅: Freeze authority checked or only well-known tokens with emergency recovery
- ⚠️: Well-known tokens only, no explicit freeze check
- ❌: Arbitrary tokens without freeze check and no recovery mechanism
