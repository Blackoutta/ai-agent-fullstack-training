---
id: 65
title: "Clipboard Hijacking (Crypto Address)"
severity: 7
category: frontend
---

### 65 — Clipboard Hijacking (Crypto Address)
**Severity: 7** | **Real: Clipboard replacer malware, website-based clipboard injection, crypto theft**

User copies a crypto address → malicious code replaces it with attacker's address via Clipboard API → user sends funds to attacker.

#### Verification Procedure

**Step 1: Find clipboard operations**
```
grep -rn --include="*.tsx" --include="*.ts" -iE "clipboard|document\.execCommand.*copy|navigator\.clipboard" apps/web/
```
- Record: All clipboard operations

**Step 2: Check copy-to-clipboard of addresses**
```
grep -rn --include="*.tsx" -B5 -A5 "clipboard" apps/web/ | grep -iE "address|pubkey|wallet|key"
```
- ✅ PASS: When copying an address, the exact value from state is used (not re-read from DOM)
- ❌ FAIL: Address read from DOM element (could be modified by extension/injection)

**Step 3: Check for paste-and-use without verification**
```
grep -rn --include="*.tsx" "paste\|onPaste\|readText" apps/web/
```
- ✅ PASS: Pasted addresses are validated (correct format, length, checksum)
- ⚠️ PARTIAL: No paste detection (user responsibility)

**Step 4: Check for address confirmation UI**
```
# Do users see the full address before confirming a transaction?
grep -rn --include="*.tsx" -iE "confirm|preview|review.*transaction" apps/web/ | head -10
```
- ✅ PASS: Transaction preview shows full destination address before signing
- ❌ FAIL: Address only shown truncated (first/last 4 chars) — attacker generates vanity match

**Overall verdict:**
- ✅: Address from state, input validation, full address in confirmation
- ⚠️: Address shown but truncated in confirmation
- ❌: Address read from DOM, no confirmation of destination
