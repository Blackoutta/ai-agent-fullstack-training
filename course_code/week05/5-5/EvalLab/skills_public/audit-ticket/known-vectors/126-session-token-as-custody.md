---
id: 126
title: "Session Token as Custody — Fund Movement Gated Only by a Bearer Session"
severity: 7
category: backend
---

### 126 — Session Token as Custody — Fund Movement Gated Only by a Bearer Session

**Severity: 7** | **Real: Thunder Terminal $240K (Dec 2023), Banana Gun $3M (Sep 2024) — a stolen session token was sufficient to move user funds**

A custodial or semi-custodial backend treats a valid bearer **session token** (JWT, session cookie, API token) as sufficient authorization to move value. The withdraw / transfer / trade endpoint is protected by the same auth middleware as reading a profile: present a valid session, and the money moves. There is no *step-up* — no fresh transaction signature, no 2FA / OTP challenge, no withdrawal-address allowlist, no out-of-band confirmation — so the session token **is** custody. Session tokens leak constantly (XSS, a compromised third-party script, a MongoDB breach that dumps session records, a stolen device, a malicious browser extension, an intercepted analytics payload). The moment one leaks, the attacker withdraws to their own address, and the victim's only signal is a drained balance. In both Thunder Terminal and Banana Gun, the initial compromise exposed session data and the attacker used those sessions to authorize withdrawals directly.

Value-moving actions must require something the session token cannot supply on its own: a signature over the specific withdrawal from the user's key at action time, a 2FA/OTP challenge, an OOB (email/push) confirm, and/or an allowlist of withdrawal destinations that itself requires step-up to change. Reading data with a session is fine; spending with only a session is custody-by-cookie.

#### Verification Procedure

**Step 1: Enumerate value-moving endpoints**
```
grep -rn --include="*.ts" --include="*.js" -iE "router\.(post|put)\(.*(withdraw|transfer|send|payout|swap|trade|redeem|claim|buy|sell)" apps/ src/ backend/
grep -rn --include="*.ts" --include="*.js" -iE "(withdraw|transfer|payout|sendFunds|moveFunds|executeTrade)" apps/ src/ backend/ | head -40
```
- Record every endpoint that causes funds/tokens to leave a user's custodial balance

**Step 2: Determine what authorizes each one**
```
grep -rn --include="*.ts" --include="*.js" -iE "requireAuth|isAuthenticated|verifyToken|verifyJWT|sessionMiddleware|passport\.authenticate|req\.session|req\.user|bearer" apps/ src/ backend/
```
- For each value-moving endpoint from Step 1, identify the middleware chain — is the ONLY gate a session/JWT check?
- ✅ PASS: Value-moving endpoints require step-up beyond the session (see Step 3)
- ❌ FAIL: A `withdraw`/`transfer`/`payout` endpoint is gated only by the generic session/JWT middleware — same auth as reading a profile

**Step 3: Look for step-up authorization on fund movement**
```
grep -rn --include="*.ts" --include="*.js" -iE "2fa|twoFactor|totp|otp|verifyOtp|withdrawalPassword|txSignature|verifySignature|sign\.detached\.verify|allowlist|whitelist.*address|confirmationEmail|withdrawAddress|approvedAddress" apps/ src/ backend/
```
- ✅ PASS: The withdrawal path requires at least one of: a fresh signature over *this* withdrawal from the user's key, a 2FA/OTP challenge, an OOB (email/push) confirmation, or a pre-registered withdrawal-address allowlist whose modification itself requires step-up
- ❌ FAIL: None of the above — a valid session alone completes the withdrawal

**Step 4: Check that the allowlist (if present) isn't self-defeating**
- If a withdrawal-address allowlist exists, verify that *adding* an address also requires step-up (2FA/OOB/signature), not just a session — otherwise the attacker with a session simply allowlists their own address first.
- ✅ PASS: Allowlist mutation requires step-up (and ideally a cooldown before a newly-added address can receive funds)
- ❌ FAIL: A session token can add a withdrawal address, defeating the allowlist

**Overall verdict:**
- ✅: Every fund-moving endpoint requires step-up (fresh per-tx signature, 2FA/OTP, OOB confirm, or step-up-gated address allowlist) beyond the session token
- ⚠️: Step-up exists on some value paths but not all, or an allowlist exists but adding an address needs only a session
- ❌: A valid bearer session token alone authorizes withdrawal/transfer — a stolen session == drained funds
- N/A: Backend is non-custodial and never moves user funds server-side (every transfer is signed client-side by the user's own wallet)
