# Audit Methodology — The Firm Lifecycle, Run by This Skill

> **Load when:** running `/audit-cycle` or `/audit-assist`.
> **Scope:** how auditor-skill executes the professional-firm engagement spine
> (`firm-coverage.md`) using its **existing** mechanisms — no new phases, no renumbering.
> **How to use:** `firm-coverage.md` is the external model; this file is the mapping. Each
> lifecycle phase is performed by a mechanism the skill already has (a `QUESTIONS.md`, an
> `OUTPUT-RULES.md` rule, a `FULL-AUDIT.md` phase, a subagent, a `references/` file, a
> template, or a command). Read it before either flow so the run matches how firms work.
>
> *(Credit: public firm methodologies — see `firm-coverage.md`. Patterns re-implemented natively
> are credited in `ATTRIBUTION.md`.)*

---

## 1. Our method = the firm spine, executed by skill mechanisms

The seven-phase firm spine maps one-to-one onto mechanisms that already exist. Nothing below
introduces a new phase number — Phase 0.5, Phase 4.5, and Rule 5b stay exactly as they are.

| Firm lifecycle phase | Skill mechanism that performs it |
|----------------------|----------------------------------|
| **Scoping / Intake** | `QUESTIONS.md` (project/trust-model/scope intake) + **Rule 0** scope-gating (`OUTPUT-RULES.md`) + **FULL-AUDIT Phase -1 / Phase 0** — the exact **commit is pinned at Phase 0.1** (records program ID, versions, git branch + commit hash) |
| **Context** | **FULL-AUDIT Phase 0.5** context reconstruction, driven by the **`context-builder`** subagent — invariants/assumptions/external-risks per function, every claim cited to `L#`; no verdict may precede it |
| **Tool-assisted pass** | `references/orchestration/boundary-map.md` — when `<auditor-skill root>/vendor/trailofbits/plugins` is present (the installation's absolute path, never the working directory; `OUTPUT-RULES.md` Rule 11e), ToB **`static-analysis`** emits SARIF that **directs manual attention** to the risky surface; **grep fallback** via `discovery/grep-commands.md` when the submodule is absent |
| **Manual review (PRIMARY)** | Checklists **01–20** are the **coverage floor**, not the method — they guarantee nothing gets skipped. The **primary reasoning mode** (per ToB/Neodyme, who frame themselves as *not* checklist auditors) is **invariant reconstruction + attacker-goal reasoning**: `context-builder`'s per-function invariants/assumptions (Phase 0.5) name what must always hold, and **`economic-analyst`** reasons about how an attacker would break the value flow to violate them. The checklists are then walked item-by-item by **`vuln-hunter`** (+ `economic-analyst` for checklist 06 + economic vectors), guided by `references/methodologies/*` (AMM, lending, perps, oracles, stablecoin, liquid-staking, governance), so the invariant-driven hunt is backed by exhaustive floor coverage. **Each finding is self-triaged at the leaf**: it must pass **Rule 5b** and clear `references/false-positives.md` before it counts |
| **Independent reconciliation** | **NEW `peer-reviewer`** subagent — a **bounded-cost adaptation** of Neodyme's two-full-independent-audits pattern. Neodyme runs *two complete* parallel audits and reconciles; we do **not** claim that. We re-derive only the **top-severity survivors** independently from the code (not a full second audit), delegating to vendored ToB **`fp-check`** and **`second-opinion`** when present (`second-opinion` sends the selected code to an external LLM CLI; disclosed per `OUTPUT-RULES.md` Rule 11b). The honest framing: independent re-derivation of the findings that matter most, sized to the budget — not a second full pass |
| **Verification** | The **Rule 5b** gate (Reachability + Math/State-Bounds + Attacker-Model) backed by a real **PoC / harness** — ToB property/fuzz harnesses per `boundary-map.md`, and **Surfpool mainnet-fork** simulation for economic findings (`economic-analyst`) |
| **Synthesis** | **`audit-reporter`** — dedup by **root cause**, classify by **severity**, and order by **importance** (business impact first, per Zellic) |
| **Maturity** | **FULL-AUDIT Phase 4.5** — the 9-category, 0–4 weakest-link code-maturity scorecard |
| **Assumptions & Simplifications** | **Mandatory report output** (Certora's "General Assumptions and Simplifications" precedent). A named section listing what the review took as given and what it abstracted away — populated from `context-builder`'s per-function **assumptions/external-risks** (Phase 0.5) plus any **`/audit-assist` human answers** (which admin is trusted, which oracle is assumed honest, upgrade-authority custody). Makes the review's envelope explicit so "no finding here" is read against the stated assumption, not as a blanket clearance |
| **Harness-as-deliverable** | For **FV / fuzz** engagements, the harness is itself a **named output**, not scaffolding thrown away. ToB property/fuzz harnesses (`boundary-map.md`) are saved to **`audit_<n>/harnesses/`** with a **coverage-gaps appendix** — which properties are asserted, which inputs are exercised, and what is *not* yet covered — so the client can rerun and extend it (Ackee/ToB treat the harness as a reusable artifact) |
| **Reporting** | **`templates/audit-report.md`** (client-facing) — follows firm convention: **maturity narrative + trust-model caveats + disclaimers, NO deploy-guarantee**, plus the **engagement envelope** (named agents/effort, pinned commit range) and an explicit **out-of-scope list** and **LOC-vs-budget** note so depth is weighed honestly against scope. The internal **`templates/report-template.md`** keeps the numeric **Repository Risk Score** for the team's own gating |
| **Fix-review / re-audit** | **NEW `/re-audit`** — re-checks each prior finding as **FIXED / STILL-OPEN / REGRESSED**, plus a **sibling-patch-propagation sweep** (did the fix leave an unpatched twin elsewhere?). This is the Halborn commit-diff / Zenith delta pattern |

**Two reports, two audiences (do not conflate).** `audit-report.md` is what a client receives —
it mirrors what firms actually deliver (findings + maturity + caveats, deployment left to the
client, per `firm-coverage.md` §4). `report-template.md` is the internal artifact and *retains*
the Repository Risk Score (`OUTPUT-RULES.md` Rule 1) as the team's deploy-gate. The client-facing
document never presents a risk score as a "safe to deploy" verdict.

---

## 2. Flow A — fully-automated agent team

`/audit-cycle`. The team runs the whole spine end-to-end and emits the audit document with no
human in the loop.

**Shape of the run:**

1. **Intake + scope** — `QUESTIONS.md` answers feed Rule 0 scope-gating; Phase -1/0 pins the
   commit and declares the in-scope checklist set.
2. **Context** — `context-builder` reconstructs every non-trivial function (Phase 0.5). No
   verdict is allowed before this exists for the target function.
3. **Tool-assisted, invariant-led fan-out** — the fan-out is **domain-partitioned, NOT N
   identical clones**. `vuln-hunter` instances take partitioned checklist/domain slices
   (account-validation, arithmetic, CPI/PDA, state-machine…) and `economic-analyst` takes
   value-flow / checklist 06; ToB `static-analysis` SARIF (or grep) runs up-front to clear the
   mechanical surface and point each reviewer at its risky lines. **The checklists are the
   coverage floor; the driving question is the invariant** — "what must always hold here, and how
   would an attacker break it" — using `context-builder`'s per-function invariants. **Each agent
   self-triages at the leaf** — a candidate finding only survives if it passes **Rule 5b** and
   is not a `false-positives.md` entry.
4. **Reconciliation** — `peer-reviewer` independently re-reviews the **top-severity survivors**
   (delegating to ToB `fp-check`, and to `second-opinion` — an external LLM CLI, disclosed per Rule 11b — when present) and reconciles disputes —
   the Neodyme dual-review step, cost-scoped to the findings that matter.
5. **Report** — `audit-reporter` dedups by root cause, orders by importance, fills Phase 4.5
   maturity, writes the **Assumptions & Simplifications** section (from `context-builder`
   assumptions), records the **engagement envelope + out-of-scope + LOC-vs-budget**, and — when
   FV/fuzz harnesses were generated — saves them to **`audit_<n>/harnesses/`** with a
   coverage-gaps note. Output → **Markdown**, with **optional PDF** export.

**Firm precedent:** tools up-front to clear the mechanical surface (**Trail of Bits**
Clippy/`cargo-audit`), independent re-derivation of top findings (**Neodyme** two-full-audit
pattern, cost-scoped here), importance-ordered synthesis (**Zellic**), an explicit assumptions
section (**Certora**).

---

## 3. Flow B — AI-assisted iterative

`/audit-assist`. The same spine, but the human is a checkpoint after **each phase** — the tool
proposes, the human steers, and the two converge on the audit document.

**Shape of the run:**

1. Run one phase (scope → context → tool pass → manual review → reconciliation → synthesis).
2. **Checkpoint** — surface, for that phase: the **confirmed findings** (each already through
   the Rule 5b gate), the **next focus area**, and **open questions on business logic / trust
   model** (which admin is trusted? is this oracle assumed honest? what is the upgrade-authority
   custody?) — the context on-chain code cannot answer by itself.
3. **Human steers** — confirms/deprioritizes findings, answers the trust-model questions,
   redirects scope. Their answers refine severity (per `QUESTIONS.md` → severity calibration)
   and prune false positives before the next phase — **and each trust-model answer is logged as
   an entry in the report's Assumptions & Simplifications section** (Certora precedent), so a
   human-supplied "this admin is trusted" becomes a stated assumption, not an invisible one.
4. **Converge** — iterate until the audit document is complete.
5. **Delta re-review** — subsequent changes go through **`/re-audit`** (FIXED / STILL-OPEN /
   REGRESSED + sibling-propagation sweep), not a full re-run.

**Firm precedent:** periodic client-facing progress updates (**Trail of Bits** weekly reports),
delta/fix re-review across revisions (**Zenith** multi-revision, **Halborn** commit-diff).

---

## 4. What both flows guarantee (and what they don't)

Both flows are the **firm spine**, so both inherit its discipline and its limits:

- **Manual review stays primary** — tooling directs attention (Phase: tool-assisted), it never
  replaces the item-by-item walk. Delegation *augments*, never replaces, a native verdict
  (`boundary-map.md` §Rule).
- **Every finding is verified** — Rule 5b + `false-positives.md` at the leaf; unproven
  high-severity claims are downgraded to `[PARTIAL]` / `[UNCONFIRMED]`, never shipped bare.
- **The deliverable matches firm output** — findings + maturity narrative + trust-model caveats
  + disclaimers, plus a mandatory **Assumptions & Simplifications** section (Certora precedent),
  the **engagement envelope** (agents/effort, pinned commit range), an explicit **out-of-scope
  list**, and an honest **LOC-vs-budget** note. The client-facing `audit-report.md` issues **no
  "safe to deploy" guarantee**; the deployment decision is the client's (`firm-coverage.md` §4).
- **FV/fuzz harnesses ship as named deliverables** — saved to `audit_<n>/harnesses/` with a
  coverage-gaps appendix, not discarded scaffolding.
- **The audit is point-in-time, scoped, and non-exhaustive** — it is a thorough first pass,
  pairable with (not a replacement for) a human firm engagement, exactly as `SKILL.md` →
  *When NOT to Use* states.

---

## 5. Design-level pass BEFORE the line-by-line pass

The item-by-item checklist walk (`vuln-hunter` over checklists 01–20) is an **implementation-level**
pass — it finds reentrancy, ownership, arithmetic, and constraint bugs. It is *not* the first pass.
Before any line-by-line reading, run a named **design-level pass** that reasons about the protocol as
an economic machine, because the highest-severity findings are usually architectural (a broken
incentive, a manipulable oracle path, an unsound state machine) and are invisible to a per-line walk.

**Order of the two passes:**

1. **Design pass (first).** Owned by `economic-analyst` + `context-builder`, using
   `references/methodologies/*` and the invariant menus in `references/invariant-catalog.md`. Review,
   in this order:
   - **Economic architecture / incentives** — where does value enter and leave, who is paid to do
     what, and what does a rational attacker maximize? (checklist 06 + ECON vectors, but as *design
     reasoning*, not line items yet.)
   - **Oracle & price-manipulation surface** — every price input, its manipulation cost, and whether
     a flash-loan-sized move breaks an invariant (`references/methodologies/oracles.md`).
   - **State machines** — enumerate valid transitions per instruction; look for a transition that
     skips a guard, an unreachable-but-assumed state, or a state that lets value out early.
   The output is the **per-function invariant set** (Phase 0.5) plus a ranked list of design-level
   risks — this *directs* where the implementation pass spends its budget.
2. **Implementation pass (second).** The checklist walk (`vuln-hunter`) — reentrancy / `.reload()`,
   ownership & signer, arithmetic & rounding, PDA/CPI, account validation — now aimed at the surfaces
   the design pass flagged as load-bearing.

**Rule:** a `[FAIL-N≥6]` on implementation grounds is not the ceiling — if the design pass surfaces a
sound-implementation-but-broken-incentive risk (correct code, exploitable mechanism), that is a
finding in its own right and outranks most line-level bugs. Never let a clean checklist pass stand in
for a design review that was skipped.

---

## 6. Tiered FV / harness escalation ladder

Formal methods are a **cost-vs-assurance ladder**, not a binary. Climb only as high as the
value-at-risk and the shape of the property justify. Each rung is chosen by three criteria:
**value-at-risk** (how catastrophic is one counterexample), **logic self-containedness** (is the
property decided by this program's own math, or by foreign code), and **invariant crispness** (can
the property be stated as a clean declarative assertion).

| Rung | Technique | Choose when | Assurance |
|------|-----------|-------------|-----------|
| **0. Manual** | Invariant reconstruction + attacker-goal reasoning (§4, §5) | Always — the floor under every engagement | Reasoned, unproven |
| **1. proptest on pure fns** | Property-based testing of extracted pure functions (curve math, fee math, health math, `vested_amount`, rounding) | The logic is a self-contained pure function and the property is crisp; cheap first probe | Broad, no proof |
| **2. Trident stateful sequences (PRIMARY bug-finder)** | Coverage-guided **multi-instruction stateful** fuzzing over the real SVM — random instruction sequences with invariant post-conditions | The bug lives in **cross-instruction state** (the common case): ordering, accumulation, stale-state, multi-user interleaving. **This is the default primary harness** — most real Solana logic bugs are stateful and only appear across instruction sequences | Deep over time, no proof |
| **3. Certora / Kani** | Deductive FV (Certora SCP, SBF-level) or bounded model checking (Kani, MIR) | Reserve for the **3–10 invariants where a single counterexample equals a catastrophe** — supply conservation, no-unauthorized-mint, a core curve/health invariant | Sound (relative to spec / up to bound) |
| **4. MIRAI / Clippy** | Abstract interpretation + lints — taint, some UB, mechanical footguns | Cross-cutting mechanical sweep; up-front to clear the trivial surface and again as a backstop | Advisory, false-positive-prone |

**Decision rule:** *fuzz everything (rungs 1–2); formally prove (rung 3) only the handful of invariants
whose violation is a catastrophe.* Rung 2 (Trident stateful) is the **primary** practical bug-finder
and should be the default harness for any non-trivial program — do not jump straight to rung 3 for a
property that a stateful fuzzer would surface in minutes.

**Explicit skip rule — skip FV if the target is dominated by untrusted CPI.** Deductive/BMC proof
(rung 3) proves behavior of code you *have*. When the instruction's outcome is decided mainly by a
**cross-program invocation into untrusted/foreign code** (an aggregator swap, an arbitrary callee, an
external program whose post-state you cannot model), FV cannot conclude anything useful — the callee
is a hole in the proof. In that case **do not spend the FV budget**: fall back to Trident sequences
that mock the CPI boundary adversarially, plus manual CPI-trust review (`references/framework-idioms/anchor.md`
per-CPI checklist). Reserve rung 3 for the self-contained math, not the CPI-dominated glue.

---

## 7. Standard harness deliverable shape

When an engagement produces an FV/fuzz harness, the harness is a **named deliverable**, not thrown-away
scaffolding (§1, Harness-as-deliverable row). Its standard shape has two parts, both saved to
`audit_<n>/harnesses/`:

1. **Multi-instruction stateful attack-sequence fuzzing.** A Trident (or equivalent) harness that
   drives *sequences* of instructions with adversarial inputs and asserts the kept invariants
   (`references/invariant-catalog.md`) as post-conditions after each step — the rung-2 primary
   bug-finder, preserved so the client can rerun and extend it.
2. **An invariant-property table (report appendix).** A table making the coverage envelope explicit,
   one row per invariant the harness targets:

   | Property (invariant) | Asserted? | Inputs exercised | Not yet covered |
   |----------------------|-----------|------------------|-----------------|
   | e.g. Σ balances == supply | yes | mint/burn/transfer sequences, ≤N holders | Token-2022 fee mints |
   | e.g. k non-decreasing | yes | both-direction swaps, full size range | multi-hop CPI path |
   | e.g. health ≥ 1 for solvent | partial | single-obligation ops | cross-obligation, mid-CPI |

   The **"Not yet covered"** column is mandatory and honest — it is what turns the harness from a
   green checkmark into a usable statement of what was *and was not* verified, and it feeds the report's
   **Assumptions & Simplifications** section. An asserted-but-shallow property is marked `partial`, not
   `yes`.

---

## Methodology fast pass

- [ ] Commit pinned + scope declared (`QUESTIONS.md` + Rule 0 + Phase 0.1) before any reading (§1)
- [ ] Context reconstructed (`context-builder`, Phase 0.5) before any `[FAIL-N≥6]` (§1)
- [ ] Tooling ran **up-front to clear the mechanical surface**; manual walk stayed primary and **invariant-led** (§1, §2, §4)
- [ ] Checklists treated as the **coverage floor**; reasoning led with **invariants + attacker goals** (§1)
- [ ] Fan-out was **domain-partitioned**, not identical clones; each leaf self-triaged via Rule 5b (§2)
- [ ] Top-severity survivors passed **`peer-reviewer`** re-derivation (bounded-cost Neodyme pattern, not a full second audit) (§1, §2)
- [ ] Report dedup'd by root cause, **importance-ordered**, with Phase 4.5 maturity (§1)
- [ ] **Assumptions & Simplifications** section written (context-builder assumptions + `/audit-assist` answers) (§1, §3)
- [ ] **Engagement envelope + out-of-scope + LOC-vs-budget** recorded in the report (§1, §4)
- [ ] FV/fuzz **harnesses saved to `audit_<n>/harnesses/`** with a coverage-gaps note (§1, §4)
- [ ] Client-facing `audit-report.md` used (maturity + caveats, **no deploy guarantee**); risk-score stayed internal (§1)
- [ ] Changes re-reviewed via **`/re-audit`** (FIXED/STILL-OPEN/REGRESSED + sibling sweep), not a full re-run (§1, §3)
- [ ] **Design pass ran FIRST** (economic architecture / oracle-manipulation / state machines) before the line-by-line implementation walk; a broken-incentive-but-clean-code risk was treated as a finding (§5)
- [ ] FV/harness effort chose the right **ladder rung** (manual → proptest → **Trident stateful (primary)** → Certora/Kani for the 3–10 catastrophic invariants → MIRAI/Clippy), by value-at-risk / self-containedness / invariant crispness (§6)
- [ ] **FV skipped where the target is CPI-dominated** (untrusted foreign callee) — fell back to mocked-boundary Trident + manual CPI-trust review instead of burning the FV budget (§6)
- [ ] Harness shipped in the standard shape — **multi-instruction stateful attack-sequence fuzzing** + an **invariant-property table** appendix (property → asserted? → inputs exercised → not-yet-covered) (§7)
