<p align="center">
  <img src="assets/banner.png" alt="auditor-skill — the best all-in-one security audit skill for Solana programs and applications" width="100%">
</p>

# auditor-skill — Open-Source AI Security Audit Skill

> Production-grade security audit for any codebase, powered by AI agents.
> 20 checklists · 1,446 verification items · 140 known attack vectors · executable PoCs + fix patches
> A full audit-firm lifecycle (automated + interactive) · Benchmarked against CertiK, SOC 2, OWASP Top 10:2025
> Verify COSTS.md as a referecence - Running this audit can burn a lot of credits.

---

## What Is This?

auditor-skill is a **skill file** (a structured prompt + checklists) that turns any LLM agent (Copilot, Cursor, Windsurf, Claude Code, Codex, etc.) into a professional-grade security auditor. It reads your code file by file, checks 1,446 items across 20 security domains, tests against 140 real-world attack vectors, and produces a structured report with severity scores.

**It is not a SaaS product.** It's a folder of markdown files you install for your AI agent — outside any repository you audit — or send to an LLM API.

> **Adaptation required before use.** This skill was originally developed for a specific Solana/Anchor DeFi project and then generalized. `discovery/file-map.md` assumes that project's layout (`programs/{name}/src/`, `apps/backend/src/`, `apps/web/src/`). If yours differs, record where your code lives at intake instead: the in-scope paths under `QUESTIONS.md` Q39 ("Specific files/modules") and the exclusions under Q44, which `/auditor:intake` writes to `audit_<n>/intake.md` §1. An edited `discovery/file-map.md` in a shared or plugin install is lost on the next update. The questionnaire in `QUESTIONS.md` is a blank template — fill it out (or run `/auditor:intake`) for your project before invoking the auditor. Everything else (checklists, known vectors, output rules) is fully portable as-is.

---

## What It Does (v7.6)

