<!--
================================================================================
PERSISTED INTAKE ARTIFACT
================================================================================
Written by /intake (alias /scope) to audit_<n>/intake.md. This is the persisted
form of QUESTIONS.md — the passive questionnaire turned into a durable file that
BOTH flows read (audit-cycle applies defaults; audit-assist asks the human).
Fixes "answers live only in conversation state."

FEEDS THE REPORT:
  - Scope / commit / languages / effort   -> §2 Scope & Engagement (2.1-2.4)
  - Trust-model inputs                     -> §4.4 Trust Model & Actors, §4.6 Assumptions
  - Severity calibration                   -> §5 Severity Classification (deployment/TVL levers)
  - Assumed defaults (unanswered)          -> §4.6 Assumptions & Simplifications
  - Execution mode + outside services      -> §3.5 Coverage & Limitations (OUTPUT-RULES Rule 11a / 11b)

HOW TO USE:
  1. Copy to audit_<n>/intake.md (create audit_<n>/ with a .gitignore containing
     "*" as its first file — OUTPUT-RULES Rule 11d). Fill every {placeholder}.
  2. Interactive flow (/intake): ASK each unanswered question, record the answer.
  3. Auto flow (audit-cycle): apply the QUESTIONS.md default, and record it under
     "Assumed Defaults (Unanswered)" with the exact default applied — never leave
     a field blank and never silently assume.
  4. Every assumption recorded here MUST surface in the report's §4.6. A default
     applied here is a stated assumption there, not a hidden one.
================================================================================
-->

# Intake — {protocol / client name}

| | |
| ------------------- | ------------------------------------------------- |
| **Audit #**         | audit_{n}                                         |
| **Mode**            | {automated (audit-cycle) / human-in-loop (audit-assist)} |
| **Intake date**     | {YYYY-MM-DD}                                       |
| **Answered by**     | {human / defaults applied}                         |

---

## 1. Scope & Commit Pin

<!-- Feeds report §2.1-2.3. Pin the commit so the report names exactly what was reviewed. -->

| | |
| ------------------- | ------------------------------------------------- |
| **Repository**      | {path or URL}                                     |
| **Branch**          | {branch reviewed}                                 |
| **Audited commit**  | `{full 40-char SHA}` (`git rev-parse HEAD`)       |
| **Scope**           | {FULL / PROGRAM / BACKEND / FRONTEND / DEVOPS}    |
| **In scope**        | {paths / programs / dirs reviewed}                |
| **Out of scope**    | {excluded paths + reason — Q44} |
| **audit-mem store** | {path of the store that passed the Rule 11d check / none} |

---

## 2. Target Languages & Frameworks

<!-- Drives the scope-gated checklist set (SKILL.md -> SCOPE-GATED LOADING). Q3-Q7. -->

| | |
| --------------------- | ----------------------------------------------- |
| **On-chain framework**| {Anchor <ver> / native Solana / Pinocchio / N/A} (Q3) |
| **Languages detected**| {Rust / TypeScript / Python / Go / …}           |
| **Backend**           | {Express / Fastify / NestJS / none / …} (Q4)    |
| **Frontend**          | {Next.js / React / Vue / none / …} (Q5)         |
| **Database**          | {PostgreSQL / MongoDB / none / …} (Q6)          |
| **Monorepo**          | {yes / no / multi-repo} (Q7)                    |

---

## 3. Protocol Class

<!-- Q1 + Q17-Q24. Gates economic checklists (06) and known-vectors. Feeds report §4.1. -->

| | |
| ----------------------- | --------------------------------------------- |
| **Project type**        | {DeFi / NFT / DAO / payments / gaming / infra / …} (Q1) |
| **Handles user funds**  | {yes — custodial / yes — non-custodial / no} (Q17) |
| **Tokens supported**    | {SOL / specific SPL / any SPL / Token-2022 / …} (Q18) |
| **DEX integrations**    | {Jupiter / Raydium / Orca / none / …} (Q19)   |
| **Fees**                | {management / performance / swap / withdrawal / none} (Q20) |
| **Withdrawal model**    | {instant / multi-step / time-locked / admin-approved / none} (Q21) |
| **Uses oracles**        | {Pyth / Switchboard / custom / DEX-quote / none} (Q23) |
| **CPI targets**         | {Token / ATA / DEX / staking / other / none} (Q24) |
| **Economic review**     | {required (funds=yes) / not required} — checklist 06 {on/off} |

---

## 4. Compliance Frameworks

<!-- Q35-Q38. Gates compliance checklist (18). Feeds report §4.6 / scope. -->

| | |
| ----------------------- | --------------------------------------------- |
| **Regulatory scope**    | {none / MiCA / SEC / GDPR / SOC 2 / DORA / …} (Q35) |
| **Collects PII**        | {no — wallets only / email / KYC / financial} (Q36) |
| **Compliance checklist**| {checklist 18 on / off} |

---

## 5. Severity Calibration

<!--
The deployment/TVL levers that shift severity (Rule 1 Impact x Likelihood).
Feeds report §5 and every finding's severity derivation. Q8, Q10, Q11, Q40-Q41.
Record the concrete calibration rule applied, not just the answer.
-->

