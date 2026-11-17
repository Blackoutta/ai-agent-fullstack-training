---
name: auditor-skill
description: "**AUDIT SKILL** — Comprehensive on-chain Solana program auditor and full-stack security review for ANY programming language. USE FOR: auditing Solana/Anchor programs, reviewing smart contract security, checking for vulnerabilities (missing signers, unchecked accounts, arithmetic overflow, CPI attacks, PDA confusion, type cosplay, reinitialization, flash loan exploits, MEV, governance backdoors, timelock bypass), auditing TypeScript/Python/Go/Java/Ruby/PHP/any language, backend/frontend code review, supply chain safety, CI/CD and GitHub Actions workflow security (comment-triggered commands, pull_request_target / workflow_run pwn requests, AI agents in CI), operational security (multisig, upgrade authority, deploy process), formal verification and testing quality, logging/monitoring/incident response, post-incident threat hunting and incident workup from transaction history and program logs (/auditor:hunt, /auditor:respond), data privacy/GDPR/SOC2 compliance, change management, penetration testing methodology, AI/ML security, generating audit reports, running full repository audits. Severity 1-10 scale, 20 micro-checklist domains with 1446 individual verification items, plus 140 known attack vectors, chunked file-by-file execution, item-by-item verdicts. Benchmarked against CertiK (crypto) and EY/SOC2/COBIT (traditional) audit standards. DO NOT USE FOR: writing new features, general coding, non-security reviews."
---

# auditor-skill — Multi-Language Security Audit Skill

> **Version:** 7.6\
> **Items:** 1,446 across 20 checklists (+ 140 known vectors)\
> **Languages:** Rust, TypeScript, Python, Go, Java, Ruby, PHP, + any via general checklist  
> **Severity:** 1–10 numeric scale  
> **Benchmarked against:** CertiK (crypto audit), EY/SOC 2/COBIT (traditional IT audit), OWASP Top 10:2025  
> **Designed for:** Autonomous AI auditor agent or human-guided review

---

## SCOPE-GATED LOADING — Load What The Repo Needs

auditor-skill does not read its whole corpus up front. It discovers the repo, declares a scope, loads only what that scope requires, then guarantees a verdict for every in-scope item.

**Step 1 — Discover (cheap, always).** Enumerate file extensions and markers (`Anchor.toml`, `Cargo.toml`, `package.json`, `*.py`, `.github/`). No checklists or vectors loaded yet.

**Step 2 — Declare scope.** Map detected languages (+ any `--scope`) to the in-scope checklist set:

| Detected | Load checklists |
|----------|-----------------|
| `.rs` / `Anchor.toml` | 01–07 (+ 20 for `.rs` outside `programs/`) |
| `.ts` / `.tsx` | 08 (+ 09 if backend, + 10 if web) |
| `.py` | 14 |
| `.go` / `.java` / `.rb` / `.php` / other | 15 |
| AI / agent components (`.mcp.json`, agent SDKs) | 19 |
| **any repo** | 11, 12, 13, 16, 17, 18 |

Checklists outside this set are **never read** — a Rust-only repo never loads 14 or the TS/web vectors.

**Step 3 — Load on demand.** Load an in-scope checklist when its phase begins; load a known-vector only when its phase + language/domain trigger reaches it (`known-vectors/INDEX.md` groups vectors by `{phase, language, trigger}`). Beyond the phase+language gate, vectors and feature-specific checklist sections also load on **feature presence** via the INDEX **"Load when (markers)"** column and the prescan advisory manifest (`references/orchestration/pre-scan.md`): a vector/section whose feature markers are *provably absent* (empty prescan array or zero grep hits) is skip-deferred and renders `[N/A — feature absent]`. This is advisory only — it reopens on demand the instant a manual read surfaces the feature, and every in-scope item still gets a verdict (Rule 0).

