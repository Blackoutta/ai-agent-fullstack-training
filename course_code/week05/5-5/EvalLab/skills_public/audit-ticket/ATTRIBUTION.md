# Attribution & Credits

auditor-skill ships original, natively-authored content. Where it draws on external
security methodology it does so by *reference* — no third-party text is copied
into this repository — and credits the source here.

## Trail of Bits — audit skills (CC-BY-SA 4.0)

Source: https://github.com/trailofbits/skills

Pinned commit: see README.md → Installation → "Tool execution (Trail of Bits)". It moves only after the review in CONTRIBUTING.md §5.

Vendored as a git submodule at `vendor/trailofbits` and invoked at runtime for
tool **execution** (static analysis, fuzzing, coverage, mutation, IR-level
analysis). A submodule is a reference (gitlink), not a copy, so no CC-BY-SA
ShareAlike obligation attaches to auditor-skill's own MIT-licensed corpus.

Several Trail of Bits *methodology patterns* are additionally re-implemented
natively, in our own words (not copied), and credited inline where used:

| Trail of Bits skill | auditor-skill implementation |
|---------------------|------------------------|
| `fp-check` / `second-opinion` | `OUTPUT-RULES.md` Rule 5b — Validation Gate |
| `audit-context-building` | `FULL-AUDIT.md` Phase 0.5 — Context Reconstruction |
| `code-maturity-assessor` | `FULL-AUDIT.md` Phase 4.5 — Maturity Assessment |
| `differential-review` | Mode 4 — Differential Audit |
| `spec-to-code-compliance` | Mode 5 — Spec Compliance |
| `agentic-actions-auditor` | `checklists/19-ai-agent-security.md` (Solana-ported CI vectors), `known-vectors/116`, `references/vuln-classes/github-actions.md` §6 |

## safe-solana-builder (MIT)

Source: https://github.com/frankcastleauditor/safe-solana-builder

Solana-specific secure-coding guidance was **adapted** — re-framed from build-time
to audit-time and re-expressed in our own words — into native auditor-skill content:

| safe-solana-builder reference | auditor-skill implementation |
|-------------------------------|------------------------|
| `shared-base.md §21` (reward accounting) | `checklists/06` §6.10 |
| `§23` + `anchor.md §4.1` (Token-2022) | `known-vectors/105` + `checklists/04` |
| `anchor.md` / `native-rust.md` / `pinocchio.md` idioms | `references/framework-idioms/*` |
| `litesvm.md` (test patterns) | `checklists/16` (test-suite verification) |
| `shared-base.md §25` (BPF stack frame) | `known-vectors/111` |
| `shared-base.md §5.3–5.5` (CPI trust boundary) | `checklists/04` RE-006/007 + `references/framework-idioms/anchor.md` |

## Anthropic — defending-code-reference-harness (Apache-2.0)

Source: https://github.com/anthropics/defending-code-reference-harness (commit d3bea6b, 2026-08-06; the upstream README states the repository is not maintained).
Copyright 2026 Anthropic PBC, under the Apache License 2.0; upstream ships no NOTICE file.
Ported as method and re-expressed in our own words — no upstream text is copied.

| Upstream | auditor-skill implementation |
|----------|------------------------------|
| `dnr-hunt` (baseline → hypothesis ledger → source confirmation → local PoC) | `commands/hunt.md`, `agents/incident-responder.md`, `templates/hunt-ledger.md`, `templates/incident-report.md` |
| `dnr-respond` (scope → verdict → blast radius → proposed plan) | `commands/respond.md`, `templates/response-plan.md`, `references/detection-response/containment-playbook.md` |
| verdict ladder + `INCIDENTS.json` field names | `references/detection-response/README.md`, `references/detection-response/incidents-schema.md` |
| `threat-model` skill (bootstrap and bootstrap-then-interview modes, the team-availability routing step, prior-vulnerability inputs, evidence that ranks goals without becoming them, seeded interview) | `commands/threat-model.md` `--bootstrap`, `references/audit-lifecycle/threat-model-bootstrap.md`, `scripts/threat-model/collect.sh`, `templates/threat-model.md` §4–§6 |

Modifications:

