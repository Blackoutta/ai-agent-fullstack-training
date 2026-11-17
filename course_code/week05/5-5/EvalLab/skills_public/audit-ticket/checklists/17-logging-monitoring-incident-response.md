# Checklist 17 — Logging, Monitoring & Incident Response

> **Items:** 65  |  **IDs:** LM-001 → LM-065  
> **Applies to:** All languages, all repository types  
> **Sources:** CertiK Skynet (on-chain monitoring), SOC 2 Availability + Security criteria, OWASP A09:2025 (Security Logging and Alerting Failures), EY IT Audit (disaster recovery, BCM, change management)

---

## 17.1 Event Emission & Audit Trail (LM-001 → LM-014)

> **Source:** CertiK top-5 finding category "Missing Event Emissions"

| ID | Check | Severity |
|----|-------|----------|
| LM-001 | Every state-changing on-chain instruction emits an event with relevant parameters | 6 |
| LM-002 | Events include the actor (signer/authority) who triggered the state change | 5 |
| LM-003 | Events include both old and new values for critical state fields (e.g. fund status, NAV) | 5 |
| LM-004 | Financial events (deposit, withdrawal, swap, fee collection) include amounts and token mints | 7 |
| LM-005 | Admin/governance events (config change, pause, authority transfer) are emitted and indexed | 7 |
| LM-006 | Failed operations emit distinct error events (not just silent returns) | 4 |
| LM-007 | Backend API endpoints log request metadata: timestamp, IP/wallet, method, path, status code | 5 |
| LM-008 | Authentication events are logged: login success, login failure, token refresh, logout | 6 |
| LM-009 | Authorization failures are logged with the denied action and the caller identity | 6 |
| LM-010 | Database mutations (create, update, delete) have audit trail: who, when, what changed | 5 |
| LM-011 | Event/log schemas are documented and versioned — breaking changes are tracked | 3 |
| LM-012 | Log entries are structured (JSON) not free-text — parseable by automated systems | 3 |
| LM-013 | Events are not emitted for operations that did NOT actually change state (no misleading events) | 4 |
| LM-014 | On-chain events use indexed fields for efficient querying (e.g. fund address, manager) | 3 |
| LM-063 | Off-chain consumers of on-chain data (indexers, bridges, relayers, oracles) verify against **finalized on-chain state** and bind to transaction **success** — they do NOT trust emitted program logs / `emit!` events / inner-instruction data as authoritative (forgeable via self-CPI or reverting-tx log emission) (see KV-122) | 7 |

---

## 17.2 Security Logging (LM-015 → LM-026)

> **Source:** OWASP A09:2025 — Security Logging and Alerting Failures

| ID | Check | Severity |
|----|-------|----------|
| LM-015 | All security-relevant events are logged: auth, access control, input validation failures | 6 |
| LM-016 | Logs do NOT contain secrets: passwords, tokens, private keys, session IDs, PII | 8 |
| LM-017 | Logs do NOT contain raw user input that could enable log injection attacks | 5 |
| LM-018 | Log entries include correlation IDs to trace a request across services | 4 |
| LM-019 | Log levels are properly used: ERROR for failures, WARN for anomalies, INFO for operations | 3 |
| LM-020 | Logs cannot be tampered with: append-only storage, or signed/checksummed entries | 5 |
| LM-021 | Log retention period is defined and enforced (minimum 90 days for security events) | 4 |
| LM-022 | Logs are stored separately from the application — not on the same volume/service | 4 |
| LM-023 | Rate-limit violation events are logged with source IP/wallet | 5 |
| LM-024 | Transaction signature verification failures are logged with full context | 6 |
| LM-025 | Server-side logging exists (not just client-side console.log) | 5 |
| LM-026 | Log volume is manageable — no debug-level logging in production flooding storage | 3 |

---

## 17.3 Monitoring & Alerting (LM-027 → LM-040, LM-064 → LM-065)

> **Source:** CertiK Skynet, SOC 2 Security/Availability monitoring criteria

