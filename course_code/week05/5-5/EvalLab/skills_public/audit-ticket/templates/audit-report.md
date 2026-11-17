<!--
================================================================================
CLIENT-FACING AUDIT REPORT TEMPLATE
================================================================================
This is the PROFESSIONAL, findings-focused deliverable handed to the client —
structured the way public Solana security reports are (Trail of Bits, OtterSec,
Neodyme, Zellic, Zenith, Halborn, Certora). It is DISTINCT from
templates/report-template.md, which is the INTERNAL item-by-item verdict report
(1446-item checklist grid + 1-10 risk score). Use THIS file when producing the
report the client reads.

HOW TO USE:
  1. Copy this file to audit_<n>/REPORT.md (see OUTPUT-RULES.md Rule 9).
  2. Fill every {placeholder}. Delete guidance comments (<!-- ... -->) as you go.
  3. Keep the internal per-item verdicts in the internal report; surface only
     confirmed findings here (each must have survived the Rule 5b validation gate).
  4. Order findings by severity descending (Critical -> Informational). Zellic's
     convention of ordering by *importance/impact* rather than raw severity is an
     acceptable alternative — pick one and be consistent.

CONVENTION — NO "SAFE TO DEPLOY" STAMP:
  Real firms do NOT certify code as "safe" or "guaranteed secure." This template
  MUST NOT contain a deploy blessing. Communicate readiness through: (a) the
  code-maturity narrative, (b) finding resolution status, and (c) explicit
  trust-model caveats. An audit is a point-in-time, scoped, non-exhaustive review
  — never a guarantee. This framing is enforced in the Disclaimer appendix.

IP BOUNDARY: use only public-derivable firm conventions. Never reference or quote
the proprietary knowledge base, and re-author all conventions in original wording.
================================================================================
-->

# {Protocol / Client Name} — Security Audit Report

<!-- COVER / METADATA -------------------------------------------------------- -->

|                       |                                                        |
| --------------------- | ------------------------------------------------------ |
| **Auditor**           | auditor-skill v7.6                                     |
| **Client**            | {client / organization}                                |
| **Protocol**          | {protocol / product name}                              |
| **Report Title**      | {e.g. "Vault Program Security Assessment"}             |
| **Report Version**    | {e.g. 1.0 — draft / 1.1 — final / 2.0 — post-fix}     |
| **Audit Window**      | {YYYY-MM-DD → YYYY-MM-DD} <!-- when review work happened --> |
| **Report Published**  | {YYYY-MM-DD} <!-- date THIS revision was issued --> |
| **Classification**    | {Confidential — Client Only / Public / Draft}          |

### Revision History

<!--
Promote the revision log to a rendered table (do NOT bury it in a comment).
Bump the version on each material re-issue. Typical lifecycle:
  1.0 Draft (initial findings) -> 1.1 Final (after client review) ->
  2.0 Fix-Review (after remediation, statuses updated, fix commits recorded).
Add one row per delivered revision. "Author" = the person/agent who issued it.
-->

| Version | Date       | Description                                       | Author      |
| ------- | ---------- | ------------------------------------------------- | ----------- |
| 1.0     | {date}     | Initial draft delivered                           | {name}      |
| 1.1     | {date}     | Client comments incorporated                      | {name}      |
| 2.0     | {date}     | Fix review; statuses + fix commits added          | {name}      |

---

## Table of Contents

<!--
Keep in sync with the section headings below. Anchor links use GitHub slug rules
(lowercase, spaces -> hyphens, punctuation stripped). Trim rows for sections you
delete.
-->

