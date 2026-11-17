<!--
================================================================================
PRE-REVIEW THREAT MODEL ARTIFACT
================================================================================
Written by /threat-model to audit_<n>/threat-model.md. Built BEFORE the manual
review (analogous to how context-worksheet.md is built in Phase 0.5). In the auto
flow the `threat-modeler` agent fills it from code + context worksheets; in the
human-in-loop flow the human answers.

NOT a findings document. No verdicts, no severities. Attacker-goal enumeration
only. Every claim cites file:line.

FEEDS THE REPORT (column headers line up with these sections):
  - §1 Asset Inventory       -> report §4.2 (Account/PDA Model) + names the crown jewels
  - §2 Actor x Capability    -> report §4.4 (Trust Model & Actors) — the "must NOT" column
                                is the security property each finding is tested against
  - §3 Trust Boundaries      -> report §4.6 (Assumptions) + §4.7 (Transitive CPI risk)
  - §4 Attacker Goals        -> the goals vuln-hunter / economic-analyst try to achieve;
                                maps to checklists + known-vectors
  - §5 Notes & Unknowns      -> owner-stated, unverified claims feed report §4.6
  - §6 Provenance & Inputs   -> what the model was built from; an inherited codebase
                                (fork / vendored) feeds report §4.7

Consumes: audit_<n>/intake.md §6 (trust-model inputs) and
audit_<n>/worksheets/context/* (invariants, assumptions, external-interaction risks).
Bootstrap mode also consumes audit_<n>/bootstrap/ (git history, fork parent, prior
audits, post-mortems, incidents) — see references/audit-lifecycle/threat-model-bootstrap.md.
================================================================================
-->

# Threat Model — {protocol / client name}

| | |
| ------------------- | ------------------------------------------------- |
| **Audit #**         | audit_{n}                                         |
| **Commit**          | `{full 40-char SHA}`                              |
| **Built by**        | {threat-modeler agent / human-in-loop}            |
| **Mode**            | {auto / interactive / bootstrap / bootstrap → interview} |
| **Source**          | code + `worksheets/context/*` + `intake.md` §6 {+ `bootstrap/` — see §6} |

---

## 1. Asset Inventory (Crown Jewels)

<!--
What is worth stealing / corrupting / bricking, and WHERE it lives. Three asset
classes: funds (lamports/tokens), authority (keys/roles that can move funds or
change rules), and data (state relied on for accounting/pricing). Each row cites
the account/PDA and the file:line where it is defined/held. Feeds report §4.2 and
identifies the targets §4 attacker goals aim at.
-->

| Asset | Class | Where it lives (account / PDA) | Defined / held @ | Worst-case if compromised |
| ----- | ----- | ------------------------------ | ---------------- | ------------------------- |
| {Vault balance} | Funds | {`vault_token_account`, PDA `["vault", authority]`} | {`state.rs#L120`} | {total TVL drained} |
| {Upgrade authority} | Authority | {program upgrade authority} | {deploy config / `Anchor.toml`} | {arbitrary code, full compromise} |
| {Admin role} | Authority | {`config.admin`} | {`state.rs#L44`} | {params/pause abused} |
| {Oracle price} | Data | {`price_feed` account} | {`deposit.rs#L61`} | {mispriced mint/redeem} |
| {Share supply} | Data | {`shares_mint.supply`} | {`state.rs#L88`} | {accounting broken, dilution} |
| {…} | {…} | {…} | {…} | {…} |

---

## 2. Actor × Capability Table

<!--
Every actor, what they CAN do, and — critically — what they must NOT be able to do.
The "Must NOT be able to" column is the security property; each entry is a goal
§4 hands to vuln-hunter / economic-analyst to try to violate. Column headers align
with report §4.4 (Actor | Privileges | Trust Assumption): here "Can do" = Privileges,
"Trust boundary / assumption" = Trust Assumption, and "Must NOT be able to" is the
testable negative that §4.4 implies. Cite the instruction(s) each capability maps to.
Seed the actor list from intake.md §6.
-->

| Actor | Trust level | Can do (privileges) → instruction @ | Must NOT be able to | Trust assumption |
| ----- | ----------- | ----------------------------------- | ------------------- | ---------------- |
| **Permissionless user** | Untrusted | {call `deposit` @ `deposit.rs#L20`} | {move another user's funds; mint shares without deposit} | none — the attacker |
| **LP / depositor** | Untrusted | {`deposit`, `withdraw` own @ …} | {withdraw more than deposited; withdraw others'} | none |
| **Keeper / crank** | Semi-trusted | {`update_index` @ `crank.rs#L15`} | {reorder/withhold to grief; feed stale index} | assumed live & honest-ordering |
| **Admin / manager** | Trusted | {`set_fee`, `pause` @ `admin.rs#L…`} | {drain vault; change others' balances directly} | assumed honest & key-secure |
| **Upgrade authority** | Trusted | {upgrade program} | {— (out of threat model; see §3)} | assumed honest, key-secure, ideally multisig+timelock |
| **Oracle** | Trusted-external | {supply price → read @ `deposit.rs#L61`} | {report price outside enforced confidence/staleness bounds} | assumed accurate & live within bounds |
| **CPI callee** | {trusted (hardcoded) / untrusted (caller-supplied)} | {receives invoke @ …} | {re-enter before guarded state is written} | {validated target / adversarial} |

> A capability an actor holds that overlaps its "Must NOT" column is a candidate
> finding. A "Must NOT" that no guard enforces is where §4 attacker goals aim.

---

## 3. Trust-Boundary Map

<!--
Every point where control or data crosses from a lower-trust zone into a
higher-trust one: CPIs (does the callee cross out to untrusted code?), accounts
(is a caller-supplied account trusted without validation?), and inputs
(instruction args / remaining_accounts / sysvars used without checks). Each row
cites file:line and names what crosses. Feeds report §4.6 (what is trusted) and
§4.7 (transitive/indirect CPI risk). Pull the external-interaction risks from the
context worksheets.
-->

| # | Boundary crossing | Kind | @ file:line | What crosses | Validated? |
| - | ----------------- | ---- | ----------- | ------------ | ---------- |
| TB-1 | {program → SPL Token `transfer_checked`} | CPI | {`withdraw.rs#L88`} | {PDA-signed authority} | {target hardcoded ✓} |
| TB-2 | {caller-supplied `destination` account} | Account | {`withdraw.rs#L34`} | {where funds land} | {owner/mint check? cite or ✗} |
| TB-3 | {`amount` arg → subtraction} | Input | {`withdraw.rs#L52`} | {value bound} | {range-checked? cite or ✗} |
| TB-4 | {`remaining_accounts[]`} | Input | {`batch.rs#L20`} | {arbitrary account set} | {count/type check? cite or ✗} |
| TB-5 | {CPI to caller-supplied program} | CPI | {`route.rs#L40`} | {control flow → untrusted code} | {program-id validated? cite or ✗} |
| {…} | {…} | {…} | {…} | {…} | {…} |

<!-- An unvalidated crossing (✗) is not itself a finding — it is where the manual
     review must prove reachability + impact. It seeds a §4 attacker goal. -->

---

## 4. Attacker Goals to Test

<!--
The concrete objectives the manual reviewers try to ACHIEVE against the code —
derived from the "Must NOT be able to" cells (§2) and the unvalidated crossings
(§3). Each goal maps to the checklist items / known-vectors that hunt it, so
vuln-hunter and economic-analyst pick up exactly what to falsify. These are
targets, NOT findings — a goal that turns out achievable becomes a finding through
the normal Rule 5b gate downstream.

ID: AG-n, stable across re-runs and --seed merges (never renumbered).
Evidence: what history backs the goal (target@<sha> / parent@<sha>, report finding
ids, advisory ids, INC- ids, post-mortem URLs). Empty for a code-only goal. Evidence
raises a goal's place in the review order; it is never a verdict or a severity.
Evidence-backed goals come first. Keep at least one code-only goal.
-->

| ID | Goal (attacker wants to…) | Target asset (§1) | Enabled by (§2 must-not / §3 crossing) | Maps to | Evidence |
| -- | ------------------------- | ----------------- | -------------------------------------- | ------- | -------- |
| AG-1 | {Drain a vault through a re-targeted `has_one`} | {Vault balance} | {TB-2; withdraw "must NOT pay a non-owner"} | {checklist 01, KV-004} | {target@1a2b3c4 (REMOVED `has_one = authority`), prior report F-3} |
| AG-2 | {Drain a vault without owning it} | {Vault balance} | {TB-2 unvalidated destination; user "must NOT move others' funds"} | {checklist 01 (account validation), KV access-control} | |
| AG-3 | {Mint shares without depositing} | {Share supply} | {deposit "must NOT credit without transfer"} | {checklist 06 (economic), KV first-depositor} | |
| AG-4 | {Reorder crank to extract value} | {Oracle/index data} | {keeper ordering; TB-1} | {checklist 06, KV oracle/MEV} | |
| AG-5 | {Escalate to admin via reinit} | {Admin role} | {`init_if_needed` overwrites authority} | {checklist 01, KV-014 reinit} | |
| AG-6 | {Brick a critical path (DoS)} | {Withdrawal availability} | {TB-3/TB-4 unbounded input} | {checklist 03/07, KV DoS} | |
| AG-7 | {Re-enter before state write} | {Vault balance} | {TB-5 untrusted CPI callee} | {KV-003 reentrancy (untrusted callee)} | |
| {…} | {…} | {…} | {…} | {…} | {…} |

**Leads** — code elsewhere with the same shape as an evidenced bug. Where to look, not evidence.

- {AG-1: `withdraw_v2.rs#L41` — same account struct, same constraint}

---

## 5. Notes & Unknowns

<!-- Anything the model could not resolve from the code (banned words apply: no
     "probably"/"might"/"seems"). Write UNKNOWN — needs manual review, cited.
     A claim only the team made (interview) and the code does not confirm goes here,
     and from here to report §4.6. -->

- {UNKNOWN — {what} @ {file:line} — needs manual review}
- {owner-stated, unverified — {claim} — affects {§2 cell / AG-n} — verify by {check}}
- {UNMAPPED — {evidence ref} — no matching surface at this commit}
- {retired seed row {id} — {reason}}

---

## 6. Provenance & Inputs

<!--
What this model was built from. A code-only run lists the code and the context
inputs. A bootstrap run also lists every input from audit_<n>/bootstrap/inputs.tsv
and history.md — including inputs that could not be read, with the reason.
Kind: code / history / parent / prior-audit / post-mortem / advisory / list /
incident / design-doc / seed / owner.
-->

| Input | Kind | Reference (path or URL @ commit, sha256) | Read via | Status |
| ----- | ---- | ---------------------------------------- | -------- | ------ |
| {In-scope code} | code | `{repo} @ {40-char SHA}` | {Read / Grep} | {used} |
| {Git history} | history | `bootstrap/history.md` (pin `{SHA}`) | {collector} | {used / shallow — incomplete} |
| {Fork parent} | parent | `{https URL or path} @ {SHA}`, fork point `{SHA}` | {collector} | {used / detected, not cloned / none} |
| {Prior audit} | prior-audit | `{file} sha256:{…}` | {pdftotext / Read / Markdown} | {used / unreadable — {why}} |
| {…} | {…} | {…} | {…} | {…} |