- **Detection & response, post-incident (v7.6).** `/auditor:hunt` works through transaction history, program logs and Geyser/indexer exports with a written hypothesis ledger; `/auditor:respond` starts from a signature, address or alert and establishes whether the attack landed, how far it reached, and why. Verdicts follow a single [ladder](references/detection-response/README.md#the-verdict-ladder-the-one-normative-copy); the response plan is for humans to carry out — the track acts on nothing. Ported Solana-native from Anthropic's defending-code-reference-harness.
- **History-seeded threat models (v7.6).** `/auditor:threat-model --bootstrap` starts the threat model from what already went wrong: removed or quietly added account guards, reverts and fix commits in the target's history, a fork's distance from its parent, prior audit reports, post-mortems and incident records. One read-only, hardened collector (`scripts/threat-model/collect.sh`) gathers it; autonomous runs stay offline, and every goal cites its evidence.
- **GitHub Actions trigger trust (v7.6).** A CI playbook (`references/vuln-classes/github-actions.md`) for the shapes an outside account uses to reach a privileged job — comment-triggered commands without per-event author gating, expression and env-file injection, `pull_request_target` / `workflow_run` pwn requests with artifact and cache poisoning, and AI coding agents in CI — with KV-139/140, checklist 13 §13.13 (DEP-090..096), AI-034..035, read-only rules of engagement, and zsh-safe locator recipes backed by a fixture self-test.
- **Operating safety & dependency-update review (v7.6).** A new OUTPUT-RULES Rule 11 covers five things. Target code runs in the execution mode chosen at intake (isolated recommended; native allowed, with a report caveat). Outside-service use is disclosed. Untrusted `.git/` checkouts are read without letting git run their config. Audit output never reaches git or a public CI log. Bundled scripts and tools run from the installation, never from a path in the audited repository. Checklist 11 §11.11 (SC-059..062) reviews what a dependency bump's *published code* actually changed, wired into `/auditor:diff-audit` and `/auditor:re-audit`. KV-077 and SC-005 now catch the hijacked `@solana/web3.js` 1.95.6 / 1.95.7 releases.
- **Trail of Bits pin, reviewed and visible (v7.6).** `vendor/trailofbits` moves from `cfe5d7b` (2026-06-30) to `82fe822` (2026-09-28) after a full delta review; upstream had since fixed a semgrep path that silently dropped two third-party rulesets and SARIF parsing that read CodeQL severities as zero errors. The pin is shown under Installation, fetched shallow, checked by CI against the gitlink, and moved by a monthly Dependabot PR that a maintainer reviews with `scripts/tob-delta-review.sh`; plugin users receive it with this release.
- **Slot-as-clock coverage (v7.5).** SIMD-0525 halved mainnet slot time to 200 ms (Oct 9, 2026) and Alpenglow (Oct 21, 2026) made `Clock.unix_timestamp` a leader-set value, so every timelock, vesting cliff, cooldown, oracle window, rate limit and interest constant denominated in slots now elapses in half the wall-clock time. KV-138 covers the class (the EVM learned it at the Merge with Compound's `blocksPerYear`; deployed lending programs still carrying `SLOTS_PER_YEAR = 63,072,000`, whether from an old-SDK build of SPL token-lending, the Save fork's literal or Kamino's legacy basis, now accrue 2.5x the configured APR), with SM-073..074, ECON-090..092, OPS-086..087, BE-132 and FV-073 as the per-domain checks.
- **Vendored-program provenance (v7.4).** Coverage for the newest exploited class on Solana — the Rain white-label card-contract exploit (Aug 2026, ~$1.1M across Avici, Tria and other tenants): KV-137 (deployed-program version drift, fleet blast radius, inherited admin surface), off-chain-signed authority-grant checks (AC-051..055 — the `AddCollateralAdmin` signature-bundle failure) and deployed-program provenance checks (SC-053..058) — the layer `cargo audit` / `npm audit` can't see, because the vulnerable artifact is your own deployed program.
- **Transaction v1 readiness (v7.3).** A vuln-class playbook for SIMD-0385 / SIMD-0296 (4,096-byte transactions, message-level compute config, no ComputeBudget instructions, no lookup tables): who breaks and how, per-role worksheets for RPC readers, indexers / Geyser consumers, fee sponsors / co-signers, introspecting programs, senders and wallets; KV-135 (sponsor cap bypass, disabled ComputeBudget gates) and KV-136 (reader wedge, zero-budget indexing); 23 checklist items across on-chain, TypeScript, backend, frontend, deployment, testing, monitoring and off-chain Rust.
- **Token registries & permissioned tokens (v7.2).** A registry / risk-signal methodology (canonical-asset resolution, primary-variant ranking, score farming — grounded in the open-sourced tokens.xyz stack), Token ACL (SRFC-37) gate-program coverage inside the Token-2022 playbook, and web-stack items for hosted auth, API-key issuance, external data providers, Next.js 16, Bun / Turborepo and GCP / Terraform.
- **A full audit-firm lifecycle, two ways.** `/auditor:audit-cycle` runs the whole engagement autonomously (intake → context → threat model → tool-assisted pass → domain-partitioned review → triage → independent peer review → synthesis) and hands back a professional client report. `/auditor:audit-assist` runs the same pipeline **interactively**, pausing at checkpoints for the calls only you can make.
- **Executable proofs, not just prose.** For High/Critical findings, `/auditor:poc` builds a runnable exploit (Mollusk / LiteSVM / Surfpool-fork / fuzz) that *asserts* the vulnerability, and `/auditor:patch` drafts a minimal fix and **proves it reverts the exploit**. Evidence is tiered (`[PoC-REPRODUCED]` … `[PoC-PROSE]`); prose is never dropped when a harness can't be built.
- **Token-efficient by construction.** An optional Rust pre-scanner (`audit-scan`) enumerates the risky surface deterministically (~$0), cutting ~30-40% of input tokens on large programs. A cross-audit memory store (`audit-mem`) gives exact dedup, regression detection, and false-positive suppression across runs.
- **17 commands, 9 specialized agents.** Scoping, threat modeling, deep review, economic simulation, differential/PR audits, spec compliance, triage, fix-review — each a first-class command, plus a post-incident detection & response track (hunt + respond over transaction history). The automated audit flow chains eight purpose-built agents; a ninth, incident-responder, drives the post-incident track.
- **Deep Solana coverage.** 13 protocol methodologies (AMM/CLMM, lending, perps, oracles, stablecoins, liquid staking, governance, bridges, multisig/custody, Token-2022, NFT marketplaces, launchpads, token registries & risk signals), framework idioms (Anchor/Native/Pinocchio), and a reusable invariant catalog — loaded only when the code triggers them.
- **Rigor gates against AI over-reporting.** A validation gate (reachability + math/state-bounds + attacker-model) every high-severity finding must survive, Impact×Likelihood severity with principled downgrades, and a Notes & Nitpicks tier that keeps the findings table honest.
- **Real tooling, vendored.** Trail of Bits execution plugins (SAST, fuzzing, coverage, mutation) ship as a submodule; the native corpus works fully without them.

### Documentation

| Guide | What's inside |
|-------|---------------|
| [docs/getting-started.md](docs/getting-started.md) | Install, submodule init, build the Rust tools, run your first audit |
| [docs/audit-flows.md](docs/audit-flows.md) | The lifecycle and when to use each flow (`/audit`, `/audit-cycle`, `/audit-assist`, `/re-audit`) |
| [docs/commands.md](docs/commands.md) | Reference for all 17 commands |
| [docs/agents.md](docs/agents.md) | The 9-agent roster and how they chain |
| [docs/power-tools.md](docs/power-tools.md) | `audit-scan`, `audit-mem`, Trail of Bits, Surfpool, PoC/patch harnesses, the bundled scripts and their flags |
| [docs/poc-and-patches.md](docs/poc-and-patches.md) | Executable exploit + fix-patch delivery |
| [docs/output-and-rigor.md](docs/output-and-rigor.md) | Severity, the Rule 5b gate, scope-gated loading, report format |
| [docs/detection-response.md](docs/detection-response.md) | Post-incident hunting + incident workup (`/auditor:hunt`, `/auditor:respond`) |

---

## Supported Languages & Frameworks

| Language | Checklists | Items |
|----------|-----------|-------|
| Rust (Solana/Anchor) | 01-07 | 531 |
| Rust (off-chain services) | 20 | 21 |
| TypeScript / Node.js | 08-09 | 196 |
| React / Next.js | 08, 10 | 148 |
| Python | 14 | 82 |
| Go / Java / Ruby / PHP | 15 | 88 |
| AI / agent components | 19 | 35 |
| **Always applied** (any repo) | 11-13, 16-18 | 409 |
| **Total** | **20** | **1,446** |

---

## Installation

Install auditor-skill **outside any repository you audit**: the plugin (Option 1), or a user-level skill such as `install.sh ~/.claude/skills/auditor-skill`. A copy inside the audited repository resolves its scripts, tools and corpus from a tree that repository controls, and that repository's own `.claude/`, `.mcp.json` and `CLAUDE.md` are target-controlled too ([OUTPUT-RULES.md Rule 11e](OUTPUT-RULES.md#11e--bundled-paths)).

**Upgrading from 7.5 or earlier.** If your copy sits inside a repository (the `install.sh` default, `.claude/skills/auditor-skill`), delete it (`rm -rf .claude/skills/auditor-skill`) and install a fresh copy outside: the plugin (Option 1), or Option 2 with the path `~/.claude/skills/auditor-skill`. Never move or update a copy you find inside a repository: its git config may have come with that repository. Plugin users get 7.6.0, with the new Trail of Bits pin, when they update the plugin.

### Option 1: Claude Code plugin marketplace (recommended)

```
/plugin marketplace add solanabr/auditor-skill
/plugin install auditor
```

Registers the marketplace and installs the `auditor` plugin — all 17 `/auditor:*` commands and 9 agents. Claude Code clones the plugin together with its submodules, so this also fetches the vendored Trail of Bits tooling at the pinned commit (see [Tool execution](#tool-execution-trail-of-bits--optional-rust-tools)); there is no manual step.

### Option 2: Install script

Installs the skill and inits the tooling. Pass a path outside the repositories you audit; with no argument it installs into the current directory's `.claude/skills/auditor-skill`, so never run it bare inside a repository you are about to audit. It warns on stderr when the install directory is inside a git work tree. Re-running it with the same path installs a fresh clone there and moves the earlier install aside to `<path>.old-<timestamp>`, without running git in it. A run without a path never replaces anything, and stops if `.claude/skills/auditor-skill` already exists:

```bash
# read it first (it's a security tool, after all):
git clone https://github.com/solanabr/auditor-skill.git
./auditor-skill/install.sh ~/.claude/skills/auditor-skill    # user-level, outside any audited repository

# one-liner (convenience), same target:
curl -fsSL https://raw.githubusercontent.com/solanabr/auditor-skill/main/install.sh | bash -s -- ~/.claude/skills/auditor-skill
```

### Option 3: Clone manually

```bash
git clone https://github.com/solanabr/auditor-skill.git ~/.claude/skills/auditor-skill
```

Claude Code auto-discovers user-level skills under `~/.claude/skills/`; invoke by asking your agent to "audit this repo using the auditor-skill" (use **Option 1** for the `/auditor:*` slash commands). For other agents (Cursor, Windsurf, Copilot, Codex), copy the folder anywhere the agent reads outside the repository you audit, and point it at its `SKILL.md`.

### Option 4: Feed files to the API directly

If you're building a service, send `SKILL.md` + `OUTPUT-RULES.md` + `FULL-AUDIT.md` as system context and the target repo files as user content to any LLM API.

### Tool execution (Trail of Bits) + optional Rust tools

auditor-skill vendors **Trail of Bits** ([trailofbits/skills](https://github.com/trailofbits/skills), CC-BY-SA 4.0) as a git submodule (`vendor/trailofbits`) for real tool execution — SAST, fuzzing, coverage, mutation. Options 1 and 2 both fetch it. For Option 3, or any other clone, run this from the auditor-skill directory (not your project root):

```bash
git submodule update --init --depth 1 -- vendor/trailofbits
```

**Pinned at** [`82fe822`](https://github.com/trailofbits/skills/tree/82fe8226252622fa807643bdca1710901198553a) — trailofbits/skills `main` of 2026-09-28. Upstream publishes no tags or releases, so the pin is a commit, and it moves only after a reviewed bump ([CONTRIBUTING.md §5](CONTRIBUTING.md#5-tooling-changes)); CI fails if this line and the submodule disagree, and plugin installs receive a new pin with the next release. To read the pin of any checkout without initializing the submodule: `git ls-tree HEAD vendor/trailofbits`.

The native corpus works fully **without** it (it falls back to grep-based checks and notes where deeper tooling would run). With the submodule initialized, the auditor delegates to the vendored tools per [`references/orchestration/boundary-map.md`](references/orchestration/boundary-map.md). For the optional token-efficiency tools (`audit-scan` pre-scanner + `audit-mem` memory), build the Rust CLIs (`<auditor-skill root>` is where you installed auditor-skill):

```bash
cd "<auditor-skill root>/tools/auditor-tools" && cargo build --release
```

The auditor runs them, the scripts and the Trail of Bits plugins by absolute path from the installation, never by a path relative to the project it audits ([OUTPUT-RULES.md Rule 11e](OUTPUT-RULES.md#11e--bundled-paths)). If the installation sits inside the repository under audit anyway (the `install.sh` default, `.claude/skills/auditor-skill`), the build runs inside that tree, where cargo and rustup read its `.cargo/config*` and `rust-toolchain*` from every parent directory: build there only in [Rule 11a](OUTPUT-RULES.md#rule-11-operating-safety) isolated mode, or delete that copy and install a fresh one outside (the plugin, or Option 2 with the path `~/.claude/skills/auditor-skill`) and build that one. Never move or update a copy you find inside a repository ([Installation](#installation)).

---

## Before Running an Audit

### Scope-Gated Intake (v5.0)

auditor-skill does not bulk-read its whole corpus. It discovers the repo, declares an audit scope ([OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 0), and loads only the in-scope checklists and vectors on demand:

- root docs + `OUTPUT-RULES.md` (always),
- only the `checklists/*.md` the detected languages require (e.g. `14-python-safety.md` only if `.py` is present),
- a `known-vectors/*.md` file only when its phase + language trigger reaches it,
- `discovery/*.md` and `templates/*.md` lazily, at the phase that uses them.

The audit is complete when every **in-scope** item has an explicit verdict; out-of-scope items render `[N/A — out of scope]` from the gate.

1. **Fill out the questionnaire:** Copy [QUESTIONS.md](QUESTIONS.md) and answer all questions. This tells the auditor what checklists to apply, what severity calibration to use, and what compliance frameworks matter.

2. **Review estimated costs:** Check [COSTS.md](COSTS.md) for token/dollar estimates based on your repo size and chosen model.

3. **Choose your scope:**

| Scope | What It Covers | Estimated Time (50K lines) |
|-------|---------------|---------------------------|
| FULL | Everything — all 20 checklists + 140 vectors | 60-90 min |
| PROGRAM | Smart contract only (checklists 01-07) | 20-35 min |
| BACKEND | Backend API (checklists 08-09) | 15-25 min |
| FRONTEND | Frontend (checklists 08, 10) | 15-25 min |
| DEVOPS | Infra + supply chain (checklists 11-13) | 10-15 min |
| QUICK | Known vectors only (grep-based scan) | 5-10 min |

---

## Folder Structure

```
auditor-skill/
├── README.md                ← YOU ARE HERE
├── SKILL.md                 ← Orchestrator — the AI agent reads this first
├── OUTPUT-RULES.md          ← Mandatory output format, severity scale
├── FULL-AUDIT.md            ← Step-by-step execution plan for complete audits
├── QUESTIONS.md             ← Pre-audit questionnaire (fill before running)
├── COSTS.md                 ← Estimated costs by model and repo size
├── CONTRIBUTING.md          ← Branch / PR flow, corpus-count rules, no AI-attribution policy
├── SECURITY.md              ← Private vulnerability reporting for the skill and its tooling
│
├── known-vectors/           ← Individual attack vector files (for contributors)
│   ├── INDEX.md             ← One-line index of all vectors
│   ├── 001-private-key-leak.md
│   ├── 002-flash-loan-price-manipulation.md
│   ├── ...
│   └── 100-insufficient-backup-disaster-recovery.md
│
├── checklists/              ← 20 micro-checklists (the core verification items)
│   ├── 01-program-account-validation.md    (90 items)
│   ├── 02-program-access-control.md        (55 items)
│   ├── 03-program-arithmetic-safety.md     (63 items)
│   ├── 04-program-cpi-pda.md              (70 items)
│   ├── 05-program-state-machine.md         (74 items)
│   ├── 06-program-economic-logic.md        (92 items)
│   ├── 07-program-opsec-governance.md      (87 items)
│   ├── 08-typescript-safety.md             (64 items)
│   ├── 09-backend-security.md             (132 items)
│   ├── 10-frontend-security.md             (84 items)
│   ├── 11-supply-chain.md                  (62 items)
│   ├── 12-secrets-opsec.md                 (53 items)
│   ├── 13-deployment-infrastructure.md     (96 items)
│   ├── 14-python-safety.md                 (82 items)
│   ├── 15-general-language-safety.md       (88 items)
│   ├── 16-formal-verification-testing.md   (73 items)
│   ├── 17-logging-monitoring-incident-response.md (65 items)
│   ├── 18-privacy-compliance-change-management.md (60 items)
│   ├── 19-ai-agent-security.md (35 items) — AI agents on Solana
│   └── 20-rust-offchain-services.md (21 items) — Off-chain Rust (geyser/indexers/keepers)
│
├── discovery/               ← File patterns and search commands
│   ├── file-map.md          ← Maps checklists → target file patterns
│   └── grep-commands.md     ← All grep/terminal commands by category
│
├── references/              ← Progressive-disclosure deep coverage (loaded on trigger)
│   ├── methodologies/       ← 13 protocol playbooks (amm-clmm, lending, perps, oracles,
│   │                          stablecoin, liquid-staking, governance, bridges,
│   │                          wallets-multisig-custody, token-2022, nft-marketplaces, launchpads,
│   │                          token-registry-risk)
│   ├── framework-idioms/    ← Anchor / Native / Pinocchio validation-order footguns
│   ├── vuln-classes/        ← zk-and-compression · transaction-v1 (SIMD-0385 migration) · github-actions (CI trigger trust)
│   ├── invariant-catalog.md ← Reusable harness-ready invariant menus per protocol class
│   ├── false-positives.md   ← Over-reporting triage rules
│   ├── audit-lifecycle/     ← methodology + firm-coverage (how firms work) + threat-model-bootstrap
│   ├── detection-response/  ← post-incident track: rules + verdict ladder, Solana log sources, containment, INCIDENTS.json schema
│   └── orchestration/       ← boundary-map (Trail of Bits) · pre-scan · poc-harness
│
├── commands/                ← 17 slash-commands (/auditor:<name>)
│   ├── audit · quick-scan · deep-review · diff-audit · spec-audit · economic-sim · audit-report
│   ├── audit-cycle · audit-assist · re-audit            ← lifecycle flows
│   ├── intake · threat-model · triage                   ← perimeter
│   ├── poc · patch                                      ← executable PoC + fix patches
│   └── hunt · respond                                   ← post-incident detection & response
│
├── agents/                  ← 9 specialized subagents
│   ├── context-builder · threat-modeler · vuln-hunter · economic-analyst
│   └── peer-reviewer · audit-reporter · poc-engineer · patch-engineer · incident-responder
│
├── tools/auditor-tools/     ← Rust CLIs (cargo build --release)
│   ├── audit-scan           ← deterministic pre-scan → JSON risky-surface map (~$0)
│   └── audit-mem            ← SQLite cross-audit memory (dedup · regression · FP-suppression)
│
├── templates/               ← Output + deliverable templates
│   ├── report-template.md   ← Internal item-by-item verdict report
│   ├── audit-report.md      ← Client-facing findings report (no deploy guarantee)
│   ├── context-worksheet.md · instruction-worksheet.md · intake.md · threat-model.md
│   ├── incident-report.md · response-plan.md · hunt-ledger.md
│   ├── poc/                 ← exploit-harness crate skeleton + shared-test-utils
│   └── patch/               ← patch + VERIFICATION templates
│
├── docs/                    ← Usage guides (start at docs/README.md)
├── scripts/                 ← report-to-pdf.sh, check-corpus.sh, tob-delta-review.sh + the no-attribution commit hook
│   ├── dnr/                 ← detection & response recipes (gated RPC collector, program snapshot, corpus profile, log frames, balance deltas)
│   ├── threat-model/        ← collect.sh — the read-only threat-model bootstrap collector
│   └── tests/               ← script self-tests (+ fixtures/gha/, workflows that are never executed)
├── AGENTS.md                ← Agent-orchestration overview
└── vendor/trailofbits/      ← Trail of Bits execution plugins (git submodule, pinned — see Installation)
```

---

## Audit Flows

Beyond one-shot `/audit`, two flows run a full audit-company lifecycle end-to-end:

- **`/auditor:audit-cycle`** — a **fully automated** audit-agent team (scope → context reconstruction → tool-assisted pass → parallel manual review with leaf-level false-positive gating → independent peer reconciliation → synthesis) that produces a professional client report at `audit_<n>/REPORT.md`. Optional PDF (needs [pandoc](https://pandoc.org/)):
  ```bash
  # from your project; <auditor-skill root> is where auditor-skill is installed
  "<auditor-skill root>/scripts/report-to-pdf.sh" audit_1/REPORT.md   # writes REPORT.pdf if pandoc is installed; MD is always the deliverable
  ```
- **`/auditor:audit-assist`** — an **AI-assisted, human-in-the-loop** flow: it pauses at checkpoints to surface findings and ask the questions only you can answer (business context, trust model, severity calls), iterating until the audit document converges.
- **`/auditor:re-audit`** — **fix-review**: diffs against a prior report (`FIXED` / `STILL-OPEN` / `REGRESSED`) and sweeps for un-patched siblings of each fixed bug.

Every intermediary step is also addressable on its own: `/auditor:intake` (persisted scoping), `/auditor:threat-model` (asset/actor/trust-boundary artifact; `--bootstrap` seeds it from git history, a fork parent, prior audits and incidents), `/auditor:triage` (dedup + false-positive calibration), and `/auditor:poc` / `/auditor:patch` (executable exploit + verified fix). Full command reference: [docs/commands.md](docs/commands.md).

The client report follows professional firm convention — executive summary, commit-pinned scope, findings with PoC/reachability, a code-maturity assessment, disclaimers. Like real firms, it does **not** issue a "safe to deploy" guarantee. Method + firm coverage: [references/audit-lifecycle/](references/audit-lifecycle/).

---

## Output Format

The audit produces a structured markdown report with:

1. **Executive Summary** — risk score (1-10), deploy/no-deploy verdict, severity distribution
2. **Instruction Matrix** — every smart contract instruction mapped
3. **State Model** — account structs, PDA seeds, relationships
4. **Per-Item Verdicts** — every in-scope checklist item (up to 1,446) with `[PASS]`, `[FAIL-N]`, `[PARTIAL]`, or `[N/A]`
5. **Known Vectors Results** — each in-scope attack vector (up to 140) with explicit verdict and evidence
6. **Findings** — deduplicated, severity-sorted
7. **Attack Scenarios** — narrative exploitable paths
8. **Aggregate Score** — PASS/PARTIAL/FAIL percentages
9. **Recommendations** — prioritized fix list

For High/Critical findings, an optional `audit_<n>/poc/` (runnable exploits that assert the bug) and `audit_<n>/patches/` (minimal fixes proven to revert the exploit) accompany the report — see [docs/poc-and-patches.md](docs/poc-and-patches.md).

See [OUTPUT-RULES.md](OUTPUT-RULES.md) for the complete specification.

---

## How to Invoke

### VS Code / GitHub Copilot
```
@workspace Audit the entire repository using the auditor-skill
```

### Cursor / Windsurf
```
Read ~/.claude/skills/auditor-skill/SKILL.md then audit this repository following that installation's FULL-AUDIT.md execution plan
```

### Claude Code (CLI)
```
Read the auditor-skill files in ~/.claude/skills/auditor-skill/ and perform a full security audit of this repository
```

### API (programmatic)
```python
# Send SKILL.md + OUTPUT-RULES.md + FULL-AUDIT.md as system prompt
# Send target files as user messages (chunked)
# Collect structured output
```

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first — branch + PR flow (nothing lands on `main` directly), the corpus-count consistency rule enforced by `scripts/check-corpus.sh` in CI, and the no-AI-attribution commit policy (enable the hook with `git config core.hooksPath scripts/hooks`).

### Adding a New Attack Vector

1. Create `known-vectors/NNN-short-name.md` with the next available number
2. Use this template:

```markdown
---
id: NNN
title: "Your Attack Name"
severity: 7
category: crypto|backend|frontend|devops
---

### NNN — Your Attack Name
**Severity: 7** | **Real: Example Incident ($X, Year)**

Brief description of the attack.

#### Verification Procedure

**Step 1: Description**
\```
grep command or check to perform
\```
- ✅ PASS: What passing looks like
- ❌ FAIL: What failing looks like

**Step 2: ...**
(continue with 3-12 steps)

**Overall verdict:**
- ✅: Full mitigation criteria
- ⚠️: Partial mitigation criteria
- ❌: Vulnerability criteria
```

3. Add the entry to [known-vectors/INDEX.md](known-vectors/INDEX.md)
4. Submit a PR

### Adding Checklist Items

1. Open the relevant checklist in `checklists/`
2. Add new items following the existing format (ID prefix + sequential number)
3. Update the item count in [SKILL.md](SKILL.md)

### Updating Cost Estimates

If model pricing changes, update [COSTS.md](COSTS.md) with new rates.

---

## Benchmarking

This auditor was designed by comparing methodology from:

| Standard | Domain | What We Took |
|----------|--------|-------------|
| **CertiK** | Crypto audit | On-chain vulnerability taxonomy, formal verification approach |
| **EY / SOC 2** | Enterprise IT audit | Control objectives, evidence requirements |
| **OWASP Top 10:2025** | Web security | Attack categories, severity calibration |
| **NIST SP 800-53** | Government security | Control framework structure |
| **COBIT 2019** | IT governance | Process maturity model |
| **GDPR / MiCA / DORA** | EU regulation | Compliance checklist items |

---

## License

MIT — use it, fork it, improve it, sell services built on it. Attribution appreciated but not required.

---

## FAQ

**Q: Does this replace a professional audit?**
A: It covers more items than most paid audits (1,446 plus 140 known-vector checks vs typical 50-200), but an AI auditor cannot do everything a human can (social engineering assessment, business logic review requiring domain expertise, legal compliance opinions). Use this as a first pass, then hire humans for what it flags.

**Q: Which AI model should I use?**
A: See [COSTS.md](COSTS.md). For maximum depth, use Opus 4 or o3. For best value, use Sonnet 4 or GPT-4.1. For CI/CD integration (fast, cheap), use Haiku or o4-mini.

**Q: How long does an audit take?**
A: Depends on repo size and model. A 50K-line repo takes 60-90 minutes with Opus 4. See [COSTS.md](COSTS.md) for full estimates.

**Q: Can I use this in CI/CD?**
A: Yes — run the QUICK scope (known vectors grep scan) on every PR, and FULL scope on release branches. On a public repository the job posts pass/fail only — no finding counts: logs and uploaded artifacts are readable by any signed-in GitHub user, so finding details go to a private channel (OUTPUT-RULES Rule 11d).

**Q: Can I use this for non-Solana projects?**
A: Yes — checklists 08-18 are language-agnostic or cover Python/Go/Java/Ruby/PHP. Checklists 01-07 are Solana-specific.

---

## Acknowledgments

auditor-skill stands on the shoulders of these open-source security projects — credited in full in [ATTRIBUTION.md](ATTRIBUTION.md):

- **[Frank Castle](https://github.com/Frankcastleauditor) — [safe-solana-builder](https://github.com/Frankcastleauditor/safe-solana-builder)** (MIT): Solana security depth — reward/staking accounting, Token-2022 extension abuse, framework validation idioms, zero-copy footguns — adapted natively and re-authored audit-side.
- **[Trail of Bits](https://github.com/trailofbits) — [skills](https://github.com/trailofbits/skills)** (CC-BY-SA 4.0): tool-execution methodology (SAST, fuzzing, coverage, mutation, IR analysis), vendored as a git submodule at `vendor/trailofbits` and orchestrated for real execution; methodology patterns re-implemented natively are credited by reference.
- **[Anthropic](https://github.com/anthropics) — [defending-code-reference-harness](https://github.com/anthropics/defending-code-reference-harness)** (Apache-2.0): the detection & response method (a written hypothesis ledger, a three-leg verdict ladder, response plans that people carry out), re-expressed Solana-native in `/auditor:hunt` and `/auditor:respond`; the threat-model bootstrap / bootstrap-then-interview pattern, re-expressed for Solana in `/auditor:threat-model --bootstrap`.
- **[Sentry](https://github.com/getsentry) — [gha-security-review](https://github.com/getsentry/skills/tree/main/skills/gha-security-review)** (Apache-2.0, in [getsentry/skills](https://github.com/getsentry/skills)): the GitHub Actions vector inventory behind `references/vuln-classes/github-actions.md`, re-written natively (no text copied).
- **[Cloudflare](https://github.com/cloudflare) — [security-audit-skill](https://github.com/cloudflare/security-audit-skill)** (MIT): the execution-isolation, output-hygiene and CI-trust principles, paraphrased and adapted natively in `OUTPUT-RULES.md` Rule 11a (isolated mode, recommended) and Rule 11d and in `references/vuln-classes/github-actions.md`; see [ATTRIBUTION.md](ATTRIBUTION.md).

All third-party methodology is used by *reference* — no third-party text is copied into this repository.
