# Audit Lifecycle — What Professional Firms Do

> **Load when:** running a full audit cycle or choosing methodology.
> **Scope:** the publicly-derivable engagement structure of professional Solana / smart-contract
> audit firms — the shared spine, where firms differ, and what none of them promise.
> **How to use:** this is the *external reference model*. It documents how the industry runs an
> audit so the skill's own method (`methodology.md`) can be described as that same lifecycle
> executed by the skill's mechanisms. Everything here is derived from firms' public
> methodology pages, public reports, and public engagement rules — no proprietary process.
>
> *(Credit: public methodology write-ups and published reports from the named firms and public
> contest platforms. Re-expressed in our own words; no third-party text copied.)*

---

## 1. The universal engagement spine (7 phases every firm shares)

Strip the branding off any reputable audit and the same seven phases remain. Firms rename
them and weight them differently, but the sequence is near-universal.

| # | Phase | What happens | Who drives |
|---|-------|--------------|------------|
| 1 | **Kickoff / Scoping** | Pin the exact **commit hash**; count LOC / in-scope files; architecture walkthrough with the team; agree on the trust model, out-of-scope list, timeline; open a **shared channel** (Slack/Telegram) for the engagement | Firm + client |
| 2 | **Manual Review** | **PRIMARY phase — the majority of engagement time.** Line-by-line reading of the in-scope code against the threat model; auditors reconstruct intended behavior, then hunt for the gap between intent and implementation | Firm (senior + junior auditors) |
| 3 | **Automated Tooling** | **Supplementary, not primary.** Static analysis / linters / fuzzing / property tests run *alongside* manual review to widen coverage and catch mechanical classes — they direct attention, they do not replace the human pass. Precedent for running tools **up-front**: Trail of Bits reports open with the toolset run at engagement start (Clippy `-W clippy::pedantic`, `cargo-audit`, `cargo-outdated`) so the mechanical surface is cleared before the deep human read | Firm |
| 4 | **Findings Documentation** | Each issue written up: severity, location (`file:line`), description, impact, a proof-of-concept or reproduction, and a concrete fix recommendation | Firm |
| 5 | **Client Review** | Draft findings shared; the client confirms reachability / disputes severity / supplies missing business context; false positives are reconciled | Firm ↔ client |
| 6 | **Fix Review (re-audit)** | Client patches; the firm re-checks each fix — confirming it resolves the issue **and** did not introduce a regression or leave a sibling instance unpatched | Firm |
| 7 | **Final Report** | Public/private report published with the agreed findings, their fix status, and an engineering-maturity narrative. *(Optional)* **Post-Deploy Monitoring** — ongoing on-chain watch / alerting as a separate service | Firm |

The center of gravity is **Phase 2**. Automated tooling (Phase 3) exists to make the manual
pass more complete, never to substitute for it — a distinction every serious firm states
explicitly. Trail of Bits reports make the *sequence* concrete: they list the tools run at the
start of the engagement (Clippy pedantic, `cargo-audit`, `cargo-outdated`) so the linter/advisory
findings are dispatched before auditors spend their time on the logic the tools cannot see.

---

## 2. Firm differentiators

Same spine, different signature. The column that matters is *what each firm does that the
others don't* — the practices worth borrowing.

| Firm | Signature practice (public) |
|------|-----------------------------|
| **Trail of Bits** | **Explicitly NOT checklist auditors** — reports state that the review reasons about **security properties / invariants** and **attacker goals** first, and treat any checklist as a coverage floor rather than the method; two-axis rating: **severity × difficulty** (how hard the bug is to exploit) rated independently; a **codebase-maturity** evaluation across categories; **weekly progress reports** to the client during the engagement |
| **OtterSec** | **Offensive / CTF-style, bottom-up** review (think like an attacker at the primitive level up); formal verification where it pays; **audit-plus-monitoring** as a combined offering |
| **Neodyme** | **Two independent full audits of the same scope in parallel, then reconcile** — the key QA pattern that catches what one reviewer misses and cross-checks disputed severities; frames itself as **invariant- and attacker-goal-driven, not checklist-driven**; keeps a **nit-picks tier *below* Informational** — delivered to the client directly but **excluded from the formal report** so the report only carries security-relevant findings |
| **Zellic** | **Manual-review-primary**; report **ordered by importance** (business impact), not strictly by raw severity — the reader sees what matters most first |
| **Sec3** | **Manual review assisted by an in-house scanner** (X-Ray) — the human read is primary; the scanner widens mechanical coverage. Their reports do *not* evidence a "SAST first, then aim the humans" workflow, so treat the scanner as an assist, not a shift-left gate |
| **Halborn** | **CVSS-inspired numeric 0–10** severity; an explicit **commit-diff phase**; **fork testing** against realistic chain state |
| **Certora** | **Formal-verification-primary**: write a formal **spec**, then prove-or-**counterexample** each property. Every report carries a **"General Assumptions and Simplifications"** section that states, in plain terms, what the proof abstracted away — loop-unroll bounds, syscall/external-call stubs, and datatype (e.g. hash / big-integer) approximations — so a reader knows the exact envelope the proofs hold within |
| **Ackee** | **Trident** (manually-guided fuzzing) run as a **standard phase**, not an add-on; a distinct **"Warning"** finding tier for issues that are **not exploitable today but are fragile to future change** (a latent trap a later edit could arm) |
| **Zenith** | **Multi-revision delta review** — re-review across successive code revisions, tracking what changed between them |

