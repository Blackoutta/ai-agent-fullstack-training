---
id: 47
title: "WebSocket Hijacking"
severity: 7
category: backend
---

### 47 — WebSocket Hijacking
**Severity: 7** | **Real: Cross-site WebSocket hijacking, authenticated WS without origin check**

WebSocket connects without auth token verification — attacker opens connection from their domain.

#### Verification Procedure

**Step 1: Check for WebSocket usage**
```
grep -rn --include="*.ts" -iE "WebSocket|socket\.io|ws\b|wss:" apps/backend/
```
- If no WebSocket: N/A
- If WebSocket: proceed

**Step 2: Check for authentication on connection**
```
grep -rn --include="*.ts" -A10 "on.*connection\|\.on\('connect" apps/backend/ | grep -iE "auth|token|verify|jwt"
```
- ✅ PASS: Connection handler verifies auth token before accepting
- ❌ FAIL: WebSocket accepts connections without authentication

**Step 3: Check origin validation**
```
grep -rn --include="*.ts" -iE "origin|verifyClient" apps/backend/ | grep -i "ws\|socket"
```
- ✅ PASS: Origin validated against whitelist on connection
- ❌ FAIL: Any origin accepted for WebSocket connections

**Step 4: Check for message-level authorization**
```
# After connection: are individual messages/actions authorized?
grep -rn --include="*.ts" -A5 "on.*message\|\.on\('" apps/backend/ | grep -iE "auth|verify|check"
```
- ✅ PASS: Actions within WebSocket connection are authorized per message
- ⚠️ PARTIAL: Auth on connection only (no per-message auth)

**Overall verdict:**
- ✅: Auth on connect, origin validation, per-message authorization
- ⚠️: Auth on connect but no origin check or per-message auth
- ❌: No auth on WebSocket connection
- N/A: No WebSocket
