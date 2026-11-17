---
id: 45
title: "Webhook Forgery"
severity: 7
category: backend
---

### 45 — Webhook Forgery
**Severity: 7** | **Real: Stripe webhook bypass, payment forgery, fake events**

Attacker sends fake webhook to your endpoint — forges payment confirmation or event.

#### Verification Procedure

**Step 1: Find all webhook endpoints**
```
grep -rn --include="*.ts" -iE "webhook|callback|notify|hook\b" apps/backend/src/routes/
```
- If no webhooks: N/A
- If webhooks: proceed

**Step 2: Check for signature verification**
```
grep -rn --include="*.ts" -iE "constructEvent|verify.*signature|webhook.*secret|hmac|crypto\.createHmac" apps/backend/
```
- ✅ PASS: Every webhook verifies cryptographic signature from the sender
- ❌ FAIL: Webhook endpoint accepts requests without signature verification

**Step 3: Check for replay protection**
```
grep -rn --include="*.ts" -iE "timestamp\|replay\|idempotency\|already.*processed" apps/backend/ | grep -i webhook
```
- ✅ PASS: Webhooks check timestamp freshness and/or idempotency key
- ❌ FAIL: Same webhook can be replayed

**Step 4: Check for raw body access (needed for signature verification)**
```
grep -rn --include="*.ts" "raw.*body\|rawBody\|express\.raw" apps/backend/
```
- ✅ PASS: Webhook routes use raw body for signature verification (not parsed JSON)
- ❌ FAIL: Webhook uses parsed body for signature check (parsing can alter the payload)

**Overall verdict:**
- ✅: Signature verified, replay protection, raw body access
- ⚠️: Signature verified but no replay protection
- ❌: No signature verification on webhook endpoints
- N/A: No webhooks
