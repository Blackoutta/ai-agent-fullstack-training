# Agent Roster

The 9 subagents in `agents/`, their model tiers, when they fire, and how they chain. Back to the [docs index](README.md).

auditor-skill audits with a small team of subagents (spawned via the `Task` tool) plus, when present, the vendored Trail of Bits execution tooling. Orchestration overview: [`AGENTS.md`](../AGENTS.md).

## Roster

| Agent | Model | Fires | Emits |
|-------|-------|-------|-------|
| [context-builder](#context-builder) | sonnet | first, in every full audit | context worksheets (no verdicts) |
| [threat-modeler](#threat-modeler) | opus | after context | `threat-model.md` (no verdicts) |
| [vuln-hunter](#vuln-hunter) | opus | the main review pass | item-by-item verdicts + findings |
| [economic-analyst](#economic-analyst) | opus | in parallel with vuln-hunter | checklist 06 + quantified economic findings |
| [peer-reviewer](#peer-reviewer) | opus | after triage, top-severity only | CONFIRM / DISPUTE / DOWNGRADE |
| [audit-reporter](#audit-reporter) | sonnet | synthesis | the assembled report |
| [poc-engineer](#poc-engineer) | opus | on demand / `--with-poc` | executable PoC crate + `[PoC-*]` tier |
| [patch-engineer](#patch-engineer) | opus | on demand / `--with-poc` | fix diff + `[FIX-*]` tier |
| [incident-responder](#incident-responder) | opus | `/auditor:hunt`, `/auditor:respond` (all reading and analysis of the incident corpus) | hypothesis ledger, INCIDENTS.json, incident report or a proposed response plan for people to carry out |

Model tiers are deliberate: **opus** for the reasoning-heavy work (finding vulnerabilities, re-deriving, quantifying, building exploits), **sonnet** for the understanding and assembly work (context reconstruction, deterministic report assembly) — which keeps those cheap.

## How they chain in `/auditor:audit-cycle`

```
context-builder (sonnet)   Phase 0.5 — instruction matrix, state model, per-fn worksheets
        │                  → audit_<n>/worksheets/context/*  (reused by every later phase)
        ▼
threat-modeler (opus)      assets · actor×capability · trust boundaries · attacker goals
        │                  → audit_<n>/threat-model.md
        ▼
vuln-hunter (opus)  ∥  economic-analyst (opus)     domain-partitioned, DISJOINT surfaces
        │                  each self-triages every candidate through Rule 5b at the leaf
        ▼
   /triage           de-dup by root cause, batch Rule 5b, split findings vs Notes & Nitpicks
        ▼
peer-reviewer (opus)       re-derives top-severity survivors FROM THE CODE
        │                  N≥8 + contested N≥7 → CONFIRM / DISPUTE / DOWNGRADE
        ▼
audit-reporter (sonnet)    dedup by root cause, order by severity/importance → the report
        │
        └── (opt --with-poc) poc-engineer → patch-engineer  on confirmed N≥7
```

The fan-out is **domain-partitioned, not N identical clones** — naive N-way fan-out of the same prompt produces ~87% false positives, so each reviewer owns a distinct surface.

## The agents

### context-builder
**Role:** reconstruct what the code *is supposed to do* and *what it actually does*, before any bug is judged — Phase 0 setup + Phase 0.5 context reconstruction. No checklist verdicts.
**Produces:** for every non-trivial function, `templates/context-worksheet.md` — purpose (from code, not docs), signature, block-by-block walkthrough, **≥3 invariants**, **≥5 assumptions**, **≥3 external-interaction risks**, each cited to `L#`; plus the instruction matrix and state model.
**Discipline:** every claim cites `L#`; the words "probably/might/seems/should" are banned → `UNKNOWN — needs manual review`. Models black-box externals as adversarial.
**Downstream:** its worksheets are the shared substrate — `threat-modeler`, `vuln-hunter`, `economic-analyst`, `peer-reviewer`, `poc-engineer`, and `patch-engineer` all reuse them instead of re-reconstructing architecture. No verdict may precede context for the target function.

### threat-modeler
**Role:** enumerate what an attacker would *want* and *where they could push*, before any bug is judged. No severities, no verdicts.
**Produces:** `audit_<n>/threat-model.md` — asset inventory, actor × capability table (the "must NOT" column is the security property later phases test), trust-boundary map (each crossing marked validated or `✗`), and **attacker goals to test** mapped to checklists/vectors.
**Inputs:** the code, the context worksheets, `intake.md` §6 (the trust-model actor list), `audit-mem warm` if built, and in bootstrap mode the collector's `audit_<n>/bootstrap/` output (git history, fork-parent hints, prior audits, post-mortems, allowlisted incident fields). It stays `Read, Grep, Glob`: the bundled `<auditor-skill root>/scripts/threat-model/collect.sh` runs the git.
**Downstream:** seeds report §4.4/§4.6/§4.7 and hands the reviewers concrete goals to falsify. A goal that turns out reachable becomes a finding downstream — through the Rule 5b gate, not here.

### vuln-hunter
**Role:** the core audit worker — walk in-scope files item-by-item against the gated checklists + phase-triggered known-vectors, recording an explicit verdict for every item.
**Produces:** `[PASS]` (cite the proving file) / `[FAIL-N]` (severity + `file:line` + impact + fix) / `[PARTIAL]` / `[N/A]` (reason).
**Gates:** may only mark `[FAIL-N≥6]` against a function `context-builder` has reconstructed; any N≥6 finding must carry a filled **Reachability + Math/State-Bounds** block (Attacker-Model for N≥7) or be downgraded — never a bare high-severity claim.
**Tooling:** delegates SAST / harness / coverage to Trail of Bits when present ([boundary-map](../references/orchestration/boundary-map.md)), else uses grep scanners and notes the gap.

### economic-analyst
**Role:** value-flow safety and economic-attack quantification — owns checklist 06 (incl. §6.10 staking/reward accounting) + the economic known-vectors (first-depositor, donation, MEV, oracle, rounding).
**Produces:** economic findings with the **quantified Attacker-Model** block filled — attack cost vs extractable value, flash-loanable ceilings, atomicity.
**Tooling:** drives `/auditor:economic-sim` (Surfpool mainnet-fork) to reproduce deposit→manipulate→withdraw against forked state for a real net P/L — the PoC Rule 5b requires for High/Critical economic findings. The fork's RPC datasource receives the addresses it reads, so the report names that provider's domain ([Rule 11b](../OUTPUT-RULES.md#11b--outside-service-disclosure)). Runs the **design pass** (economic architecture, incentives) alongside `context-builder` before the line-by-line walk.

### peer-reviewer
**Role:** the independent second pass (Neodyme dual-review, bounded to control cost). Keeps the primary reviewers honest on the findings that gate a deploy.
**The one rule:** **re-derive each finding from the code** — start from the cited `file:line`, read the code and its call chain, form an independent verdict *before* comparing to the primary's. Reading the primary's conclusion and checking it "sounds right" is rubber-stamping and defeats the purpose.
**Scope:** top-severity survivors only — every confirmed **N≥8**, plus any contested **N≥7** the primary could not PoC. Not the whole checklist.
**Produces:** per-finding **CONFIRM** (cite the traced path) / **DISPUTE** (forces the finding back through Rule 5b or to `[UNCONFIRMED]`) / **DOWNGRADE** (corrected severity + why). Delegates to ToB `fp-check` (local) and `second-opinion` when present — `second-opinion` sends the selected code to an external LLM CLI (OpenAI Codex or Google Antigravity / Gemini), which the report discloses ([Rule 11b](../OUTPUT-RULES.md#rule-11-operating-safety)); tool output is evidence, never the verdict. Disagreement forces re-examination before anything ships.

### audit-reporter
**Role:** deterministic report assembly — no code re-analysis, which keeps report generation cheap.
**Produces:** the executive summary (plain-language safe-to-deploy verdict for the internal template), the **Scope Coverage** table (per checklist/vector group: items evaluated/total, or out-of-scope reason), the Phase 4.5 maturity scorecard (9 categories, 0-4), and the remediation roadmap (CRITICAL→INFO), assembled per `templates/report-template.md`. Flags any in-scope item without a verdict as `[INCOMPLETE — in-scope item without verdict]`.
It assembles; it does not re-judge — de-dup and severity classification only.

### poc-engineer
**Role:** turn a *confirmed* finding into an executable exploit — the runnable Rule 5b PoC. Never invents a finding; demonstrates one that already cleared the gate.
**Produces:** the **smallest self-contained crate** from `<auditor-skill root>/templates/poc/`, with a feature-gated `vulnerable` arm the exploit **succeeds** against and a `fixed` arm it is **rejected** against (`assert_exploit_effect!` / `assert_exploit_rejected_with!`; `assert_exploit_blocked!` to check a deployed hotfix), plus `run.sh`. Emits exactly one `[PoC-*]` tier.
**Hard rule:** the test must **assert** the vulnerability, not merely run. On any blocker → `[PoC-ATTEMPTED]` + the prose PoC is kept; **never fabricate a passing test**. Delegates PoC-construction discipline to ToB `fp-check` when present. Full detail: [poc-and-patches.md](poc-and-patches.md).
**Rule 11:** every PoC build runs in the run's execution mode: without `AUDITOR_EXEC_MODE=isolated|native`, `run.sh` exits 3 and the tier is `[PoC-ATTEMPTED]`. `run.sh` always builds from a scratch copy outside the target tree, a second layer under the mode, not an exemption from it ([11a](../OUTPUT-RULES.md#11a--execution-mode)). Target code it reads at a commit comes from a copy made with `GIT_NO_LAZY_FETCH=1 git clone --no-local <checkout> <scratch copy>`, never a checkout in a client-supplied `.git/` ([11c](../OUTPUT-RULES.md#11c--untrusted-git-checkouts)).

### patch-engineer
**Role:** draft and verify a fix *proposal* — never writes to the client's real tree.
**Produces:** `audit_<n>/patches/F-xxx.patch` — a **minimal, idiomatic** unified diff against the pinned commit that closes *exactly* the cited bound (checked arithmetic, stored bumps, `transfer_checked`, no `unwrap()`/`expect()`, validated CPI targets), plus `VERIFICATION.md`. Emits exactly one `[FIX-*]` tier.
**Verify by execution:** applies the diff to a **scratch worktree**, rebuilds, re-runs the finding's PoC — which must now **revert**. `[FIX-VERIFIED]` requires that executed revert; no executable PoC → `[FIX-PROPOSED]` ceiling. `--verify-with-mutation` adds `mewt` mutation + a blast-radius check. A cosmetic patch ≠ FIXED. Full detail: [poc-and-patches.md](poc-and-patches.md).
**Rule 11:** the rebuild and the PoC re-run run in the run's execution mode, and never natively for an incident whose root cause is supply chain or CI ([11a](../OUTPUT-RULES.md#11a--execution-mode)); the scratch worktree comes from a copy made with `GIT_NO_LAZY_FETCH=1 git clone --no-local <checkout> <scratch copy>`, never from a client-supplied `.git/` ([11c](../OUTPUT-RULES.md#11c--untrusted-git-checkouts)).

### incident-responder
**Role:** drives the post-incident detection & response track: `/auditor:hunt` and `/auditor:respond` hand it all reading and analysis of the incident corpus. It profiles a Solana transaction corpus, keeps the hypothesis ledger, scopes a lead, decides whether an attack succeeded and quantifies its blast radius. Never part of an audit.
**Produces:** `incident_<n>/LEDGER.md` and `INCIDENTS.json`, plus `INCIDENT_REPORT.md` (hunt) or a proposed `RESPONSE-INC-<n>.<k>.md` (respond). The command spawns `context-builder` for source confirmation and `poc-engineer` for the local PoC on the program's real bytes, and hands their results to this agent.
**Hard rules:** query the corpus with the bundled recipes and `jq` — never read it into context; the recipes run from the installation (`"<auditor-skill root>/scripts/dnr/…"`, python as `python3 -I`), never as a `scripts/` path relative to the audited repo; program logs are hints, never proof of a state change; verdicts follow the [one normative ladder](../references/detection-response/README.md#the-verdict-ladder-the-one-normative-copy); it proposes containment and never performs it. Contract: [`references/detection-response/README.md`](../references/detection-response/README.md).
**Tools:** `Read, Grep, Glob, Bash, Write, Edit`. Its tool list has no MCP tools, so it cannot call a signing or transfer tool, and no `Task`, so it spawns no sub-agents. The commands themselves run in your session, where every connected MCP server stays callable; they call no MCP tool. Before a live incident, disconnect or deny write-capable MCP servers (for example, tools that transfer or stake). `Bash` can still run the `solana` CLI, which signs with the local default keypair, so the agent never runs a subcommand that signs or sends, and only Rule 11a isolated mode with no keypair mounted confines it.

## Graceful degradation

- No Trail of Bits submodule → agents fall back to `discovery/grep-commands.md` and note the gap.
- No `tools/auditor-tools` built → no `audit-scan` seed, no `audit-mem` memory; agents run the grep walk with no cross-audit dedup/suppression.
- No PoC toolchain (`cargo build-sbf`, surfpool, trident) → `poc-engineer` emits `[PoC-ATTEMPTED]` with a named blocker and keeps the prose PoC; the finding's severity is unchanged.
