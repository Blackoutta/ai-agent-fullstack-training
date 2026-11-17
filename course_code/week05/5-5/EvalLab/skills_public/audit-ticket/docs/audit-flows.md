# Audit Flows

Which flow to run, and the pipeline each one follows. Back to the [docs index](README.md).

auditor-skill offers a spectrum from a 5-minute grep triage to a full automated engagement that emits a client-facing report. Pick by how much rigor the moment needs.

## Decision guide

| Situation | Flow | Cost |
|-----------|------|------|
| CI gate on every PR; first look at an unknown repo | [`/auditor:quick-scan`](#cheap-lanes) | lowest |
| Only a PR / commit range changed | [`/auditor:diff-audit`](#cheap-lanes) | scales with the diff |
| One handler / endpoint needs a deep look | [`/auditor:deep-review`](#one-shot-audit) | one unit |
| Whole repo, one pass, you drive triage | [`/auditor:audit`](#one-shot-audit) | full walk |
| Full engagement, no human, deliver a report | [`/auditor:audit-cycle`](#flow-a--auditoraudit-cycle-automated) | highest |
| Full engagement, human resolves judgment calls | [`/auditor:audit-assist`](#flow-b--auditoraudit-assist-interactive) | high, iterative |
| Team fixed the findings; verify the fixes | [`/auditor:re-audit`](#fix-review--re-audit) | delta only |
| A protocol may already have been attacked | [`/auditor:hunt` · `/auditor:respond`](detection-response.md) | scales with ledger rounds |

All three heavyweight flows run the **same lifecycle** over the same corpus. The difference is autonomy: `audit-cycle` runs it to completion, `audit-assist` pauses for you, `re-audit` runs the delta subset.

## The lifecycle (shared spine)

Both `/auditor:audit-cycle` and `/auditor:audit-assist` execute this pipeline. It mirrors a professional firm engagement, run by mechanisms the skill already has ([`references/audit-lifecycle/methodology.md`](../references/audit-lifecycle/methodology.md)).

```
intake / scope     → declare scope (Rule 0), pin the commit, persist audit_<n>/intake.md
   ↓
context (Phase 0.5)→ context-builder reconstructs invariants/assumptions per function (no verdicts)
   ↓
threat model       → threat-modeler emits assets · actor×capability · trust boundaries · AG-n goals (no verdicts); history-seeded by the bundled collector when a trigger fires
   ↓
tool-assisted pass → ToB static-analysis (SARIF) up-front to clear the mechanical surface; else grep
   ↓
domain-partitioned → vuln-hunter (checklists + vectors) ∥ economic-analyst (checklist 06 + value flow)
   review              over DISJOINT surfaces — not N identical clones; each self-triages at the leaf
   ↓
triage             → /triage: de-dup by root cause, re-apply Rule 5b, split findings vs Notes & Nitpicks
   ↓
peer review        → peer-reviewer re-derives top-severity survivors FROM THE CODE (CONFIRM/DISPUTE/DOWNGRADE)
   ↓
synthesis          → audit-reporter dedups, orders by severity/importance, fills the client report
   ↓
deliver            → audit_<n>/REPORT.md (+ optional PDF, + harnesses/, + poc/ & patches/ with --with-poc)
```

Two disciplines run through the whole spine:

- **Design pass before implementation pass.** The economic architecture, oracle-manipulation surface, and state machines are reviewed *first* (a broken incentive on clean code is a finding in its own right), then the line-by-line checklist walk is aimed at the surfaces the design pass flagged.
- **The Rule 5b validation gate at the leaf.** Every finding with severity ≥ 6 must prove reachability + math/state-bounds (+ attacker-model at ≥ 7) before it is emitted, or it is downgraded to `[PARTIAL]` / `[UNCONFIRMED]`. This is the primary defense against AI over-reporting. See [output-and-rigor.md](output-and-rigor.md#the-rule-5b-validation-gate).

Agent roles and model tiers: [agents.md](agents.md).

## One-shot audit

### `/auditor:audit`

Runs the audit end-to-end in the current session: discover → scope-gate → spawn `context-builder`, then `vuln-hunter` for the item-by-item walk, `economic-analyst` for checklist 06 + economic vectors, `audit-reporter` for assembly. Every in-scope item gets a verdict; N≥6 findings pass Rule 5b or downgrade. Emits `audit_<n>/REPORT.md` with the internal template (numeric Repository Risk Score).

```
/auditor:audit ./programs/vault --scope program
```

Use it when you want the full walk but will handle checkpoints and triage yourself, rather than the fully-orchestrated firm flow.

### `/auditor:deep-review`

One instruction / function, deeply. Reads the file, runs Phase 0.5 context reconstruction on the target, fills the instruction worksheet, adversarially models exploitation, reports verdicts for that unit only.

```
/auditor:deep-review programs/vault/src/instructions/withdraw.rs withdraw
```

### `/auditor:spec-audit`

Code-vs-spec. Extracts a requirement list from a spec/whitepaper/RFC, then builds a Compliance Matrix mapping each requirement to `[MET]` / `[VIOLATED-N]` / `[UNIMPLEMENTED]` / `[UNDOCUMENTED-BEHAVIOR]`, cited to code. Code that does something the spec never authorizes is itself a finding.

```
/auditor:spec-audit ./SPEC.md ./programs/vault
```

## Flow A — `/auditor:audit-cycle` (automated)

The fully automated audit team. Runs the whole lifecycle above with **no human in the loop** — where a firm would ask the client, it applies the `QUESTIONS.md` defaults and records each assumption in the report's **Assumptions & Simplifications** section.

```
/auditor:audit-cycle --scope full
/auditor:audit-cycle --scope program --with-poc   # + executable PoCs & patches for confirmed N≥7
```

Delivers the **client-facing** report (`templates/audit-report.md`): executive summary, commit-pinned scope, findings with PoC/reachability, a code-maturity narrative, trust-model caveats, disclaimers — and, like a real firm, **no "safe to deploy" guarantee**. Optional PDF via `<auditor-skill root>/scripts/report-to-pdf.sh` (pandoc-gated; Markdown is always the deliverable). Generated fuzz/FV harnesses ship to `audit_<n>/harnesses/` with a coverage-gaps note; with `--with-poc`, PoCs land in `audit_<n>/poc/` and patches in `audit_<n>/patches/`.

Use it when you want a reproducible, hands-off first-pass audit and a deliverable document.

## Flow B — `/auditor:audit-assist` (interactive)

The same lifecycle, but it **stops at checkpoints** and lets you steer. At each checkpoint it surfaces:

- **(a)** confirmed findings so far (severity-ordered, already through Rule 5b);
- **(b)** the next-focus plan (which surfaces/vectors are queued and why);
- **(c)** targeted questions only a human can answer — business context, the intended trust model, whether a flagged behavior is intentional, severity calls that depend on off-chain assumptions.

Checkpoints land after scope, after context, after each review phase, after triage, and after reconciliation. Your answers fold back in and each trust-model answer is logged as a stated assumption in the report.

```
/auditor:audit-assist --scope full
```

Use it when domain judgment matters — the agent does the mechanical review, you resolve the "is this intended?" calls. After the team changes code, do not re-run this — use `/auditor:re-audit`.

## Fix-review / re-audit

### `/auditor:re-audit`

Takes a prior `audit_<n>/REPORT.md` + the current tree and classifies every prior finding: **FIXED** / **PARTIALLY-FIXED** / **STILL-OPEN** / **REGRESSED** / **ACKNOWLEDGED** / **DISPUTED**. It re-runs Rule 5b on each claimed fix (a cosmetic patch is not FIXED), cites the remediation commit/PR hash, audits the changed surface for NEW findings via the diff-audit path, and runs a **sibling-patch-propagation sweep** — grep the codebase for the same anti-pattern the fix closed, so a fix applied to one call site but not its twins is caught. Emits `audit_<n+1>/RE-AUDIT.md`.

```
/auditor:re-audit audit_1/REPORT.md main..HEAD
```

Verification-verb discipline: a client's "we fixed it" is never silently promoted to FIXED — an unverified client fix is at most PARTIALLY-FIXED-pending-verification. See [commands.md](commands.md#auditorre-audit).

## Cheap lanes

These skip the full item-by-item walk.

### `/auditor:quick-scan`

Discovery + static analysis (ToB `static-analysis` if present, else grep scanners) + only the CRITICAL/HIGH known-vectors for the detected domains. Reports findings with severity + `file:line`, and states plainly it is a triage pass. Good for a first look or a CI gate; points to `/auditor:audit` for full coverage. As a CI gate on a public repository it publishes pass/fail only — no finding counts — in comments, logs and artifacts, and sends details through a private channel, failing the job when none is available and never falling back to printing them (`OUTPUT-RULES.md` Rule 11d).

### `/auditor:diff-audit`

PR / commit-scoped. Computes the changed set (`git diff --name-only base..head`, default `main..HEAD`), runs Phase 0.5 on changed functions + 1-hop callers/callees, risk-classifies changed files (auth / crypto / value-transfer / validation-removal = HIGH), git-blames removed security code (a deletion in a "fix"/"CVE" commit is a CRITICAL regression), runs only the matching checklist items + vectors through Rule 5b, and adds a dependency lane (checklist 11 §11.11 — the published code delta of each bumped package) when a manifest or lockfile changed. Emits `audit_<n>/PR-REPORT.md`.

```
/auditor:diff-audit main..HEAD
/auditor:diff-audit 1234          # a PR number
```

Both lanes reuse the methodology corpus but skip whole-repo discovery, so they are dramatically cheaper than a full audit.