| ID | Check | Severity |
|----|-------|----------|
| LM-027 | Runtime health monitoring exists: uptime, response time, error rate, CPU/memory | 5 |
| LM-028 | On-chain monitoring tracks critical program state changes in real-time | 6 |
| LM-029 | Vault/treasury balance is monitored with alerts for unexpected decreases | 8 |
| LM-030 | Anomaly detection for unusual transaction patterns: large withdrawals, rapid-fire calls | 7 |
| LM-031 | Alerting is configured for error rate spikes (e.g. > 5% 5xx in 5 minutes) | 5 |
| LM-032 | Alerts have defined severity levels and escalation paths (page on critical, email on warn) | 4 |
| LM-033 | Alert fatigue is managed: no noisy alerts that are routinely ignored | 3 |
| LM-034 | External dependency health is monitored: RPC nodes, databases, third-party APIs | 5 |
| LM-035 | SSL/TLS certificate expiry is monitored with advance alerts (≥ 30 days before expiry) | 4 |
| LM-036 | Domain/DNS changes are monitored for unauthorized modifications | 5 |
| LM-037 | Program upgrade authority changes are monitored and alerted on-chain | 8 |
| LM-038 | Token mint authority usage is monitored — unexpected mints trigger immediate alerts | 9 |
| LM-039 | Monitoring dashboards are accessible to the team (not just one person) | 3 |
| LM-040 | Monitoring systems themselves have redundancy — single monitoring failure doesn't blind the team | 4 |
| LM-064 | Indexing and monitoring pipelines record the **transaction version** and the v1 `transactionConfig` (compute-unit limit, loaded-accounts data-size limit, heap size, priority fee in total lamports) per transaction in dedicated fields; any dashboard or metric that shows a priority fee labels its units (v0 micro-lamports per CU vs v1 lamports total) and never mixes them in one series (see KV-136) | 5 |
| LM-065 | Stream and reader liveness is alarmed: `blockSubscribe` / Geyser slot not advancing for N seconds or a `block: null`, a rise in `getTransaction` / `getBlock` error `-32015`, and a spike in transactions indexed with a zero compute budget or zero priority fee (the signature of a silent v1 misparse) each page an operator (see KV-136, `references/vuln-classes/transaction-v1.md` V10) | 6 |

---

## 17.4 Incident Response (LM-041 → LM-052)

> **Source:** SOC 2 Availability, EY IT Audit, CertiK best practices

> **Working an actual incident, not auditing readiness?** These items check whether a team is *prepared*. To investigate a live or past compromise from transaction history and program logs, use the detection & response track — `/auditor:hunt` (no alert in hand) and `/auditor:respond` (a signature, address, or alert), contract in [references/detection-response/README.md](../references/detection-response/README.md). It is propose-only, and its detection-engineering output maps back to LM-030, LM-037, LM-038, LM-063 and LM-065.

| ID | Check | Severity |
|----|-------|----------|
| LM-041 | Incident response plan exists and is documented | 6 |
| LM-042 | IR plan defines roles: who leads response, who communicates, who patches | 5 |
| LM-043 | Emergency pause mechanism exists for on-chain program (freeze fund operations) | 8 |
| LM-044 | Emergency pause can be triggered by multisig, not just a single key | 7 |
| LM-045 | Communication plan exists: how to notify users, where to post status updates | 4 |
| LM-046 | Contact list for IR team is maintained and up-to-date (not stale) | 3 |
| LM-047 | Post-mortem process is defined: root cause analysis, timeline, lessons learned | 4 |
| LM-048 | Post-mortems are published (at least internally) and action items are tracked to completion | 3 |
| LM-049 | IR plan has been practiced (tabletop exercise or drill) at least once | 4 |
| LM-050 | Evidence preservation protocol exists for potential legal/forensic needs | 4 |
| LM-051 | Bug bounty program or responsible disclosure policy is published | 4 |
| LM-052 | IR plan covers both on-chain exploits and off-chain compromises (backend, keys, DNS) | 5 |

---

## 17.5 Disaster Recovery & Business Continuity (LM-053 → LM-062)

> **Source:** SOC 2 Availability, EY Disaster Recovery Auditing, ISAE 3402

| ID | Check | Severity |
|----|-------|----------|
| LM-053 | Backup strategy is documented: what is backed up, frequency, retention period | 5 |
| LM-054 | Database backups are tested for restore — at least one successful restore test documented | 6 |
| LM-055 | Recovery Time Objective (RTO) and Recovery Point Objective (RPO) are defined for each service | 5 |
| LM-056 | Backup data is encrypted at rest and in transit | 6 |
| LM-057 | Backups are stored in a different region/provider from production (geographic redundancy) | 5 |
| LM-058 | On-chain program state can be reconstructed from events/transactions (event sourcing capability) | 5 |
| LM-059 | Failover procedure for critical infrastructure is documented and tested | 5 |
| LM-060 | RPC endpoint failover: application switches to backup RPC on primary failure | 5 |
| LM-061 | Key recovery procedure exists: what happens if a deploy key is lost/compromised | 7 |
| LM-062 | Business continuity plan covers extended outage (>24h) — manual processes, user communication | 4 |
