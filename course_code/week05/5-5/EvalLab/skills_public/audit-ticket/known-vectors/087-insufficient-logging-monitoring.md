---
id: 87
title: "Insufficient Logging & Monitoring"
severity: 6
category: devops
---

### 87 — Insufficient Logging & Monitoring
**Severity: 6** | **Real: Equifax breach undetected for 76 days, many breaches discovered months later**

No logging of auth failures, no monitoring → attacker operates undetected for months.

#### Verification Procedure

**Step 1: Check for structured logging**
```
grep -rn --include="*.ts" -iE "winston|pino|bunyan|morgan|logger\.\(info\|warn\|error\)" apps/backend/ | head -10
```
- ✅ PASS: Structured logging library in use (pino, winston, etc.)
- ⚠️ PARTIAL: console.log only (no structured logging)
- ❌ FAIL: No logging at all

**Step 2: Check for security event logging**
```
# Key events that MUST be logged:
# - Failed authentication attempts
# - Rate limit triggers
# - Authorization failures
# - Signature verification failures
grep -rn --include="*.ts" -iE "log.*(fail|invalid|unauthorized|forbidden|error|denied)" apps/backend/ | head -10
```
- ✅ PASS: Security events are logged with severity levels
- ❌ FAIL: Security failures silently swallowed

**Step 3: Check for PII in logs**
```
grep -rn --include="*.ts" -iE "log.*(password|secret|key|token|private)" apps/backend/ | head -5
```
- ✅ PASS: No sensitive data in log statements
- ❌ FAIL: Passwords, tokens, or private keys logged

**Step 4: Check for request logging**
```
grep -rn --include="*.ts" -iE "morgan\|requestLogger\|accessLog\|app\.use.*log" apps/backend/ | head -5
```
- ✅ PASS: All HTTP requests logged with method, path, status, response time
- ❌ FAIL: No request logging

**Step 5: Check for alerting/monitoring integration**
```
grep -rn --include="*.ts" --include="*.yaml" --include="*.yml" -iE "sentry|datadog|newrelic|prometheus|grafana|pagerduty|opsgenie|alert" apps/backend/ .github/workflows/ | head -5
```
- ✅ PASS: Error tracking (Sentry) or monitoring (Datadog/Prometheus) configured
- ⚠️ PARTIAL: Basic logging but no alerting
- ❌ FAIL: No monitoring or alerting

**Overall verdict:**
- ✅: Structured logging, security events logged, monitoring with alerts, no PII in logs
- ⚠️: console.log for errors, basic request logging, no monitoring
- ❌: No logging or monitoring — attacks go undetected
