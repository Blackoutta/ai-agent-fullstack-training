# auditor-skill — Documentation

Usage guides for `auditor-skill`, an open-source AI security-audit skill for Solana programs and full-stack code.

## What is auditor-skill

A folder of markdown checklists, slash commands, and subagents — plus two small Rust tools — that turns an LLM agent into a security auditor. It discovers a repo, declares a scope, loads only the checklists that scope needs, walks the code file by file, and emits a severity-ranked report where **every in-scope item carries an explicit verdict**. Corpus: 20 checklists / 1,446 items / 140 known attack vectors, 13 protocol methodologies, framework idioms, and a validation gate that forces high-severity findings to prove reachability before they count. It is a rigorous first pass, not a replacement for a human firm audit.

Commands are namespaced `auditor`, so you invoke them as `/auditor:audit`, `/auditor:audit-cycle`, etc.

## I want to… → use this

| Goal | Use | Guide |
|------|-----|-------|
| One-shot full audit of a repo | `/auditor:audit [path] [--scope ...]` | [commands.md](commands.md#auditoraudit) |
| Fast CI gate / first look (no full walk) | `/auditor:quick-scan` | [commands.md](commands.md#auditorquick-scan) |
| Audit only a PR / commit range | `/auditor:diff-audit [base..head]` | [commands.md](commands.md#auditordiff-audit) |
| Deep-dive one instruction / function | `/auditor:deep-review <file> [fn]` | [commands.md](commands.md#auditordeep-review) |
| Code-vs-spec conformance | `/auditor:spec-audit <spec> [path]` | [commands.md](commands.md#auditorspec-audit) |
| Full automated engagement → client report | `/auditor:audit-cycle` | [audit-flows.md](audit-flows.md#flow-a--auditoraudit-cycle-automated) |
| Human-in-the-loop engagement | `/auditor:audit-assist` | [audit-flows.md](audit-flows.md#flow-b--auditoraudit-assist-interactive) |
| Review a fix round against a prior report | `/auditor:re-audit [prior] [base..head]` | [commands.md](commands.md#auditorre-audit) |
| Set up scope + trust model before auditing | `/auditor:intake` (alias `/scope`) | [commands.md](commands.md#auditorintake) |
| Enumerate assets / actors / trust boundaries | `/auditor:threat-model` | [commands.md](commands.md#auditorthreat-model) |
| Threat-model a fork or inherited codebase from its history | `/auditor:threat-model --bootstrap` | [commands.md](commands.md#auditorthreat-model) |
| Quantify an economic attack ($ P/L) | `/auditor:economic-sim <finding>` | [commands.md](commands.md#auditoreconomic-sim) |
| Consolidate + de-dup candidate findings | `/auditor:triage` | [commands.md](commands.md#auditortriage) |
| Build a runnable exploit for a finding | `/auditor:poc <finding-id>` | [poc-and-patches.md](poc-and-patches.md) |
| Draft + verify a fix patch | `/auditor:patch <finding-id>` | [poc-and-patches.md](poc-and-patches.md) |
| Assemble a report from checkpoints | `/auditor:audit-report [dir]` | [commands.md](commands.md#auditoraudit-report) |
| Find out whether we were attacked (no alert) | `/auditor:hunt [address…]` | [detection-response.md](detection-response.md) |
| Work an alert or a drained protocol: outcome, damage, next steps | `/auditor:respond <signature / address / INC-n.k>` | [detection-response.md](detection-response.md) |
| Cut audit token cost ~30-40% | build `audit-scan` | [power-tools.md](power-tools.md#audit-scan) |
| Remember findings across audits | build `audit-mem` | [power-tools.md](power-tools.md#audit-mem) |

## Guides

- **[getting-started.md](getting-started.md)** — install, submodule, build the Rust tools, run your first audit, the adaptation note.
- **[audit-flows.md](audit-flows.md)** — the full lifecycle; when to use one-shot vs automated vs interactive vs fix-review; the cheap lanes.
- **[commands.md](commands.md)** — reference entry for each of the 17 commands, grouped by phase.
- **[agents.md](agents.md)** — the 9-agent roster: role, model tier, when each fires, how they chain.
- **[power-tools.md](power-tools.md)** — `audit-scan`, `audit-mem`, Trail of Bits plugins, Surfpool sim, the PoC/patch stack, the bundled scripts and their flags.
- **[poc-and-patches.md](poc-and-patches.md)** — executable PoC + patch delivery, framework matrix, evidence and fix tiers.
- **[output-and-rigor.md](output-and-rigor.md)** — severity model, the Rule 5b gate, report templates, the no-"safe to deploy" convention.
- **[detection-response.md](detection-response.md)** — post-incident hunting and incident workup.

## Root references (outside `docs/`)

- [`SKILL.md`](../SKILL.md) — the orchestrator the agent reads first.
- [`OUTPUT-RULES.md`](../OUTPUT-RULES.md) — the mandatory output format, severity scale and operating-safety rules (Rule 11).
- [`AGENTS.md`](../AGENTS.md) — agent orchestration overview.
- [`COSTS.md`](../COSTS.md) — token/dollar estimates by model and repo size.
- [`QUESTIONS.md`](../QUESTIONS.md) — the 46-question pre-audit questionnaire.