**Completeness is output-side.** The audit is COMPLETE iff every in-scope item + phase-triggered vector has a verdict. Out-of-scope items render `[N/A — out of scope: <reason>]` from the gate. Every full report includes a **Scope Coverage** table. Full rule: see [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 0.

**Step 4 — Reference layer (progressive disclosure).** Beyond the checklists, load a `references/` file only when its trigger fires — deep coverage at zero cost when irrelevant:

| Reference | Load when (grep markers) |
|-----------|--------------------------|
| `references/framework-idioms/{anchor,native,pinocchio}.md` | that framework is detected |
| `references/framework-idioms/build-and-tooling.md` | build/CI/toolchain errors or PoC-harness setup |
| `references/methodologies/amm-clmm.md` | `tick` · `sqrt_price` · `liquidity_net` · `fee_growth` · `bin_array` |
| `references/methodologies/lending.md` | `obligation` · `reserve` · `liquidation_threshold` · `borrow_index` · `ltv` |
| `references/methodologies/perps.md` | `funding_rate` · `mark_price` · `open_interest` · `maintenance_margin` · `vamm` |
| `references/methodologies/oracles.md` | `pyth` · `switchboard` · `PriceUpdateV2` · `PullFeed` · `confidence` |
| `references/methodologies/stablecoin.md` | `collateral_ratio` · `psm` · `cdp` · `debt_ceiling` · `redeem` · `peg` |
| `references/methodologies/liquid-staking.md` | `stake_pool` · `validator_list` · `exchange_rate` · `staker` · `withdrawer` · `restak` |
| `references/methodologies/governance.md` | `spl-governance` · `realm` · `proposal` · `vote_record` · `voter_weight` · `vsr` |
| `references/methodologies/bridges.md` | `guardian` · `vaa` · `post_vaa` · `verify_signatures` · `emitter` · `sequence` · `lz_receive` · `ism` · `attestation` |
| `references/methodologies/wallets-multisig-custody.md` | `threshold` · `multisig` · `member` · `propose` · `approve` · `execute_transaction` · `vault` · `guardian` · `recovery` · `spending_limit` |
| `references/methodologies/token-2022.md` | `token_2022` · `TokenInterface` · `transfer_hook` · `TransferFee` · `PermanentDelegate` · `ConfidentialTransfer` · `get_extension` · `spl_token_2022` · `token_acl` · `TACLkU6` · `gating_program` · `thaw_permissionless` |
| `references/methodologies/nft-marketplaces.md` | `metadata` · `listing` · `escrow` · `royalty` · `merkle` · `MplCore` · `auth_rules` · `collection` |
| `references/methodologies/launchpads.md` | `bonding_curve` · `reserve` · `graduate` · `virtual_reserves` · `route` · `swap` · `curve` |
| `references/methodologies/token-registry-risk.md` | `tokens.xyz` · `tokenlist` · `assetId` · `canonical` · `getTokenBySymbol` · `coingeckoId` · `trustTier` · `riskScore` · `rugcheck` · `webacy` · `goplus` · `isVerified` |
| `references/invariant-catalog.md` | building an FV/fuzz harness or reconstructing per-function invariants (Phase 0.5) — reusable invariant menus per protocol class |
| `references/vuln-classes/zk-and-compression.md` | `groth16` · `spl-account-compression` · `bubblegum` · `merkle` · `nullifier` · `ConfidentialTransfer` |
| `references/vuln-classes/transaction-v1.md` | `getTransaction` · `getBlock` · `blockSubscribe` · `maxSupportedTransactionVersion` · `yellowstone` · `geyser` · `ComputeBudgetProgram` · `computeUnitPrice` · `feePayer` / `sponsor` / `paymaster` service · `load_instruction_at` · `transactionConfig` · `0x81` |
| `references/vuln-classes/github-actions.md` | `pull_request_target` · `workflow_run` · `issue_comment` · `pull_request_review_comment` · `pull_request_review` · `discussion_comment` · `issues` (as a trigger) · `allow-unsafe-pr-checkout` · `anthropics/claude-code-action` · `run-gemini-cli` · `openai/codex-action` · `actions/ai-inference` · `claude -p` · `codex exec` |
| `references/false-positives.md` | triaging any finding before reporting severity ≥ 6 |
| `references/orchestration/boundary-map.md` | delegating to vendored Trail of Bits tooling |
| `references/orchestration/pre-scan.md` | running the deterministic Rust pre-scanner (`audit-scan`) or the cross-audit memory store (`audit-mem`) |
| `references/orchestration/poc-harness.md` | building an executable PoC or fix patch (`/auditor:poc`, `/auditor:patch`) — harness-framework selection or recording a `[PoC-*]` / `[FIX-*]` evidence tier |
| `references/detection-response/README.md` (+ `log-sources.md` · `containment-playbook.md` · `incidents-schema.md`) | running `/auditor:hunt` or `/auditor:respond`, or a request that starts from transaction history, program logs, an alert or "we were drained" — post-incident only; never loaded by an audit |
| `references/audit-lifecycle/methodology.md` | running `/audit-cycle` or `/audit-assist` (our method) |
| `references/audit-lifecycle/firm-coverage.md` | choosing methodology / understanding firm practice |
| `references/audit-lifecycle/threat-model-bootstrap.md` | `/auditor:threat-model --bootstrap` or `--vulns` / `--seed` / `--parent`; or a trigger: intake §7 prior audit / incident · `fork of` · `forked from` · `white-label` (README/docs) · `security_txt!` `source_code` not among the remotes · prior `audit_*/REPORT.md` · audit / post-mortem / incident file in the tree · `incident_*/INCIDENTS.json` |
| `references/report-format.md` | assembling the final report (Phase 5 / audit-reporter) |

**Bundled paths.** Every path this skill names for something it ships — `scripts/`, `tools/`, `templates/`, `vendor/trailofbits/` and the corpus files above — is relative to the auditor-skill root, `${CLAUDE_SKILL_DIR}`, never to the working directory, which is usually the repository under audit. Commands and agents run bundled executables from the same root, written `${CLAUDE_PLUGIN_ROOT}`, and read the corpus files they name relatively from it as well; in a file you open later, where neither variable is filled in, use the absolute root you were given ([OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 11e).

---

Full repository layout → [README.md](README.md#folder-structure).

---

## Severity Scale (1–10)

- **10–9 🔴 CRITICAL** — fund drain / fund loss → **block deploy**
- **8–7 🟠 HIGH** — partial drain, privilege escalation, significant damage → **fix before release**
- **6–5 🟡 MEDIUM** — state corruption, DoS, logic bugs, moderate info leak → **fix soon**
- **4–1 🔵 LOW / ⚪ INFO** — minor leak, missing best practice, hardening, cosmetic → **next sprint / backlog**

Full severity table + decision guide: see [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 1.

Incidents use their own urgency vocabulary (immediate / urgent / routine, [references/detection-response/README.md](references/detection-response/README.md)), never this deploy ladder; the root-cause finding inside an incident still carries a 1–10 severity.

---

## Core Principles

### 1. Walk The Code — Never One-Shot
Repositories can be 10 files or 10,000 files. The auditor reads files **one at a time**, never guesses, and saves checkpoints between chunks. See [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 3.

### 2. Every Item Gets a Verdict
All in-scope checklist items (up to 1,446) and all in-scope known vectors (up to 140) appear in the report with explicit verdicts. Nothing is silently skipped. See [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 4.

### 3. Executive Summary First
Every report starts with a plain-language summary: what was audited, what was found, whether it's safe to deploy. See [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 2.

### 4. Language Auto-Detection
The auditor scans file extensions and applies the correct checklists automatically. No language left behind. See [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 7.

### 5. Honesty Over Completeness
If context was lost, a file was too large, or a pattern is unfamiliar — say so. Never mark `[PASS]` without reading the code. See [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 10.

### 6. Operating Safety
Target-controlled code runs only in the execution mode chosen at intake (isolated recommended; native allowed, with a report caveat), the report names every outside service a tool contacts, a `.git/` the auditor did not clone is never allowed to run its config, audit output never reaches git or a public CI log, and bundled scripts, tools and corpus files resolve from the installation root, never from the audited repo. See [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 11.

---

## Audit Modes

- **Mode 1 — FULL Repository Audit.** Complete security review of the entire codebase. → Read [OUTPUT-RULES.md](OUTPUT-RULES.md), then follow [FULL-AUDIT.md](FULL-AUDIT.md) top to bottom (discovery, per-instruction review, report via [templates/report-template.md](templates/report-template.md)).
- **Mode 2 — Targeted Checklist Audit.** Review a specific domain or subset of files. → Read [OUTPUT-RULES.md](OUTPUT-RULES.md) + the relevant `checklists/` file, walk target files one at a time, record every verdict inline.
- **Mode 3 — Single Instruction / Function Review.** Deep-dive into one handler, endpoint, or function. → Read the source completely, fill [templates/instruction-worksheet.md](templates/instruction-worksheet.md), cross-reference shared-state code.
- **Mode 4 — Differential / PR-Scoped Audit.** A PR, commit range, or branch — not the whole tree. → Command `/auditor:diff-audit` (changed-set → Phase 0.5 on changed fns + 1-hop → risk-classify + git-blame removed guards → in-scope items through Rule 5b → dependency lane (checklist 11 §11.11) when a manifest or lockfile changed → `audit_<n>/PR-REPORT.md`).
- **Mode 5 — Spec-Compliance Audit.** A spec / whitepaper / RFC is supplied and you need code-vs-spec conformance. → Command `/auditor:spec-audit` (Spec-IR requirement list → map each instruction/state field → Compliance Matrix through the Rule 5b gate).

---

## Audit Flows (full engagement lifecycle)

Two flows run the traditional audit-company lifecycle over the skill's **existing** mechanisms (scope-gating → Phase 0.5 context → manual review → Rule 5b verification → Phase 4.5 maturity → report). Method: [references/audit-lifecycle/methodology.md](references/audit-lifecycle/methodology.md); how real firms work: [references/audit-lifecycle/firm-coverage.md](references/audit-lifecycle/firm-coverage.md). When a prior audit, an incident or a fork parent is detected, both flows also seed the threat model from history, offline ([references/audit-lifecycle/threat-model-bootstrap.md](references/audit-lifecycle/threat-model-bootstrap.md)).

- **`/auditor:audit-cycle`** — *fully automated audit team.* Runs the whole lifecycle autonomously: domain-partitioned `vuln-hunter` + `economic-analyst` (each self-triaging via Rule 5b + `false-positives.md` at the leaf) → independent `peer-reviewer` reconciliation on top-severity findings → `audit-reporter` synthesis → a client-facing report ([templates/audit-report.md](templates/audit-report.md)) at `audit_<n>/REPORT.md` (+ optional PDF via `"${CLAUDE_SKILL_DIR}/scripts/report-to-pdf.sh"`, pandoc-gated — MD is always the deliverable).
- **`/auditor:audit-assist`** — *AI-assisted, human-in-the-loop.* Same lifecycle, pausing at checkpoints to surface confirmed findings + next-focus + the questions only a human can answer (business context, trust model, severity calls); iterates until the audit document converges.
- **`/auditor:re-audit`** — *fix-review.* Diffs against a prior report: per-finding `FIXED` / `STILL-OPEN` / `REGRESSED`, plus a sibling-patch-propagation sweep (grep the codebase for the same anti-pattern the fix closed).

Honestly scoped: this is audit-shaped automation / a rigorous first pass, not a substitute for a human firm audit. The client report follows firm convention — maturity narrative + trust-model caveats + disclaimer — and does **not** issue a "safe to deploy" guarantee. *(Precedents: Neodyme independent dual-review, Trail of Bits weekly progress reports + code-maturity, Sec3 shift-left, Zellic importance-ordering, Zenith delta review.)*

---

## Detection & Response (post-incident track)

Everything above is pre-deployment. When a protocol may already have been attacked:

- **`/auditor:hunt`** — no alert to start from: snapshot the deployed programs, baseline the transaction history (finalized `getTransaction`, program logs, Geyser/indexer exports), record each hypothesis and its query in a ledger, check each suspect against the source deployed at the incident slot, reproduce on the real bytes → `incident_<n>/INCIDENTS.json` + `INCIDENT_REPORT.md`.
- **`/auditor:respond <lead>`** — a signature, address, alert, or `INC-<n>.<k>`: whether the attack landed, the damage per mint, the root cause, and a containment / remediation / recovery plan written for humans to carry out → `RESPONSE-INC-<n>.<k>.md`.

Verdicts follow the single normative ladder in [references/detection-response/README.md](references/detection-response/README.md#the-verdict-ladder-the-one-normative-copy). The track never signs, sends, or simulates against a public cluster.

---

## Rationalizations to Reject

An auditor talks itself out of real findings with lines like these. Treat each as a RED FLAG that demands the Rule 5b gate — not a reason to skip:

- "It's only devnet / a test program." → Audit as if mainnet; devnet code ships.
- "The math can't overflow because values are always small." → Prove the bound (Rule 5b Math/State-Bounds) or report it.
- "`init_if_needed` is fine here." → It permits reinitialization; prove the guard or flag it.
- "Only the admin can call this." → Confirm the signer/authority check exists in code; "should be" is not "is".
- "The client validates it." → On-chain must not trust off-chain validation.
- "This `unwrap()` can't fail." → On user/RPC input it can — that is a DoS (checklist 20).
- "It's the same as a well-known program." → Verify line-by-line; forks drift.

*(Scaffolding pattern credit: Trail of Bits `skill-improver`.)*

## When NOT to Use

- Writing new features or general (non-security) code — this skill only audits.
- As the sole gate for a mainnet launch — it is a thorough first pass; pair it with a human audit for business-logic, economic-model, and legal-compliance review.
- As formal proof of correctness — it flags where proofs/harnesses are missing (and can orchestrate them via `vendor/trailofbits`), but does not itself constitute a machine-checked proof.
- As an incident responder that acts — `/auditor:hunt` and `/auditor:respond` only propose; they never sign, send, pause, freeze or upgrade anything.
- Exercising a target's CI live — GitHub Actions review is static and read-only: never comment, open issues or PRs, push, or re-run jobs on the target ([references/vuln-classes/github-actions.md](references/vuln-classes/github-actions.md) §0).

---

## Language → Checklist Mapping

Authoritative mapping → **Scope-Gated Loading, Step 2** (scope table) above. Detected extension/marker → in-scope checklist set; always-applied (any repo): 11, 12, 13, 16, 17, 18.

---

## Checklists Reference

| # | Checklist | Items | Domain | File |
|---|-----------|-------|--------|------|
| 01 | Account Validation | 90 | On-chain | [01-program-account-validation.md](checklists/01-program-account-validation.md) |
| 02 | Access Control | 55 | On-chain | [02-program-access-control.md](checklists/02-program-access-control.md) |
| 03 | Arithmetic Safety | 63 | On-chain | [03-program-arithmetic-safety.md](checklists/03-program-arithmetic-safety.md) |
| 04 | CPI & PDA Safety | 70 | On-chain | [04-program-cpi-pda.md](checklists/04-program-cpi-pda.md) |
| 05 | State Machine & Lifecycle | 74 | On-chain | [05-program-state-machine.md](checklists/05-program-state-machine.md) |
| 06 | Economic & Logic Attacks | 92 | On-chain | [06-program-economic-logic.md](checklists/06-program-economic-logic.md) |
| 07 | OpSec & Governance | 87 | Operations | [07-program-opsec-governance.md](checklists/07-program-opsec-governance.md) |
| 08 | TypeScript Safety | 64 | Off-chain | [08-typescript-safety.md](checklists/08-typescript-safety.md) |
| 09 | Backend Security | 132 | Off-chain | [09-backend-security.md](checklists/09-backend-security.md) |
| 10 | Frontend Security | 84 | Off-chain | [10-frontend-security.md](checklists/10-frontend-security.md) |
| 11 | Supply Chain & Dependencies | 62 | DevOps | [11-supply-chain.md](checklists/11-supply-chain.md) |
| 12 | Secrets & Key Management | 53 | DevOps | [12-secrets-opsec.md](checklists/12-secrets-opsec.md) |
| 13 | Deployment & Infrastructure | 96 | DevOps | [13-deployment-infrastructure.md](checklists/13-deployment-infrastructure.md) |
| 14 | Python Safety | 82 | Off-chain | [14-python-safety.md](checklists/14-python-safety.md) |
| 15 | General Language Safety | 88 | Universal | [15-general-language-safety.md](checklists/15-general-language-safety.md) |
| 16 | Formal Verification & Testing | 73 | Universal | [16-formal-verification-testing.md](checklists/16-formal-verification-testing.md) |
| 17 | Logging, Monitoring & IR | 65 | Universal | [17-logging-monitoring-incident-response.md](checklists/17-logging-monitoring-incident-response.md) |
| 18 | Privacy, Compliance & Change Mgmt | 60 | Universal | [18-privacy-compliance-change-management.md](checklists/18-privacy-compliance-change-management.md) |
| 19 | AI Agent Security (Solana × AI) | 35 | AI / Agent | [19-ai-agent-security.md](checklists/19-ai-agent-security.md) |
| 20 | Rust Off-Chain Services | 21 | Off-chain | [20-rust-offchain-services.md](checklists/20-rust-offchain-services.md) |
| | **Total** | **1,446** | | |

---

## How to Use

### Full repository audit
```
Audit the entire repository using the auditor-skill with FULL scope
```

### Program-only audit
```
Audit the Solana program in programs/<your_program>/ using the auditor-skill with PROGRAM scope
```

### Specific checklist
```
Run auditor-skill checklist 03 (Arithmetic Safety) on programs/<your_program>/
```

### Backend audit
```
Run auditor-skill with BACKEND scope on apps/backend/
```

### Python project audit
```
Audit the Python code using auditor-skill checklist 14
```

### Any language
```
Run auditor-skill on this Go/Java/Ruby/PHP project — it will auto-detect and apply the right checklists
```

---

## Recording Format

For every checklist item, record one of: `[PASS]` · `[FAIL-N]` · `[PARTIAL]` · `[N/A]`.

Full verdict-format rules (what each token must cite): see [OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 4.

---

## Porting to Another Repository

This entire `auditor-skill/` folder is self-contained and portable:

1. Install the full `auditor-skill/` directory outside the target repository: the plugin, or a user-level skill such as `~/.claude/skills/auditor-skill` ([OUTPUT-RULES.md](OUTPUT-RULES.md) Rule 11e)
2. Record the target's folder structure at intake (`QUESTIONS.md` Q39 in-scope paths, Q44 exclusions) rather than editing `discovery/file-map.md`, which an update overwrites
3. Checklists 01-07: any Solana/Anchor program
4. Checklists 08-10: any TypeScript/Express/Next.js project
5. Checklist 14: any Python project
6. Checklist 15: Go, Java, Ruby, PHP, or any other language
7. Checklists 11-13: universal — any project, any language
8. OUTPUT-RULES.md: universal — applies to all audits regardless of tech stack

---

## References

- [Sealevel Attacks (coral-xyz)](https://github.com/coral-xyz/sealevel-attacks) — canonical Solana exploit examples
- [Neodyme: Common Pitfalls](https://neodyme.io/en/blog/solana_common_pitfalls/) — top 5 Solana contract vulnerabilities
- [Solana Security Course](https://solana.com/developers/courses/program-security) — official security curriculum
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — web application security baseline
- QEDGen SPEC Format — formal verification methodology (create your own SPEC.md following this structure)
- [SOC 2 Trust Service Criteria](https://en.wikipedia.org/wiki/SOC_2) — AICPA 5-category compliance framework
- [COBIT 2019](https://www.isaca.org/resources/cobit) — IT governance and control framework (ISACA)
- [CertiK Audit Methodology](https://www.certik.com/products/security-audit) — manual review + formal verification + Skynet monitoring
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) — A01-A10 application security risks
- [NIST SP 800-53](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final) — security and privacy controls catalog
