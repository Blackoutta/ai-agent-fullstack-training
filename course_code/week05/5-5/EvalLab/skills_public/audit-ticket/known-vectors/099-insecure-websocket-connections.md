---
id: 99
title: "Insecure WebSocket Connections"
severity: 6
category: devops
---

### 99 — Insecure WebSocket Connections
**Severity: 6** | **Real: WebSocket hijacking, missing auth on WS connections**

WebSocket upgrade without authentication — attacker connects directly and receives real-time data or sends commands.

#### Verification Procedure

**Step 1: Find WebSocket implementations**
```
grep -rn --include="*.ts" -iE "WebSocket|ws\b|socket\.io|wss://|io\(" apps/ | grep -v node_modules | head -10
```
- If no WebSocket: N/A
- If found: proceed

**Step 2: Check for auth on WebSocket upgrade**
```
grep -rn --include="*.ts" -A10 "upgrade\|connection\|on.*connect" apps/backend/ | grep -iE "auth\|token\|verify\|signature" | head -5
```
- ✅ PASS: WebSocket connections require authentication (token in handshake or first message)
- ❌ FAIL: Any client can connect without authentication

**Step 3: Check for message validation**
```
grep -rn --include="*.ts" -A10 "on.*message\|onmessage" apps/backend/ | grep -iE "parse\|validate\|schema\|type.*check" | head -5
```
- ✅ PASS: Incoming WebSocket messages are validated/parsed before processing
- ❌ FAIL: Raw message data processed without validation

**Step 4: Check for WSS (encrypted)**
```
grep -rn --include="*.ts" --include="*.tsx" "ws://" apps/ | grep -v "wss://" | grep -v node_modules | head -5
```
- ✅ PASS: All WebSocket connections use `wss://` (encrypted)
- ❌ FAIL: `ws://` (unencrypted) used for production connections

**Step 5: Check for rate limiting on WS messages**
```
grep -rn --include="*.ts" -iE "rate.*limit\|throttle\|maxMessagesPerSecond" apps/backend/ | grep -iE "ws\|socket" | head -5
```
- ✅ PASS: WebSocket messages rate-limited
- ❌ FAIL: No rate limiting — attacker floods server via WebSocket

**Overall verdict:**
- ✅: Auth on connection, validated messages, WSS, rate-limited
- ⚠️: Auth present but limited message validation
- ❌: No auth on WebSocket, or unencrypted connections
- N/A: No WebSocket
