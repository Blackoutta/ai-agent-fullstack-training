# Checklist 18 — Data Privacy, Compliance & Change Management

> **Items:** 60  |  **IDs:** PC-001 → PC-060  
> **Applies to:** All languages, all repository types  
> **Sources:** SOC 2 Trust Service Criteria (all 5 categories), EY/ISAE 3402, GDPR, COBIT CC5.x (Change Management), CertiK DORA & MiCA compliance, NIST SP 800-53 mapping, CertiK AI/ML penetration testing

---

## 18.1 Data Privacy & PII Handling (PC-001 → PC-014)

> **Source:** SOC 2 Privacy criteria, GDPR Articles, EY data privacy audits

| ID | Check | Severity |
|----|-------|----------|
| PC-001 | All personal data (PII) collected by the application is inventoried and documented | 5 |
| PC-002 | Each PII field has a stated purpose — no collection without justification | 5 |
| PC-003 | Data minimization: only the minimum necessary PII is collected for each purpose | 4 |
| PC-004 | User consent mechanism exists for PII collection (opt-in, not opt-out) where required | 5 |
| PC-005 | Privacy policy is published, accessible, and accurately describes data practices | 4 |
| PC-006 | PII is encrypted at rest in databases (field-level or full-disk encryption) | 7 |
| PC-007 | PII is encrypted in transit (TLS 1.2+ for all endpoints handling personal data) | 7 |
| PC-008 | Data retention policy exists: PII is deleted after its stated retention period | 5 |
| PC-009 | Right to deletion: mechanism exists for users to request erasure of their data | 5 |
| PC-010 | Right to access: users can export/view their stored personal data | 4 |
| PC-011 | Cross-border data transfers comply with applicable regulations (e.g. GDPR adequacy) | 4 |
| PC-012 | Wallet addresses are treated as pseudonymous identifiers — linked PII gets full protection | 5 |
| PC-013 | KYC/identity data (if collected) has stricter access controls than general app data | 7 |
| PC-014 | PII is not logged in plaintext in application logs | 7 |

---

## 18.2 Regulatory Compliance Mapping (PC-015 → PC-026)

> **Source:** EY compliance audit, CertiK VARA/MiCA/DORA, NIST SP 800-53, OWASP

| ID | Check | Severity |
|----|-------|----------|
| PC-015 | Applicable regulations are identified and documented (e.g. GDPR, MiCA, DORA, SOC 2) | 4 |
| PC-016 | Each regulation's requirements are mapped to specific controls in the codebase | 4 |
| PC-017 | OWASP Top 10 (2025) categories are mapped to project security controls | 5 |
| PC-018 | SOC 2 Trust Service Criteria applicability is assessed: Security, Availability, Confidentiality, Processing Integrity, Privacy | 4 |
| PC-019 | Compliance documentation is version-controlled and reviewed periodically | 3 |
| PC-020 | Regulatory changes are tracked — process exists to update controls when laws change | 3 |
| PC-021 | Third-party compliance dependencies are documented (e.g. cloud provider SOC 2 reports) | 3 |
| PC-022 | Financial regulations applicable to DeFi in target jurisdictions are identified | 4 |
| PC-023 | AML/KYC requirements are assessed and implemented if the product requires them | 5 |
| PC-024 | Terms of Service exist and are legally reviewed | 3 |
| PC-025 | Geographic restrictions (geofencing) are implemented where regulations require | 4 |
| PC-026 | Compliance status is tracked in a living document, not just at audit time | 3 |

---

## 18.3 Change Management & SDLC Security (PC-027 → PC-040)

> **Source:** SOC 2 CC5.x (Control Activities), COBIT, EY IT Audit (Change Management Auditing)

| ID | Check | Severity |
|----|-------|----------|
| PC-027 | All production changes go through version control (Git) — no direct production edits | 6 |
| PC-028 | Pull request / merge request required for all production branch changes | 5 |
| PC-029 | Code review by at least one independent reviewer before merge to production branch | 6 |
| PC-030 | Security-sensitive changes require review by a security-aware team member | 6 |
| PC-031 | CI/CD pipeline runs automated tests before deployment is allowed | 6 |
| PC-032 | Deployment to production requires explicit approval (not auto-deploy on merge) | 5 |
| PC-033 | Rollback procedure is documented and tested — can revert to previous version within RTO | 6 |
| PC-034 | On-chain program upgrades follow documented approval process (multisig for mainnet) | 8 |
| PC-035 | Database migrations are reviewed, reversible where possible, and tested in staging | 5 |
| PC-036 | Changelog is maintained documenting all significant changes with dates and authors | 3 |
| PC-037 | Emergency hotfix process exists with post-hoc review requirement | 4 |
| PC-038 | Feature flags / environment separation prevents untested code from reaching production | 4 |
| PC-039 | Access to production deployment is restricted to authorized personnel only | 6 |
| PC-040 | Third-party dependency updates follow a review process (not auto-merged) | 5 |

---

## 18.4 Penetration Testing & Attack Simulation (PC-041 → PC-050)

> **Source:** CertiK penetration testing product (Application, Network, Cloud, AI/ML, SDK, Source Code), OWASP PTES, NIST

| ID | Check | Severity |
|----|-------|----------|
| PC-041 | External penetration test has been performed at least once before mainnet launch | 6 |
| PC-042 | Pentest scope covered: web application, API endpoints, authentication flows | 5 |
| PC-043 | Pentest scope covered: on-chain program interactions (crafted transactions, edge cases) | 7 |
| PC-044 | Pentest scope covered: cloud infrastructure and server configuration | 5 |
| PC-045 | Pentest findings are tracked to resolution with re-test confirmation | 6 |
| PC-046 | Pentest report is retained and available for compliance/audit purposes | 3 |
| PC-047 | Automated security scanning (DAST) runs periodically against live environments | 4 |
| PC-048 | API security testing covers: auth bypass, rate limiting, injection, IDOR, mass assignment | 6 |
| PC-049 | Wallet/key management security has been tested: key storage, signing process, recovery | 7 |
| PC-050 | Attack surface inventory exists: all public endpoints, on-chain entry points, admin interfaces | 5 |

---

## 18.5 AI/ML Security (PC-051 → PC-060)

> **Source:** CertiK AI/ML penetration testing, OWASP Machine Learning Security Top 10, emerging threat category

| ID | Check | Severity |
|----|-------|----------|
| PC-051 | LLM/AI integrations sanitize all outputs before using in code execution or database queries | 8 |
| PC-052 | Prompt injection defenses exist: user input is not directly concatenated into system prompts | 7 |
| PC-053 | AI-generated content is labeled as such when shown to users | 3 |
| PC-054 | AI model outputs are validated against expected schemas before downstream processing | 5 |
| PC-055 | AI/ML model access is authenticated — no unauthenticated inference endpoints | 5 |
| PC-056 | Training data does not contain secrets, private keys, or sensitive PII | 7 |
| PC-057 | Rate limiting is applied to AI/ML inference endpoints to prevent abuse/cost attacks | 5 |
| PC-058 | AI decision explanations are logged for auditability when used in financial decisions | 4 |
| PC-059 | Adversarial input testing has been performed on AI components | 4 |
| PC-060 | AI/ML dependencies are pinned and audited like any other third-party code | 5 |