Reading across the table, five reusable levers emerge: (a) a **two-axis or normalized
severity** so ratings are defensible; (b) **independent duplication** for QA (Neodyme's two full
parallel audits); (c) **tools run up-front to clear the mechanical surface** before the manual
pass (Trail of Bits' Clippy/`cargo-audit`/`cargo-outdated` at engagement start); (d)
**importance-ordered** reporting; and (e) **delta / fix re-review** across revisions.
`methodology.md` maps each of these onto an existing skill mechanism.

Two framing points sit above the levers. First, the strongest firms (ToB, Neodyme) **lead with
invariant reconstruction and attacker-goal reasoning**, and treat checklists as the coverage
*floor*, not the method — the primary work is "what must always hold, and how would an attacker
break it," not ticking a list. Second, findings live on a **finer tier ladder than
Critical→Informational**: Ackee's **Warning** (fragile-to-change, not exploitable now) and
Neodyme's **nit-picks** (below Informational, delivered to the client but kept out of the formal
report) both exist so the report stays signal-dense while nothing observed is silently dropped.

---

## 3. Engagement models

*How* a firm is structured changes how work is parallelized, how duplicate findings are
resolved, how quality is gated, and how often the client is in the loop.

| Model | Examples | Parallelization | Dedup | QA gate | Client cadence |
|-------|----------|-----------------|-------|---------|----------------|
| **Contest / crowdsourced** | Code4rena, Sherlock, Cantina | Massive fan-out — dozens–hundreds of independent wardens hit the same scope at once | **Judge-side**: identical submissions merged post-hoc into one canonical issue | Judges + escalation/appeals rounds; payout tied to validity + severity | Async; sponsor answers questions in a shared channel during the contest window |
| **Boutique / lead-auditor** | Ackee, Zenith, Asymmetric | 1–2 named auditors own the whole scope end-to-end | Trivial — few reviewers, shared context, so overlap is naturally low | The lead auditor's own re-review + firm sign-off | High-touch, direct line to the lead throughout |
| **Big-firm team** | Trail of Bits, OtterSec, Neodyme | A **coordinated team** splits scope by component/domain; specialists take their area | Internal sync / shared tracker; **Neodyme's dual-review** deliberately *keeps* overlap then reconciles | Structured internal review + senior sign-off (ToB weekly reports; Neodyme reconciliation) | Scheduled check-ins + shared channel; progress reporting |
| **Solo elite** | samczsun-style individual | One expert, sequential deep focus | N/A (single reviewer) | Personal reputation is the gate | Direct, informal |

The **contest** and **big-firm** models both rely on *independent duplication* for coverage,
but resolve the resulting duplicates differently: contests dedup at judging, big firms dedup
by internal coordination while Neodyme intentionally preserves two passes and reconciles them.
Boutique and solo models trade breadth of eyes for depth of a single sustained context.

---

## 4. What NO firm does

No reputable firm issues an explicit **"safe to deploy"** guarantee. What they actually
deliver is:

- a list of **findings** with severity, location, PoC, and fix;
- an **engineering-maturity narrative** (how robust the codebase is, category by category);
- **trust-model caveats** (what was assumed about admins, oracles, upgrade authority,
  external programs); and
- **disclaimers** stating the audit's limits.

Reports also state the **engagement envelope** as part of their credibility — the named
reviewers, the **duration / effort** spent, and the exact **commit range** covered. This is not
decoration: it lets a reader weigh the depth of the review against the size of the scope (a
two-day pass over 20k LOC is a different assurance than a three-week one), and it is what makes
"point-in-time / scoped / non-exhaustive" concrete rather than boilerplate.

The deployment decision stays with the **client**. Three properties bound every audit and are
stated plainly in the report:

- **Point-in-time** — the review covers one pinned commit; later changes are uncovered.
- **Scoped** — only the agreed files/contracts were examined; out-of-scope code is not vouched for.
- **Non-exhaustive** — "no findings" ≠ "no bugs"; absence of a reported issue is not proof of
  its absence.

An audit *raises confidence and lowers risk*; it does not certify correctness or transfer
liability. Any language promising otherwise is a red flag, not a feature.

---

## Firm-lifecycle fast pass

- [ ] Scope is pinned to an exact **commit**, with LOC/file count and an agreed out-of-scope list (§1.1)
- [ ] **Manual review is the primary effort**; tooling ran **up-front to clear the mechanical surface** and stays supplementary (§1.2–1.3, ToB precedent)
- [ ] Reasoning **led with invariants + attacker goals**; checklists were the coverage floor, not the method (§2 ToB/Neodyme)
- [ ] Severity is **normalized/defensible** (two-axis or numeric), not ad-hoc; a finer tier exists for **Warning / nit** observations (§2 Ackee/Neodyme)
- [ ] Findings carry location + impact + PoC + fix; the client gets a **review round** (§1.4–1.5)
- [ ] **Independent duplication** or a second pass exists as a QA gate before publish (§2 Neodyme, §3)
- [ ] Report is **importance-ordered** and fixes are **re-reviewed** across revisions (§2 Zellic/Zenith, §1.6)
- [ ] For FV, an **assumptions/simplifications** section states the proof envelope (§2 Certora)
- [ ] The **engagement envelope** (team, duration/effort, commit range) is recorded for credibility (§4)
- [ ] The deliverable is findings + maturity + caveats + disclaimers — **never a deploy guarantee** (§4)
- [ ] Point-in-time / scoped / non-exhaustive limits are stated in the report (§4)
