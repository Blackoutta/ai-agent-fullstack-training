---
id: 117
title: "Agent Delegation Scope Creep (Signing Authority Outlives the Task)"
severity: 7
category: ai-agent
---

### 117 — Agent Delegation Scope Creep (Signing Authority Outlives the Task)

**Severity: 7** | **Real: over-broad session keys / token approvals & lingering delegate authority (2023-2025) — an agent is delegated signing power for a specific task or session, but the delegation is unbounded in scope or time and remains exploitable long after the task is done**

To let an agent act without a human, principals delegate authority: an SPL `Approve` delegate on a token account, a session/scoped key, a `SetAuthority` grant, or a program's own "authorized agent" record. Scope creep is when that delegation is broader or longer-lived than the task required: approving `u64::MAX` instead of the trade size, a session key with no expiry, a delegate that is never revoked after the job completes, or one grant reused across unrelated tasks. The window between "task done" and "authority revoked" is free attack surface — if the agent (or its key) is later compromised, the stale delegation is still live.

This vector targets the LIFECYCLE and TIGHTNESS of delegated signing authority: is it minimal, time-boxed, single-purpose, and revoked?

#### Verification Procedure

**Step 1: Find delegation / approval grants to the agent**
```
grep -rn --include="*.ts" --include="*.rs" -iE "approve|createApproveInstruction|setAuthority|delegate|sessionKey|session_key|grantAuthority|authorized"
```
- Record: each place the agent is granted signing/delegate authority and the amount/scope granted

**Step 2: Amount / scope is minimal (not unbounded)**
```
grep -rn --include="*.ts" -iE "u64::MAX|MAX_SAFE_INTEGER|Number\.MAX|18446744073709551615|approve.*max|amount:\s*.*MAX"
```
- ✅ PASS: Delegated amount equals the task requirement (e.g., exact trade size), not an unbounded/`MAX` approval; scope is the single program/instruction the task needs
- ❌ FAIL: Unlimited approval (`u64::MAX`) or a broad authority grant far exceeding the task

**Step 3: Delegation is time-boxed / session-scoped with an expiry**
```
grep -rn --include="*.ts" --include="*.rs" -iE "expiry|expiresAt|valid_until|deadline|ttl|Clock::get|unix_timestamp|slot.*\+|not_after"
```
- ✅ PASS: The grant carries an expiry (timestamp/slot/session bound); it becomes unusable automatically when the task/session ends
- ❌ FAIL: The delegation has no expiry — it stays live indefinitely

**Step 4: Revocation on task/session completion**
```
grep -rn --include="*.ts" -iE "revoke|createRevokeInstruction|setAuthority.*None|removeDelegate|close.*session|clearAuthority"
```
- ✅ PASS: There is an explicit revoke path that runs when the task finishes (or on error/teardown), and it is actually invoked — not just defined
- ❌ FAIL: No revoke, or revoke exists but is never called on the normal/exit paths (delegate lingers)

**Step 5: One grant per purpose (no cross-task reuse)**
- ✅ PASS: Each delegation is single-purpose; a grant for task A cannot be reused by an unrelated task B
- ❌ FAIL: A long-lived broad grant is shared across many tasks/sessions — compromise of one context reuses it everywhere

**Step 6: Least authority — delegate, don't hand over ownership**
- ✅ PASS: The agent gets a scoped delegate/approval, NOT full mint/freeze/upgrade/account ownership; the principal retains the ability to revoke unilaterally
- ❌ FAIL: The agent is made the authority/owner (mint authority, upgrade authority, account owner), so the principal can no longer bound or revoke it

**Overall verdict:**
- ✅: Minimal amount, time-boxed, revoked on completion, single-purpose, scoped delegate (not ownership)
- ⚠️: Scoped but no expiry, or revoke defined but not reliably invoked
- ❌: Unbounded/`MAX` approval or ownership handed over with no expiry and no revocation — authority outlives the task and stays exploitable