| | |
| ------------------------- | ------------------------------------------- |
| **Deployment status**     | {pre-launch / devnet / mainnet-live} (Q8)  |
| **TVL / funds at risk**   | {$0 / <$10K / $10K-100K / $100K-1M / $1M-10M / >$10M} (Q10) |
| **Upgradeable**           | {single wallet / multisig / DAO / immutable / N/A} (Q11) |
| **Top concerns (ranked)** | {1. … / 2. … / 3. …} (Q40)                 |
| **Audit depth**           | {quick / standard / deep / maximum} (Q41)  |

**Calibration rules applied**

<!-- Translate the answers into the concrete severity adjustment (see QUESTIONS.md
     "How Answers Affect the Audit"). Each is a lever the report's §5 will cite. -->

- {Q8 = mainnet-live → +1 severity on all fund-related findings.}
- {Q10 > $1M → critical findings double-weighted in risk score.}
- {Q11 = single wallet → upgrade authority auto-flagged Severity 8+.}
- {Q41 = quick → grep + known-vectors only, semantic analysis skipped (state as coverage limit).}

---

## 6. Trust-Model Inputs (CRITICAL)

<!--
The load-bearing section. WHO is trusted — the inputs that seed report §4.4
(Trust Model & Actors) and §4.6 (Assumptions & Simplifications), and that
/threat-model expands into the actor x capability table. A finding gated by a
trusted role is capped in severity BECAUSE of what is recorded here; if an entry
is "untrusted", a bypass by that actor is a full-severity finding.

For each: name who holds it, what they can do, and what the review TRUSTS them
NOT to do. "Untrusted / permissionless" is a valid and important answer.
-->

| Actor | Who / how gated | Trusted to (privileges) | Trusted NOT to |
| ----- | --------------- | ----------------------- | -------------- |
| **Upgrade authority** | {single wallet / multisig / DAO / immutable} (Q11) | {upgrade program} | {push a malicious upgrade; assumed key-secure} |
| **Admin / manager**   | {wallet sig / admin JWT / on-chain authority} (Q16) | {set params, pause, …} | {abuse privileged ops; assumed honest} |
| **Oracle**            | {Pyth / Switchboard / custom} (Q23) | {supply price} | {report manipulated / stale price beyond bounds} |
| **Keeper / crank**    | {who runs it} | {trigger scheduled ops} | {reorder / withhold to grief} |
| **LP / depositor**    | {permissionless} | {deposit, withdraw own} | — (untrusted) |
| **Permissionless user** | {anyone} | {call open instructions} | — (untrusted — the attacker) |

**Trust-model narrative** — {2-4 sentences: the security of the system depends on
which of the above holding. State the load-bearing ones plainly. This is the seed
text for report §4.6.}

---

## 7. Security History

<!-- Q25-Q28. Feeds methodology / prior-fix assumptions. Q25 = first audit -> no
     assumptions about prior fixes; enables deeper analysis. -->

| | |
| ----------------------- | --------------------------------------------- |
| **Prior audits**        | {firm name / internal / tools only / first audit} (Q25) |
| **Incidents**           | {fund loss / blocked exploit / breach / none} (Q26) |
| **Bug bounty**          | {public / private / none} (Q27) |

---

## 8. Execution Mode & Outside Services

<!--
Q46. OUTPUT-RULES Rule 11a: where target-controlled code (builds, tests, installs,
Anchor.toml [scripts], and every PoC build) may run. Asked once per audit;
every later step that executes target code or builds a PoC uses this answer, and
templates/poc/run.sh receives it as AUDITOR_EXEC_MODE. In the auto flow an
unanswered Q46 is "native" and goes in §9 with its basis. Outside services are not
gated — they are listed in the report (Rule 11b).
-->

| | |
| ------------------------- | ------------------------------------------- |
| **Execution mode**        | {isolated (recommended) / native} (Q46)     |
| **Isolation used**        | {container / VM / Claude Code sandbox — no keys or credentials mounted / N/A (native)} |
| **Outside services**      | {disclosed in the report per Rule 11b — e.g. RPC provider, second-opinion LLM, registry queries / none planned} |

---

## 9. Assumed Defaults (Unanswered)

<!--
MANDATORY when any question was not answered by a human (the norm for the auto
flow). For each unanswered item, record the QUESTIONS.md default that was applied
and note it will appear as a stated assumption in report §4.6. Never leave a field
blank; never silently assume. The interactive flow SHOULD leave this section empty
(everything was asked) — if it is non-empty in interactive mode, list what the
human explicitly deferred.
-->

| Field (Q#) | Default applied | Basis |
| ---------- | --------------- | ----- |
| {Q10 TVL — unanswered} | {assumed "Unknown" → severity calibrated to pre-launch baseline} | QUESTIONS.md default |
| {Q11 upgradeable — unanswered} | {assumed present; upgrade authority treated as trusted-but-single unless code shows otherwise} | QUESTIONS.md default |
| {Q23 oracle — unanswered} | {assumed no oracle unless code shows a feed} | inferred from code |
| {Q46 execution mode — unanswered} | {native — target-controlled code runs on the auditor's machine; the report states it} | OUTPUT-RULES Rule 11a default |
| {…} | {…} | {…} |

> Every default listed here is carried into the report's **§4.6 Assumptions &
> Simplifications** as an explicit assumption — so "no finding here" reads against
> the stated default rather than as a blanket clearance.
