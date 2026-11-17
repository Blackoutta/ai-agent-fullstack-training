---
id: 21
title: "Governance Attack (Vote Buying)"
severity: 8
category: crypto
---

### 21 — Governance Attack (Vote Buying)
**Severity: 8** | **Real: Beanstalk ($182M, 2022)**

Flash-borrow governance tokens → pass malicious proposal → drain treasury. All in one transaction.

#### Verification Procedure

**Step 1: Check if protocol has governance**
```
grep -rn --include="*.rs" -iE "governance|proposal|vote|ballot|quorum" programs/
```
- If no governance: N/A
- If governance exists: proceed

**Step 2: Verify snapshot-based voting**
```
grep -rn --include="*.rs" -iE "snapshot|voting_power.*at|balance_at|checkpoint" programs/
```
- ✅ PASS: Voting power is snapshot-based (balance at proposal creation time, not current)
- ❌ FAIL: Voting power uses current balance (flash-loan attackable)

**Step 3: Check for timelock between proposal and execution**
```
grep -rn --include="*.rs" -iE "timelock|execution_delay|grace_period" programs/
```
- ✅ PASS: Proposals have mandatory delay before execution (allows community review)
- ❌ FAIL: Proposals execute immediately after vote passes

**Step 4: Check quorum requirements**
```
grep -rn --include="*.rs" -iE "quorum|min_votes|threshold" programs/
```
- ✅ PASS: Quorum requires significant portion of total supply (e.g., >10%)
- ❌ FAIL: Low quorum that could be reached with a flash loan

**Overall verdict:**
- ✅: Snapshot voting, timelock, sufficient quorum
- ⚠️: Some protections but quorum is low
- ❌: Current-balance voting without timelock (flash-loan attackable)
- N/A: No governance mechanism