- Detection & response: log sources changed from web access/application logs to Solana transaction history (`getSignaturesForAddress`, `getTransaction`, program logs, Geyser/Yellowstone, indexer exports); the local-PoC leg uses the existing `[PoC-*]` harness (Mollusk/LiteSVM/Surfpool) on the real program bytes instead of HTTP to a demo app; added Solana rules (logs are program-asserted, never prove a state change; never sign/send/simulate against a public cluster; on-chain strings are untrusted), binary provenance, an urgency vocabulary and a Solana containment playbook. Not ported: the dnr-pipeline autonomous harness, checkpoint.py, and the dnrcanary demo target.
- Threat-model bootstrap: re-expressed in our own words (nothing quoted) and re-targeted to Solana programs — one hardened read-only collector instead of a research swarm, pickaxe mining of removed / quietly added account guards, fork-point and parent-guard hints, `security_txt!` / `declare_id!` provenance, an allowlisted INCIDENTS.json reader. Not ported: the swarm, STRIDE gap-fill, likelihood × impact scoring, checkpoint state.

## Sentry — gha-security-review skill (Apache-2.0)

Source: https://github.com/getsentry/skills/tree/main/skills/gha-security-review
(reviewed at commit d18b7aa8ba878354e5c348310230e652f7690f9c, 2026-09-29).
Copyright 2025 Functional Software, Inc. dba Sentry; licensed under the Apache License, Version 2.0.

Its vector inventory and per-trigger structure informed the GitHub Actions reference. The material was
**re-written** for auditor-skill in our own words — no Sentry text is copied — and every incident was
re-cited to its primary source:

| Sentry reference | auditor-skill implementation |
|------------------|------------------------------|
| `comment-triggered-commands.md` | `references/vuln-classes/github-actions.md` §3, KV-139, DEP-090..092 |
| `expression-injection.md` | §4, DEP-069, DEP-095 |
| `pwn-request.md` + cache / artifact parts of `runner-infrastructure.md` | §5, KV-140, DEP-093, DEP-094, DEP-096 |
| `ai-prompt-injection-via-ci.md` | §6, AI-034, AI-035 |
| `real-world-attacks.md` | §8 (each row re-cited to an advisory, CVE or post-mortem) |
| `permissions-and-secrets.md`, `credential-escalation.md`, `supply-chain.md`, `runner-infrastructure.md` | §7 pointers |

Modifications: ten files condensed into one playbook; converted into PASS / FAIL checklist items and
known-vector procedures; extended with per-event `author_association` pairing, unsound `contains()` and
deny-lists, approved-commit binding, env-file injection, OIDC subject collisions, agent configuration
restore and output channels, and Solana build-time execution and key material; corrected against primary
sources; and updated for platform changes after the upstream snapshot (the actions/checkout fork-PR guard
and its backports, the December 2025 `pull_request_target` change).

## Cloudflare — security-audit skill (MIT)

Source: https://github.com/cloudflare/security-audit-skill

Audit-method principles and CI attack classes, re-expressed natively in our own words (no text copied):

| Cloudflare idea | auditor-skill implementation |
|-----------------|------------------------------|
| Code the audited repository controls runs only inside a sandbox that holds no credentials — otherwise it does not run | `OUTPUT-RULES.md` Rule 11a (our isolated mode; native allowed with a caveat) |
| Keep audit output out of version control and public CI | `OUTPUT-RULES.md` Rule 11d — Output hygiene |
| CI and automation classes, universal moves (`skills/security-audit/SUPPLY-CHAIN-AND-RELEASE.md`) | `references/vuln-classes/github-actions.md` §0 (hosted settings graded PARTIAL), §3.5 (resource-selecting inputs), §4.2 (matrix values and artifact names as taint), §5.5 (persisted-channel map) — paraphrased |

## Assessed, not vendored

External security skill packs reviewed for anything to absorb. Re-checked at each release PR.

| Source | Licence | Assessed commit | Verdict | What we took → where | Re-check trigger |
|--------|---------|-----------------|---------|----------------------|------------------|
| [anza-xyz/claude-skills](https://github.com/anza-xyz/claude-skills) (2★ at assessment) | none (all rights reserved) | `0ec828e` (tag v1.1.0; 3 commits: 2 on main + PR head `5e9b2be`) | Watch; idea re-implemented independently, no text used | Review of a dependency bump's published code delta → `checklists/11` §11.11, `/auditor:diff-audit` dependency lane; findings kept out of public CI → Rule 11d | It gains a LICENSE, or adds skill/command content |
| [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) | MIT | `c1c8a8c` | Absorb principles only; not vendored (109 of its 162 attack classes are already covered or partly covered here) | Execution isolation → `OUTPUT-RULES.md` Rule 11a (our isolated mode; native allowed with a caveat); output hygiene → Rule 11d; CI-trigger principles → `references/vuln-classes/github-actions.md` (see the Cloudflare section above) | Each release PR |

## Knowledge sources

Taxonomy structure, exploit→vector mappings, and severity calibration were
informed by public post-mortems and publicly disclosed audit reports, and
re-expressed in our own words. No proprietary or trade-secret material is
included in this repository.
