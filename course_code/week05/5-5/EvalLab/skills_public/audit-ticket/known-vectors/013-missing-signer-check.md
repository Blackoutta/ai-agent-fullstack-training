---
id: 13
title: "Missing Signer Check"
severity: 10
category: crypto
---

### 13 — Missing Signer Check
**Severity: 10** | **Real: Wormhole ($326M), Parity multi-sig ($31M)**

Instruction accepts accounts but doesn't verify the expected signer actually signed the transaction. Anyone can impersonate the authority.

#### Verification Procedure

**Step 1: List all instructions and count signers**
```
for f in programs/*/src/instructions/*.rs; do
  echo "=== $f ==="
  grep -c "Signer<'info>" "$f"
  grep "pub fn " "$f"
done
```
- Record: Each instruction and its signer count

**Step 2: Verify every mutation instruction has at least one signer**
```
grep -rn --include="*.rs" "pub fn " programs/*/src/instructions/ | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  grep -c "Signer<'info>" "$file"
done
```
- ✅ PASS: Every instruction that modifies state has ≥1 Signer
- ❌ FAIL: Any mutation instruction with 0 Signers

**Step 3: Verify signer is the CORRECT authority**
```
grep -rn --include="*.rs" -A5 "pub.*authority.*Signer\|pub.*manager.*Signer\|pub.*admin.*Signer" programs/*/src/instructions/
```
- For each signer: verify `has_one = authority` (or equivalent) links it to the stored authority in the account being modified
- ✅ PASS: Every signer is validated against the expected authority stored on-chain
- ❌ FAIL: Signer is accepted but not checked against stored authority (any wallet can sign)

**Step 4: Look for authority spoofing via separate accounts**
```
# Check if authority account is separate from the entity being modified
# Attacker could pass their own account as authority if not linked
grep -rn --include="*.rs" "has_one\|constraint.*authority\|constraint.*manager" programs/*/src/instructions/
```
- ✅ PASS: Declarative constraints link signer to state
- ❌ FAIL: Authority is a standalone Signer with no link to program state

**Overall verdict:**
- ✅: Every mutation has a Signer linked to the correct on-chain authority via has_one
- ⚠️: Signers present but not all have has_one (only runtime checks)
- ❌: Any instruction accepts any signer without linking to stored authority