1. [Executive Summary](#1-executive-summary)
   - [1.1 Findings Summary by Severity](#11-findings-summary-by-severity)
   - [1.2 Finding Lifecycle](#12-finding-lifecycle)
   - [1.3 Security Posture & Codebase Maturity](#13-security-posture--codebase-maturity)
   - [1.4 Key Takeaways](#14-key-takeaways)
2. [Scope & Engagement](#2-scope--engagement)
   - [2.1 Engagement Envelope](#21-engagement-envelope)
   - [2.2 Repository & Commits](#22-repository--commits)
   - [2.3 In Scope](#23-in-scope)
   - [2.4 Out of Scope](#24-out-of-scope)
3. [Methodology](#3-methodology)
   - [3.1 Assessment Goals](#31-assessment-goals)
   - [3.2 Approach](#32-approach)
   - [3.3 Phases Executed](#33-phases-executed)
   - [3.4 Human-in-the-Loop vs. Automated](#34-human-in-the-loop-vs-automated)
   - [3.5 Coverage & Limitations](#35-coverage--limitations)
4. [System Overview](#4-system-overview)
   - [4.1 Protocol Description](#41-protocol-description)
   - [4.2 Account / PDA Model](#42-account--pda-model)
   - [4.3 Instruction Inventory](#43-instruction-inventory)
   - [4.4 Trust Model & Actors](#44-trust-model--actors)
   - [4.5 Key Invariants](#45-key-invariants)
   - [4.6 Assumptions & Simplifications](#46-assumptions--simplifications)
   - [4.7 Systemic / Thematic Risks](#47-systemic--thematic-risks)
5. [Severity Classification](#5-severity-classification)
   - [5.1 Severity Tiers](#51-severity-tiers)
   - [5.2 Impact × Likelihood Matrix](#52-impact--likelihood-matrix)
6. [Findings](#6-findings)
   - [6.1 Findings Summary Table](#61-findings-summary-table)
   - [6.2 Detailed Findings](#62-detailed-findings)
7. [Findings Summary Table](#7-findings-summary-table)
8. [Code Maturity Assessment](#8-code-maturity-assessment)
9. [Appendices](#9-appendices)
   - [9.1 Severity Rating Definitions](#91-severity-rating-definitions)
   - [9.2 Status Vocabulary](#92-status-vocabulary)
   - [9.3 Tools & Versions](#93-tools--versions)
   - [9.4 Disclaimer](#94-disclaimer)

---

## 1. Executive Summary

<!--
2-4 sentences: who was engaged, what was reviewed (protocol + scope in one line),
the audit window, and the headline outcome (counts of Critical/High, overall
maturity). Plain language a non-engineer stakeholder can read. NO deploy blessing.
-->

{auditor-skill was engaged by {client} to perform a security assessment of the
{protocol} {program/codebase}. The review covered {N} program(s) / {LoC} lines over
{duration}. The assessment identified {X} findings: {n} Critical, {n} High, {n}
Medium, {n} Low, and {n} Informational. {One sentence on the dominant theme, e.g.
"The core accounting logic is sound; findings cluster around access-control
hardening and input validation."}}

### 1.1 Findings Summary by Severity

| Severity            | Count | Resolved | Acknowledged | Open |
| ------------------- | :---: | :------: | :----------: | :--: |
| 🔴 Critical         | {n}   | {n}      | {n}          | {n}  |
| 🟠 High             | {n}   | {n}      | {n}          | {n}  |
| 🟡 Medium           | {n}   | {n}      | {n}          | {n}  |
| 🔵 Low              | {n}   | {n}      | {n}          | {n}  |
| ⚪ Informational    | {n}   | {n}      | {n}          | {n}  |
| **Total**           | **{N}** | **{n}** | **{n}**     | **{n}** |

### 1.2 Finding Lifecycle

<!--
Fuller picture than the resolution snapshot above: tracks each finding across its
whole lifecycle so the client sees how the engagement progressed, not just the end
state. Columns:
  - Discovered   — raised by the audit (should equal Count above).
  - Confirmed    — validated as a real issue after the reachability + impact gate
                   (a discovered candidate that survives triage). Discovered minus
                   Confirmed = candidates downgraded/withdrawn before reporting.
  - Resolved     — Fixed or Partially Fixed and verified by the auditor.
  - Acknowledged — client agrees it is valid; fix tracked but not yet landed.
  - Open          — not yet triaged / no client position recorded.
Row totals: Resolved + Acknowledged + Open should reconcile to Confirmed.
-->

| Severity            | Discovered | Confirmed | Resolved | Acknowledged | Open |
| ------------------- | :--------: | :-------: | :------: | :----------: | :--: |
| 🔴 Critical         | {n}        | {n}       | {n}      | {n}          | {n}  |
| 🟠 High             | {n}        | {n}       | {n}      | {n}          | {n}  |
| 🟡 Medium           | {n}        | {n}       | {n}      | {n}          | {n}  |
| 🔵 Low              | {n}        | {n}       | {n}      | {n}          | {n}  |
| ⚪ Informational    | {n}        | {n}       | {n}      | {n}          | {n}  |
| **Total**           | **{N}**    | **{N}**   | **{n}**  | **{n}**      | **{n}** |

### 1.3 Security Posture & Codebase Maturity

<!--
This is NOT a "safe to deploy" verdict. Mirror how real firms convey readiness:
  - Codebase maturity: overall engineering quality (test coverage, arithmetic
    discipline, account validation rigor, error handling) — reference the Code
    Maturity Assessment in §8 for the scored breakdown.
  - Resolution status: how many of the material findings are fixed vs. open.
  - Trust-model caveats: what the security of the system CURRENTLY depends on
    (e.g. "an honest, non-compromised upgrade authority", "an accurate oracle",
    "a multisig that is actually multi-party"). State these plainly — they are
    the assumptions under which the remaining findings are acceptable, and they
    tie directly to §4.6 (Assumptions & Simplifications).

Write 2-4 short paragraphs. Convey readiness through maturity + resolution +
caveats, never through a blessing. Example framing:

  "The {protocol} codebase demonstrates {strong/moderate/early-stage} engineering
   maturity (see §8). Arithmetic is {consistently checked / mostly checked with
   gaps at ...}; account validation is {rigorous / has the gaps noted in AUD-xx}.
   As of this revision, {all Critical and High findings are resolved / N High
   findings remain open}. The security of the deployed system depends on the
   trust assumptions in §4.6 holding: {list the load-bearing ones}. Should any of
   these assumptions change (upgrade authority handoff, oracle swap, parameter
   change), a re-review of the affected surface is recommended."
-->

{maturity + resolution + trust-model narrative}

### 1.4 Key Takeaways

<!-- 3-6 bullets. The most important things the client should walk away knowing. -->

- {e.g. "Critical AUD-01 (permissionless vault drain) has been fixed in {commit}."}
- {e.g. "The program's upgrade authority is a single EOA — recommend a multisig + timelock before mainnet."}
- {e.g. "Test coverage is strong for happy paths but thin on adversarial cases; property tests recommended."}
- {...}

---

## 2. Scope & Engagement

### 2.1 Engagement Envelope

<!--
The engagement-envelope block: the who/what/how-much of the review at a glance.
Records the audited commit, remediation commit(s), effort, and an HONEST note when
the review met resistance (e.g. scope exceeded the LOC budget, code arrived late,
part of the tree was closed-source). Do not soften a real constraint — a candid
note here is more credible than silence and protects both parties.
-->

|                            |                                                   |
| -------------------------- | ------------------------------------------------- |
| **Audited Commit**         | `{full 40-char SHA}` <!-- state of code reviewed --> |
| **Remediation Commit(s)**  | `{SHA}` {, `{SHA}` …} <!-- fixes verified; "N/A" if no fix round --> |
| **Scope Size**             | {LoC in scope} <!-- how it maps to the effort/budget --> |
| **Effort**                 | {e.g. ~X person-days / N agents / team of M}      |
| **Team / Agents**          | {e.g. auditor-skill agent fleet: <roles> / named reviewers} |
| **Scope vs. Budget Note**  | {Honest note. E.g. "Scope came in at {LoC}, above the {budget} LoC envelope for this tier; {which surfaces got full depth vs. lighter passes}." or "Code was within budget; full depth across all in-scope files." or "Program X was delivered as a compiled artifact only — see §2.4."} |

### 2.2 Repository & Commits

|                              |                                                   |
| ---------------------------- | ------------------------------------------------- |
| **Repository**               | {https://github.com/org/repo}                     |
| **Branch**                   | {branch reviewed}                                 |
| **Review Start Commit**      | `{full 40-char SHA}` <!-- code at kickoff --> |
| **Fix-Review End Commit**    | `{full 40-char SHA}` <!-- code after remediation; "N/A" if no fix round --> |
| **Lines of Code (in scope)** | {LoC} <!-- exclude tests/generated if scoped out; note if so --> |
| **Audit Window**             | {e.g. 2026-06-15 → 2026-06-26 (2 weeks)}          |
| **Report Published**         | {YYYY-MM-DD}                                       |

### 2.3 In Scope

<!-- Explicit list of programs / files / directories that WERE reviewed. -->

| Component | Path | Language | Notes |
| --------- | ---- | -------- | ----- |
| {Program name} | `programs/{name}/src/` | Rust (Anchor {version}) | {on-chain program} |
| {Off-chain service} | `apps/{name}/src/` | TypeScript | {if in scope} |
| {...} | {...} | {...} | {...} |

### 2.4 Out of Scope

<!--
Be explicit. This protects both parties. Typical exclusions: third-party
dependencies, the underlying Solana runtime/SVM, off-chain infra not provided,
front-end UI, deployment keys/opsec, economic/game-theoretic soundness of the
tokenomics beyond code correctness, and any code outside the listed commits.
Also list anything that was in the repo but deliberately NOT reviewed, and why
(e.g. delivered closed-source / compiled-only, or explicitly de-scoped by client).
-->

- {e.g. Third-party programs invoked via CPI (SPL Token, Jupiter) — assumed correct.}
- {e.g. Off-chain keeper / crank infrastructure not included in the repository.}
- {e.g. Front-end / client application (unless separately listed as in scope).}
- {e.g. Deployment process, key custody, and operational security (see Disclaimer).}
- {e.g. Economic model / tokenomics design beyond on-chain code correctness.}
- {e.g. Program X, delivered as a compiled artifact only — source not provided, could not be reviewed.}
- {Any code outside the commits in §2.2.}

---

## 3. Methodology

<!--
Describe HOW the review was conducted. Real reports state the mix of manual and
automated work, the tools, the concrete questions asked, and the phases.
auditor-skill runs a chunked, file-by-file manual review (never one-shot)
augmented by tooling.
-->

The assessment combined **manual, line-by-line human-in-the-loop review** with
**automated tooling**. Manual review is the primary method; tooling is used to
widen coverage and catch mechanical issues.

### 3.1 Assessment Goals

<!--
State the concrete questions the review set out to answer. These make the audit's
intent legible and let the client judge coverage against their own risk concerns.
Tailor to the protocol; the list below is a starting set. Frame as questions the
review actively tried to falsify.
-->

The review was organized around answering the following questions for the in-scope
code:

- **Fund safety** — Can assets be withdrawn, transferred, or minted without proper
  authorization? Can a permissionless caller move another party's funds?
- **Arithmetic integrity** — Can any calculation overflow, underflow, truncate, or
  divide by zero to corrupt balances, shares, or accounting?
- **Account validation** — Can required account checks (owner, signer, PDA
  derivation, mint, mutability, rent) be bypassed or confused (substitution /
  type-confusion)?
- **Access control** — Are privileged operations correctly gated? Can roles be
  escalated or impersonated?
- **State-machine soundness** — Can the protocol be driven into an invalid or
  stuck state, or can steps be reordered/skipped to an attacker's benefit?
- **CPI & composability** — Are cross-program calls made to validated targets, and
  is state correctly reloaded after them? Can an attacker supply a malicious
  callee?
- **Denial of service** — Can a critical path be cheaply blocked, bricked, or made
  economically unusable?
- **Economic / incentive** — Within code scope, can rounding, ordering, or
  precision be exploited for value extraction (e.g. first-depositor, donation,
  sandwich-on-chain)?
- {Additional protocol-specific goals, e.g. "Are oracle staleness and confidence
  bounds enforced?" / "Is the liquidation path fair and non-gameable?"}

### 3.2 Approach

- **Manual review** — every in-scope instruction/handler read in full, with
  context reconstruction before any verdict (purpose, invariants, assumptions,
  external-interaction risks per function). Findings are gated for reachability
  and impact before being reported (over-reporting is actively suppressed).
- **Automated analysis** — {list what was actually run, e.g.:}
  - Static analysis / SAST: {e.g. `cargo clippy`, `semgrep`, custom lints}
  - Dependency / supply-chain: {e.g. `cargo audit`, `npm audit`}
  - {Fuzzing / property tests: `cargo-fuzz`, `proptest`, `trident` — if used}
  - {Formal verification: {tool} — if used, else state "not applied in this engagement"}

### 3.3 Phases Executed

<!-- List the phases actually run. Delete rows that don't apply. -->

| Phase | Focus |
| ----- | ----- |
| Scope declaration & discovery | Enumerate languages, programs, entry points |
| Context reconstruction | Per-function purpose, invariants, assumptions |
| On-chain program review | Account validation, access control, arithmetic, CPI/PDA, state machine, economic logic |
| Off-chain review | {TypeScript / backend / frontend — if in scope} |
| DevOps & supply chain | Dependencies, secrets, deployment config |
| Verification & monitoring | Test/fuzz quality, logging, incident response |
| Known-vector sweep | Curated Solana attack-vector checklist |
| Code maturity assessment | 9-category engineering-quality scorecard |

### 3.4 Human-in-the-Loop vs. Automated

<!--
One short paragraph. State clearly that a human/agent reasoned about each finding
(automated tools alone do not close a finding). Reachability and exploitability
claims are human-verified against the source.
-->

{All reported findings were manually verified against the source; automated tool
output was triaged and confirmed by review before inclusion. Findings that could
not be shown reachable and impactful were downgraded or excluded rather than
reported speculatively.}

### 3.5 Coverage & Limitations

<!--
Be candid about what was and was not exercised. This is not an admission of
weakness — it is what distinguishes a credible report from an overclaim, and it
scopes the assurance the client should take away. Cover:
  - What received full manual depth vs. a lighter pass.
  - What was executed dynamically (tests/fuzzing/simulation) vs. reviewed statically.
  - The inherent limits of the tools used (static analysis has false negatives;
    fuzzing explores a bounded input space; a passing test suite proves presence of
    correct behavior on tested paths, not absence of bugs elsewhere).
  - Anything that blocked coverage (missing source, unbuildable code, time box).
-->

- **Depth** — {Which components got full line-by-line review vs. which got a
  lighter/targeted pass, and why.}
- **Dynamic vs. static** — {What was exercised at runtime (existing tests,
  new PoCs, fuzzing, mainnet-fork simulation) vs. reasoned about statically.}
- **Tool limitations** — Automated tooling is a supplement, not a guarantee.
  Static analyzers produce false negatives and cannot reason about all
  cross-instruction or economic properties; fuzzing and property tests explore a
  bounded input space; a green test suite demonstrates correct behavior only on the
  paths it exercises. Absence of a finding in any area is **not** proof that no
  issue exists there.
- **Blockers** — {Anything that constrained coverage: code delivered late,
  portions unbuildable, closed-source components, or the engagement time box.}
- **Execution mode** — {isolated: <container / VM / sandbox> | native: target-controlled code (builds, tests, PoCs) ran on the auditor's machine — steps: …} (OUTPUT-RULES Rule 11a).
- **Outside services** — {one line per tool → service → what was sent | none} (OUTPUT-RULES Rule 11b).

---

## 4. System Overview

<!--
Give the reader the mental model needed to understand the findings. Derived from
the code, not marketing docs.
-->

### 4.1 Protocol Description

{2-5 sentences describing what the protocol does and its core mechanism.}

### 4.2 Account / PDA Model

<!-- Key accounts, their PDAs (seeds), and what they store. -->

| Account | PDA Seeds | Purpose | Key Fields |
| ------- | --------- | ------- | ---------- |
| {Vault} | `["vault", authority]` | {holds funds} | {authority, bump, balance} |
| {...} | {...} | {...} | {...} |

### 4.3 Instruction Inventory

<!--
Enumerate every in-scope instruction/handler so the reader can map findings to
entry points and see the authority surface at a glance. One row per instruction.
"Signer / Authority" = who must sign or which authority gates it (or
"permissionless"). "Accounts touched" = the key accounts read/written.
-->

| Instruction | Purpose | Signer / Authority | Accounts Touched | Notes |
| ----------- | ------- | ------------------ | ---------------- | ----- |
| `{initialize}` | {create config/state} | {admin} | {config, payer, system} | {one-time; init guard} |
| `{deposit}` | {add funds} | {user (permissionless)} | {vault, user_ata, vault_ata} | {checked math} |
| `{withdraw}` | {remove funds} | {vault authority} | {vault, vault_ata, dest_ata} | {PDA-signed CPI} |
| `{...}` | {...} | {...} | {...} | {...} |

<!--
OPTIONAL — Per-instruction account-check grid for CRITICAL handlers only.
For each security-sensitive instruction, record which validations are enforced on
each account. Use ✓ (enforced) / ✗ (missing) / — (not applicable). A ✗ on a
sensitive account usually corresponds to a finding — cross-reference the AUD ID.
Repeat this small table per critical handler; do not do it for trivial ones.

#### Account checks — `{withdraw}`

| Account | Signer | PDA / Seeds | Owner | Mutable | Rent-exempt | Notes |
| ------- | :----: | :---------: | :---: | :-----: | :---------: | ----- |
| `authority` | ✓ | — | — | — | — | must sign |
| `vault` | — | ✓ (`["vault", authority]`, stored bump) | ✓ (this program) | ✓ | ✓ | `has_one = authority` |
| `vault_token_account` | — | — | ✓ (token program) | ✓ | — | `token::authority = vault` |
| `destination` | — | — | ✓ (token program) | ✓ | — | {AUD-xx if unchecked} |
-->

### 4.4 Trust Model & Actors

<!--
Who are the actors, what privileges do they hold, and what is the system trusting
each one NOT to do. This section frames the severity of privilege-gated findings.
-->

| Actor | Privileges | Trust Assumption |
| ----- | ---------- | ---------------- |
| {Admin / upgrade authority} | {upgrade program, set params} | {assumed honest & key-secure} |
| {Manager} | {...} | {...} |
| {User / depositor} | {deposit, withdraw own funds} | {untrusted — permissionless} |
| {Oracle / external program} | {supplies price} | {assumed accurate & live} |

### 4.5 Key Invariants

<!--
The properties the system must always preserve. Findings often map to a broken
invariant. State them explicitly, and record HOW each was checked in this
engagement:
  - Manually verified   — reasoned through by a reviewer against the source.
  - Property-tested     — exercised by a fuzzer / property test (name it).
  - Unproven            — asserted by design but neither manually walked nor tested
                          here (flag as a coverage gap; candidate for future work).
-->

| ID | Invariant | Verification Status |
| -- | --------- | ------------------- |
| INV-1 | {e.g. `total_shares == shares_mint.supply` at all times.} | {Manually verified / Property-tested (`proptest: shares_conserve`) / Unproven} |
| INV-2 | {e.g. Sum of all position balances equals vault token balance.} | {...} |
| INV-3 | {e.g. Only the recorded authority can move funds out of a vault.} | {...} |
| {...} | {...} | {...} |

### 4.6 Assumptions & Simplifications

<!--
State the trust assumptions and model simplifications the review operated under.
This is load-bearing: the conclusion that the remaining (unfixed) findings are
acceptable is CONDITIONED on these holding. Make explicit which admin, oracle,
upgrade authority, or external program is trusted, and any place where the review
simplified a complex real-world behavior to reason about it. If an assumption
fails, the corresponding conclusions do not hold and a re-review is warranted.
-->

The findings, severities, and residual-risk conclusions in this report are
conditioned on the following assumptions. Where an assumption does not hold in
production, the associated conclusions must be revisited.

- **Trusted authorities** — {e.g. The upgrade authority / admin multisig is honest,
  uncompromised, and operated per its stated policy; a compromise of this key is
  out of the threat model and would invalidate the access-control conclusions.}
- **Oracle / external data** — {e.g. The configured price oracle reports accurate,
  timely values within its documented confidence bounds; oracle manipulation and
  prolonged staleness beyond the enforced bounds are assumed out of scope.}
- **Trusted external programs** — {e.g. CPIs to SPL Token / {program} behave per
  their published specification and are not themselves malicious or backdoored.}
- **Model simplifications** — {e.g. Cross-instruction MEV ordering was reasoned
  about qualitatively rather than simulated exhaustively; {other simplification}.}
- **Deployment configuration** — {e.g. Program is deployed with the reviewed
  parameters and the upgrade authority set as described; a different configuration
  changes the analysis.}
- {...}

> The judgment that any acknowledged or risk-accepted findings below are tolerable
> **depends on the assumptions above**. This is not a certification of safety (see
> §9.4).

### 4.7 Systemic / Thematic Risks

<!--
Cross-cutting concerns that are NOT a single line-level finding but shape the
system's overall risk. Reviewers routinely surface these separately from the
numbered findings because they describe structural properties, not bugs. Keep each
to a short paragraph; reference specific findings where a theme is instantiated by
one. These are advisory context — they inform the maturity narrative in §1.3.
-->

- **Centralization / privileged control** — {Which powers are concentrated in one
  key or role (mint, upgrade, pause, param-setting, fund movement), and what a
  compromise or misuse would enable. Note whether a multisig/timelock mitigates.}
- **Authority structure** — {How authorities are assigned, rotated, and revoked;
  single points of failure; whether authority handoff is safe.}
- **Ordering / synchronization** — {Sensitivity to transaction/instruction ordering,
  crank/keeper timing, or interleaving; where a race or stale read could bite.}
- **Indirect / transitive CPI risk** — {Exposure inherited from programs this code
  calls (or that call it), including composability assumptions that hold today but
  could break if a dependency upgrades.}
- {Other cross-cutting theme, e.g. upgrade-migration risk, data-availability
  assumptions, economic reflexivity.}

---

## 5. Severity Classification

<!--
This is the KEY the client uses to read the findings. Severity is DERIVED from two
axes — Impact and Likelihood — not asserted. Five headline tiers. Keep the tier
definitions as below (public firm convention). Note the mapping to the internal
1-10 scale so the two reports reconcile.
-->

Each finding is assessed on two axes — **Impact** (how bad the outcome is) and
**Likelihood** (how reachable/probable the exploit is, given the preconditions an
attacker must satisfy). The headline **Severity** is derived from the combination
via the matrix in §5.2; it is not assigned by feel.

### 5.1 Severity Tiers

| Severity            | Definition |
| ------------------- | ---------- |
| 🔴 **Critical**     | Direct, permissionless loss of funds or complete protocol compromise — exploitable by any caller with no special privilege and minimal preconditions. Must be fixed before deployment. |
| 🟠 **High**         | Loss of funds or equivalent damage that requires attacker-achievable preconditions (a specific but reachable state, a modest capital outlay, or a race). Must be fixed before release. |
| 🟡 **Medium**       | Conditional or amplified impact — state corruption, economic manipulation of limited scope, or denial-of-service on a critical path. Should be fixed. |
| 🔵 **Low**          | Best-practice deviation or defense-in-depth gap with no realistic path to fund loss under the current design. Recommended to address. |
| ⚪ **Informational** | Code quality, documentation, gas/CU, or hardening suggestions with no direct security impact. Optional. |

### 5.2 Impact × Likelihood Matrix

<!--
The published derivation grid. Rate Impact and Likelihood independently, then read
the headline severity off the cell. This makes severity reproducible and lets a
reader see WHY a finding is, say, High rather than Critical (high impact but low
likelihood). Adjust cell labels only if you have a house convention — but publish
whatever grid you use.

  Impact scale:      High   = fund loss / total compromise
                     Medium = bounded loss, state corruption, critical-path DoS
                     Low    = minor / defense-in-depth
  Likelihood scale:  High   = permissionless, minimal preconditions
                     Medium = attacker-achievable state / modest cost / race
                     Low    = privileged actor, narrow window, or costly setup
-->

Rate **Impact** and **Likelihood** independently, then read the headline severity
from the cell:

| Impact ↓ / Likelihood → | **High** | **Medium** | **Low** |
| ----------------------- | :------: | :--------: | :-----: |
| **High**                | 🔴 Critical | 🟠 High | 🟡 Medium |
| **Medium**              | 🟠 High | 🟡 Medium | 🔵 Low |
| **Low**                 | 🟡 Medium | 🔵 Low | ⚪ Informational |

<!--
INTERNAL MAPPING (keep for reconciliation with templates/report-template.md's 1-10
scale — this is how the numeric internal score collapses onto the client tiers):
    10, 9  -> Critical
     8, 7  -> High
     6, 5  -> Medium
     4, 3  -> Low
     2, 1  -> Informational
Severity of a privilege-gated issue is capped by the privilege required — that
privilege lowers Likelihood in the matrix (a bug only a trusted admin can trigger
sits in a low-likelihood column). See the trust model in §4.4 and the assumptions
in §4.6.
-->

> The auditor's internal 1–10 numeric severity maps onto these five tiers as
> **10–9 = Critical, 8–7 = High, 6–5 = Medium, 4–3 = Low, 2–1 = Informational**.
> A privilege requirement lowers the Likelihood axis, which caps the derived
> severity accordingly.

---

## 6. Findings

<!--
The core of the report. One block per finding, ordered by severity descending.
Only CONFIRMED findings appear here (each survived the reachability + impact
validation gate). Every finding needs a reproducible root-cause description and
either a concrete PoC or a rigorous reachability argument.

Status values (full vocabulary defined in §9.2):
  Fixed | Partially Fixed | Acknowledged | Risk-Accepted | Disputed | Open
-->

### 6.1 Findings Summary Table

| ID     | Title | Severity | Status |
| ------ | ----- | -------- | ------ |
| AUD-01 | {title} | 🔴 Critical | {Fixed} |
| AUD-02 | {title} | 🟠 High     | {Acknowledged} |
| AUD-03 | {title} | 🟡 Medium   | {Open} |
| {...}  | {...}   | {...}       | {...} |

---

### 6.2 Detailed Findings

<!-- ==================== WORKED EXAMPLE (delete before delivery) ============ -->
<!--
The block below is a filled-in EXAMPLE showing the expected shape and rigor.
Delete it in the final report and replace with the real findings.
-->

#### AUD-01 — Missing owner check allows draining any vault

| Field          | Value                                                       |
| -------------- | ----------------------------------------------------------- |
| **Severity**   | 🔴 Critical (internal: 10)                                  |
| **Impact**     | High — total loss of all deposited funds                    |
| **Likelihood** | High — permissionless, no special state required            |
| **Status**     | Fixed                                                       |
| **Location**   | [`programs/vault/src/instructions/withdraw.rs#L42`](https://github.com/org/repo/blob/{reviewSHA}/programs/vault/src/instructions/withdraw.rs#L42) @ `{reviewSHA}` |
| **Category**   | Access Control / Account Validation                         |

**Description**
The `withdraw` instruction reads the destination token account from
`ctx.accounts.vault_token_account` but never constrains its `authority` to the
signing user, nor verifies the `vault` PDA owns it. The account is typed
`UncheckedAccount` with a `/// CHECK:` comment that does not perform a real check.
As a result the `vault` seeds are derived from a caller-supplied `authority`
argument rather than the signer, so any caller can pass another user's vault.

**Impact**
Any permissionless caller can construct a transaction that withdraws the full
balance of an arbitrary victim vault to an attacker-controlled token account,
resulting in complete loss of all deposited funds across every vault.

**Exploit Scenario**
<!-- Named actors, numbered steps, quantified end-state. Distinct from Impact
     (the abstract worst case) and from the PoC/reachability field below (the
     mechanical proof). This is the narrative an attacker would follow. -->
1. Alice deposits 100,000 USDC; her vault PDA is derived from her authority key.
2. Eve, an unrelated account with no deposit, crafts a `withdraw` transaction
   passing Alice's authority as the `authority` argument and her own ATA as the
   destination, signing only as herself.
3. Because the vault PDA is derived from the *argument* (not Eve's signer) and no
   check ties `vault_token_account` to the vault, the transfer is authorized.
4. Eve receives Alice's 100,000 USDC. Repeating across every vault drains the
   entire program TVL in a sequence of permissionless transactions.

**Proof of Concept / Reachability**
<!-- Concrete, minimal reproduction. For Solana, a failing test / tx sketch is ideal. -->
```rust
// Attacker passes victim_authority as the `authority` arg; signs as themselves.
// Because the vault PDA is derived from the arg (not the signer) and no owner
// check ties vault_token_account to the vault, the transfer succeeds.
let (victim_vault, _) = Pubkey::find_program_address(
    &[b"vault", victim_authority.as_ref()], &program_id);
// withdraw(ctx, amount = victim_vault.balance) -> funds land in attacker ATA
```
> *Listing 1 — `withdraw` invoked against a victim vault (review commit `{reviewSHA}`).*

**Recommendation**

*Short term* — Derive the `vault` PDA from the **signer** (`authority.key()`), add
`has_one = authority`, and constrain the token account so it must belong to the vault:
```rust
#[account(mut, seeds = [b"vault", authority.key().as_ref()], bump = vault.bump,
          has_one = authority)]
pub vault: Account<'info, Vault>,
#[account(mut, token::authority = vault, token::mint = mint)]
pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
pub authority: Signer<'info>,
```
> *Listing 2 — recommended constraints.*

*Long term* — Audit every handler for the same "derive-from-argument" pattern and
adopt a convention that PDA seeds are always derived from signed accounts; add a
negative test asserting a non-owner cannot withdraw.

**Remediation**

| | |
| ------------------------ | ------------------------------------------------- |
| **Fix Commit / PR**      | [`abc1234`](https://github.com/org/repo/commit/abc1234) (PR #128) |
| **Client Response**      | {Client}: "Confirmed and patched; seeds now derive from the signer and the token account is constrained to the vault authority." |
| **Auditor Verification** | We re-tested against `abc1234` and confirmed the non-owner withdrawal PoC now fails at account validation; the fix fully resolves the issue. |

<!-- ==================== END WORKED EXAMPLE ================================= -->

---

<!-- ==================== FINDING BLOCK PATTERN (copy per finding) =========== -->

#### AUD-{NN} — {Finding Title}

| Field          | Value                                                       |
| -------------- | ----------------------------------------------------------- |
| **Severity**   | {🔴 Critical / 🟠 High / 🟡 Medium / 🔵 Low / ⚪ Informational} (internal: {1-10}) |
| **Impact**     | {High / Medium / Low} — {one-line consequence}              |
| **Likelihood** | {High / Medium / Low} — {one-line on preconditions}         |
| **Status**     | {Fixed / Partially Fixed / Acknowledged / Risk-Accepted / Disputed / Open} |
| **Location**   | [`{path/file.rs#L42}`]({repo}/blob/{reviewSHA}/{path/file.rs}#L42) @ `{reviewSHA}` {(+ additional locations if the same root cause recurs)} |
| **Category**   | {e.g. Arithmetic / Access Control / CPI / State Machine / DoS} |

<!--
LOCATION CITATION RULES:
  - Anchor every citation to the REVIEW commit: `path/file.rs#L42` @ `{reviewSHA}`,
    rendered as a permalink where the repo is available so the line is stable.
  - If the code is closed-source / delivered as a compiled artifact and cannot be
    linked, say so explicitly (e.g. "closed-source; located by symbol
    `withdraw::process`, offset from disassembly") rather than inventing a path.
  - Every code listing gets a caption (Listing N — …) noting the commit.

Severity is DERIVED: fill Impact and Likelihood, then read the tier off §5.2.
-->

**Description**
<!-- Root cause, specific to the code found. Explain the mechanism, not just the symptom. -->
{...}

**Impact**
<!-- What an attacker achieves; worst case; quantify where possible. Abstract worst
     case — the concrete step-by-step goes under Exploit Scenario. -->
{...}

**Exploit Scenario**
<!--
Named actors (Alice = honest user/victim, Eve = attacker; add others as needed),
numbered steps, and a QUANTIFIED end-state (how much is lost / what invalid state
results). This is deliberately distinct from Impact (abstract) and from the
PoC/Reachability field (mechanical proof). Omit only for Informational findings
where no attacker scenario applies.
-->
1. {Alice … }
2. {Eve … }
3. {… resulting in {quantified outcome}.}

**Proof of Concept / Reachability**
<!--
Provide ONE of:
  (a) A concrete PoC — minimal code/test/tx steps that demonstrate the issue; OR
  (b) A reachability argument (required when a runnable PoC is impractical):
      - Entry point + required signer/authority
      - Preconditions to reach the vulnerable line (each cited file:line @ commit)
      - Why existing guards do NOT block it
      - The boundary that breaks (overflow point / div-by-zero input / bad state)
      - Concrete worked case showing the break
  A finding without either a PoC or a rigorous reachability argument should not
  be reported at High+ — downgrade or exclude it.
  Caption any code listing: "Listing N — … (review commit {reviewSHA})".
-->
```
{PoC code or reachability argument}
```
> *Listing N — {caption} (review commit `{reviewSHA}`).*

**Recommendation**
<!--
Split the fix into two horizons:
  - Short term: the immediate, minimal patch that closes THIS finding.
  - Long term: systemic hardening that prevents the whole class (conventions,
    invariants to test, refactors, added guards). Omit "Long term" only when the
    finding is genuinely isolated with no class to generalize.
Give concrete code/constraints, not "fix this".
-->
*Short term* — {immediate patch}
```
{recommended fix}
```
*Long term* — {systemic hardening / class-level prevention}

**Remediation**
<!--
Replaces the single "Fix Commit" line. Three parts, each attributed:
  - Fix Commit / PR      — the remediation commit(s)/PR, permalinked; "—" if none.
  - Client Response      — the client's rationale/position, ATTRIBUTED to them
                           (their words, e.g. why they fixed it this way, or why
                           they accept the risk). Use "{Client}: ..." framing.
  - Auditor Verification — OUR independent confirmation. Use an explicit
                           verification verb: "we re-tested and confirmed ..." when
                           we verified, vs. "client states ..." when we are only
                           relaying an unverified claim. Record re-fix cycles here
                           (e.g. "first fix in `x` was incomplete; re-verified after
                           `y`").
For Open findings, leave Fix Commit as "—" and note "pending client triage".
-->

| | |
| ------------------------ | ------------------------------------------------- |
| **Fix Commit / PR**      | {`{SHA}` / PR #N, permalinked, or "—"}            |
| **Client Response**      | {"{Client}: their attributed rationale / position."} |
| **Auditor Verification** | {"We re-tested against `{SHA}` and confirmed …" / "Client states fixed; not re-verified because …" / "Pending — finding Open."} |

<!-- ==================== END FINDING BLOCK PATTERN ========================== -->

---

## 7. Findings Summary Table

<!-- Full grid of every finding for at-a-glance scanning. Mirrors §6.1; keep both. -->

| ID     | Title | Severity | Impact | Likelihood | Status | Location |
| ------ | ----- | -------- | ------ | ---------- | ------ | -------- |
| AUD-01 | {title} | 🔴 Critical | High | High | {Fixed} | `{file:line}` |
| AUD-02 | {title} | 🟠 High     | High | Medium | {Acknowledged} | `{file:line}` |
| {...}  | {...}   | {...}       | {...} | {...} | {...}  | {...} |

---

## 8. Code Maturity Assessment

<!--
Engineering-quality scorecard, orthogonal to finding severity. 9 categories,
each scored 0-4 (0 absent · 1 ad-hoc · 2 partial · 3 good · 4 strong),
weakest-link. This drives the maturity narrative in §1.3. Cite evidence.

A category may additionally be annotated "Further Investigation Required" (FIR) —
distinct from a low score. Use FIR when the engagement could NOT reach a confident
verdict for that category (e.g. code arrived late, area was out of the time box,
or a dependency was closed-source), so the reader knows a low/blank score reflects
LACK OF COVERAGE, not observed weakness. A category can be, say, provisionally 3
but flagged FIR because coverage was partial.
-->

Each category is rated **0–4**: 0 = absent · 1 = ad-hoc · 2 = partial ·
3 = good · 4 = strong (weakest-link scoring). The **FIR** column flags
"Further Investigation Required" — a coverage gap distinct from a low score.

| # | Category | Score (0–4) | FIR? | Evidence (file:line / artifact) | Gap to Next Level |
| - | -------- | :---------: | :--: | ------------------------------- | ----------------- |
| 1 | Access Controls | {0-4} | {yes/no} | {...} | {...} |
| 2 | Arithmetic | {0-4} | {yes/no} | {...} | {...} |
| 3 | Account & Type Safety | {0-4} | {yes/no} | {...} | {...} |
| 4 | Input Validation | {0-4} | {yes/no} | {...} | {...} |
| 5 | Testing | {0-4} | {yes/no} | {...} | {...} |
| 6 | Fuzzing & Property Tests | {0-4} | {yes/no} | {...} | {...} |
| 7 | Error Handling & DoS Resilience | {0-4} | {yes/no} | {...} | {...} |
| 8 | Upgradeability & Governance | {0-4} | {yes/no} | {...} | {...} |
| 9 | Monitoring & Incident Response | {0-4} | {yes/no} | {...} | {...} |
| | **Overall Maturity** | **{X.X} / 4.0** | | | |

<!-- Categories scoring <= 1 warrant priority attention regardless of whether a
     specific finding was written against them. Categories flagged FIR should be
     called out in §1.3 and, where actionable, in Key Takeaways — the client may
     wish to commission a follow-up pass on them. -->

---

## 9. Appendices

### 9.1 Severity Rating Definitions

<!-- Reproduce the §5 tier definitions here as a standalone reference. -->

- **🔴 Critical** — Direct, permissionless fund loss / total compromise; minimal preconditions.
- **🟠 High** — Fund loss under attacker-achievable preconditions.
- **🟡 Medium** — Amplified/conditional impact, or DoS on a critical path.
- **🔵 Low** — Best-practice / defense-in-depth gap; no realistic fund loss.
- **⚪ Informational** — Quality, documentation, or hardening; no direct security impact.

Severity is derived from the **Impact × Likelihood** matrix in §5.2, not asserted.

### 9.2 Status Vocabulary

<!-- Define every status value used in the findings so the client reads them
     consistently. -->

- **Fixed** — Client remediated the issue; the auditor re-reviewed the fix commit
  and independently confirmed the finding is resolved.
- **Partially Fixed** — The remediation addresses part of the issue (or one of
  several locations) but leaves residual risk; the remaining exposure is described
  in the finding's Auditor Verification.
- **Acknowledged** — Client agrees the finding is valid; a fix is planned/tracked
  but is not yet present in the reviewed code.
- **Risk-Accepted** — Client agrees the finding is valid but has chosen not to fix
  it, accepting the risk; their stated rationale is recorded (attributed) in the
  Client Response.
- **Disputed** — Client disagrees that the finding is valid or applicable; both the
  client's position and the auditor's assessment are recorded so the reader can
  judge. (The auditor does not silently drop a disputed finding.)
- **Open** — Not yet triaged by the client (typical in a draft); no client position
  recorded.

### 9.3 Tools & Versions

<!-- The exact toolchain used, for reproducibility. -->

```
auditor-skill:  v6.0
solana-cli:     {version}
anchor-cli:     {version}
rustc / cargo:  {version}
node / npm:     {version}
cargo-audit:    {version or "n/a"}
{other SAST / fuzz / FV tools}: {version or "n/a"}
```

### 9.4 Disclaimer

<!--
Standard professional disclaimer. Point-in-time, scoped, non-exhaustive, code-only.
The shared-responsibility framing: the auditor assesses the code; operational
security (key custody, deployment, monitoring) is the deployer's responsibility.
NO guarantee. Recommend re-audit after material change. Do NOT add any language
that could read as a "safe to deploy" certification. Explicitly restate the
tooling-limitation and assumptions caveats.
-->

This report reflects a **point-in-time** security assessment of the code at the
commit(s) identified in §2. It is **scoped and non-exhaustive**: only the
components listed as in scope were reviewed, and the absence of findings in any
area is not a proof that no issues exist there. Security assessment is a
best-effort activity; **no audit can guarantee** that a codebase is free of
vulnerabilities, and this report does not constitute such a guarantee, nor any
warranty, nor financial, investment, or legal advice.

**Limits of testing and tooling.** The review combined manual analysis with
automated tools, each of which has inherent limits: static analysis produces false
negatives and cannot reason about all cross-instruction or economic properties;
fuzzing and property testing explore only a bounded input space; and a passing test
suite demonstrates correct behavior on the exercised paths only, never the absence
of defects elsewhere. Dynamic verification was performed only where noted in §3.5.

**Assumptions.** The findings, their severities, and the residual-risk conclusions
are **conditioned on the trust assumptions and model simplifications stated in
§4.6** (trusted authorities, oracle behavior, trusted external programs, deployment
configuration). Where any such assumption does not hold in production, the
corresponding conclusions do not hold and the affected surface should be
re-reviewed.

The assessment evaluates **the source code only**. Under a shared-responsibility
model, matters outside the code remain the responsibility of the deploying party,
including but not limited to: private-key custody and operational security, the
integrity of the deployment and upgrade process, the configuration of upgrade
authorities / multisigs / timelocks, run-time monitoring and incident response,
and the behavior of third-party programs and off-chain infrastructure that this
code depends on.

Any material change to the code, dependencies, deployment configuration, trust
model, or economic parameters after the reviewed commit **invalidates the
conclusions herein for the affected surface**; a re-review is recommended before
such changes reach production. This report does **not** certify the code as "safe
to deploy" — readiness is communicated through the code-maturity narrative (§8),
finding resolution status (§1), and the trust-model caveats above, never through a
blessing. The findings and their statuses describe the state of the code as of the
publication date and are provided **as-is**.
