---
id: 53
title: "Missing Wallet Signature Verification"
severity: 9
category: backend
---

### 53 — Missing Wallet Signature Verification
**Severity: 9** | **Real: Solana DApp exploits, wallet impersonation**

Backend trusts `walletAddress` from request body without verifying cryptographic signature — anyone can claim to be any wallet.

#### Verification Procedure

**Step 1: Find all endpoints that use wallet address**
```
grep -rn --include="*.ts" -iE "walletAddress|wallet.*address|publicKey" apps/backend/src/routes/
```
- Record: Every endpoint using wallet identity

**Step 2: Check for signature verification middleware/function**
```
grep -rn --include="*.ts" -iE "verifySignature|nacl.sign|ed25519|tweetnacl|bs58.*verify" apps/backend/
```
- ✅ PASS: Signature verification function exists and is used by wallet-dependent endpoints
- ❌ FAIL: No signature verification anywhere

**Step 3: Verify EVERY mutation endpoint requires signature**
```
grep -rn --include="*.ts" "post\|put\|patch\|delete" apps/backend/src/routes/ | wc -l
grep -rn --include="*.ts" "verifySignature\|verifyWallet\|authenticateWallet" apps/backend/src/routes/ | wc -l
```
- Compare counts — every mutation should have wallet verification
- ✅ PASS: Every mutation endpoint verifies wallet signature
- ❌ FAIL: Any mutation endpoint trusts wallet address from body without signature

**Step 4: Check that verified wallet is used (not body wallet)**
```
# After signature verification: does the route use the verified wallet address?
# NOT req.body.walletAddress, but the address extracted from the verified signature
```
- ✅ PASS: Routes use wallet address from verified signature, not from body
- ❌ FAIL: Signature verified but then req.body.walletAddress used for queries (TOCTOU)

**Step 5: Check signature replay protection**
```
grep -rn --include="*.ts" -iE "nonce|timestamp|expir" apps/backend/ | grep -i "sign\|auth"
```
- ✅ PASS: Signatures include nonce or timestamp to prevent replay
- ❌ FAIL: Same signature can be replayed indefinitely

**Overall verdict:**
- ✅: Every mutation verified, wallet from signature used, replay protection
- ⚠️: Verification present but some endpoints missing or no replay protection
- ❌: Mutation endpoints trusting wallet from request body
