---
id: 16
title: "Token Account Mismatch"
severity: 8
category: crypto
---

### 16 — Token Account Mismatch
**Severity: 8** | **Real: Multiple DeFi fund-drain exploits**

Program transfers to wrong token account — mint mismatch means funds sent to attacker's account of a different token.

#### Verification Procedure

**Step 1: Find all token transfers**
```
grep -rn --include="*.rs" "token::transfer\|transfer_checked\|Transfer {" programs/*/src/instructions/
```
- Record: Every transfer with source and destination accounts

**Step 2: Verify mint constraint on every token account**
```
grep -rn --include="*.rs" "token::mint\|constraint.*\.mint" programs/*/src/instructions/
```
- For each token account in each instruction: verify `token::mint = expected_mint` constraint exists
- ✅ PASS: Every TokenAccount has a mint constraint matching the expected token
- ❌ FAIL: Any TokenAccount accepted without mint verification

**Step 3: Verify authority constraint on source accounts**
```
grep -rn --include="*.rs" "token::authority" programs/*/src/instructions/
```
- ✅ PASS: Transfer source accounts have `token::authority = expected_authority` (PDA or signer)
- ❌ FAIL: Source account authority not verified (attacker could pass their own account as destination)

**Step 4: Cross-reference transfer source/destination**
- For each transfer: verify the `from` account belongs to the fund/vault and `to` is the expected recipient
- Read the actual transfer instruction and trace the accounts
- ✅ PASS: Every transfer has verified source and destination with mint match
- ❌ FAIL: Destination could be attacker-controlled account with different mint

**Overall verdict:**
- ✅: Every token account has mint + authority constraints, all transfers verified
- ⚠️: Mint constraints present but authority missing on some accounts
- ❌: Token accounts without mint constraint allow cross-mint attacks
