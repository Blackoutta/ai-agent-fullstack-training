# Orchestration — Deterministic Pre-Scan & Cross-Audit Memory

> **Load when:** running `audit-scan` (deterministic enumeration) or `audit-mem` (cross-audit memory). Both are **optional token-efficiency layers** — the skill works fully without them, falling back to the grep-based walk. Their job is to spend $0 of deterministic compute on the mechanical work so the LLM spends its tokens on *judgment*.

The tools live in `<auditor-skill root>/tools/auditor-tools/` (one Rust crate, two binaries). `<auditor-skill root>` is the absolute installation path the invoking command or skill gave you, never the working directory, which is usually the audited repo (`OUTPUT-RULES.md` Rule 11e). Build once:

```bash
cd "<auditor-skill root>/tools/auditor-tools" && cargo build --release
# binaries: <auditor-skill root>/tools/auditor-tools/target/release/audit-scan  and  …/audit-mem
```

The installation belongs outside the repository under audit (Rule 11e). If it sits inside it anyway (the `install.sh` default, `.claude/skills/auditor-skill`), that build runs inside the target tree, where cargo and rustup read the target's `.cargo/config*` and `rust-toolchain*` from every parent directory: build there only in Rule 11a isolated mode. Otherwise skip the build, note it, and ask the human to delete that copy and install a fresh one outside the repository (the plugin, or `install.sh ~/.claude/skills/auditor-skill`). Never move or update a copy found inside a repository (README, Installation).

In the commands below, `audit-scan` and `audit-mem` stand for those absolute binary paths. Never run them as a relative `tools/…` path.

If `cargo` is absent, skip both and note it — the audit proceeds on the native grep walk (`discovery/grep-commands.md`).

---

## `audit-scan` — enumerate the risky surface

```bash
audit-scan <program-path> --out audit_<n>/prescan.json      # or --pretty to stdout
```

It parses every `*.rs` (skipping `target/`, `.git/`, `node_modules/`) with a real Rust AST (`syn`) and emits ONE JSON:

| Key | What it gives the auditor |
|-----|---------------------------|
| `instructions[]` | every `#[program]` handler + its typed args → **seeds Phase 0.3 instruction matrix** |
| `accounts_structs[]` | every `#[derive(Accounts)]` struct, per-field parsed `#[account(...)]` constraints (`init`/`init_if_needed`/`mut`/`signer`/`has_one`/`seeds`/`bump`/`close`/`owner`/`token::*`/`realloc`) + `unchecked` flag for `UncheckedAccount` fields + raw text → **seeds checklists 01/04** |
| `pdas[]` | every `seeds = [...]` catalog → **seeds checklist 04 PDA review** |
| `arithmetic_sites[]` | every RAW `+ - * /` / `+= -= *= /=` with `file:line` → **the checklist-03 worklist** (LLM judges reachability; the tool does not) |
| `panic_sites[]` | `unwrap`/`expect`/index/`panic!` sites → **checklist 03 / DoS review** |
| `cpi_sites[]` | `invoke`/`invoke_signed`/`CpiContext` → **checklist 04 CPI review** |
| `remaining_accounts_sites[]` | `.remaining_accounts` field access → **checklist 01 remaining-accounts review** |
| `unsafe_blocks[]`, `functions[]` | `unsafe` surface + call-graph seed |

**How the auditor consumes it.** Load `prescan.json` at Phase 0. Treat it as a *map of where to look*, not a set of findings — it has **no verdicts**. Every reported site still goes through the normal checklist + Rule 5b reasoning. The win is twofold: (1) the instruction/constraint/PDA/arithmetic tables are already built, so Phase 0.2–0.4 cost near-zero; (2) a file with **zero** scan hits gets a spot-check instead of a full read. A raw arithmetic or panic site the scan surfaces is a *candidate*, never a confirmed bug — never report a `arithmetic_sites` entry as a finding without the checklist-03 reachability + bounds analysis.

**Honesty rule.** The scanner is a syntactic pass; it does not resolve macros, generics, or cross-crate types. It under-reports (macro-generated handlers, trait-dispatched CPIs) and over-reports (raw arithmetic on already-bounded operands). State in the report that a deterministic pre-scan seeded the review, and that its output was verified — not trusted — by the item-by-item walk.

---

## Evidence-driven load gating (advisory)

The prescan is also a **relevance map**: when a signal is a *provably-empty* set, the corpus that only exists to catch that feature can be **deprioritized / skip-deferred** — its checklist items and vectors render `[N/A — feature absent: <marker>]` from the gate instead of consuming a full read. This is a token-efficiency layer over the same completeness guarantee (OUTPUT-RULES Rule 0). It maps 1:1 to the `known-vectors/INDEX.md` "Load when (markers)" column and to the feature-gated checklist notes.

| Prescan signal (provably empty) | Deprioritized / skip-deferred corpus | Re-open trigger (fires on the MANUAL READ, not just the prescan) |
|---------------------------------|--------------------------------------|-----------------------------------------------------------------|
| `cpi_sites: []` | checklist 04 CPI sections (§4.1–4.2, CPI-target/reentrancy items) + KV CPI cluster (003 reentrancy, 009 unchecked CPI target) | eyes hit `invoke` / `invoke_signed` / `CpiContext` / any cross-program call in source |
| `pdas: []` | PDA-confusion vectors (010 type-cosplay, 026 seed-collision, 104 non-canonical bump) + checklist 04 §4.3–4.4 (PDA derivation) | eyes hit `seeds =` / `find_program_address` / `create_program_address` |
| no `token_2022` / `transfer_hook` / `TransferFee` / `get_extension` (grep + no `token::*` T22 hits) | token-2022 methodology (`references/methodologies/token-2022.md`, incl. §9 Token ACL) + KV 018 (fee-on-transfer), 023 (transfer-hook), 105 (extension abuse), 134 (Token ACL gate bypass) + checklist 01 §1.8 | eyes hit `spl_token_2022` / `get_extension` / `InterfaceAccount` over a T22 mint / any extension type / `token_acl` / `gating_program` |
| no `pyth` / `switchboard` (grep, incl. `PriceUpdate` / `PullFeed` / `get_price`) | oracles methodology (`references/methodologies/oracles.md`) + KV 005 (oracle manipulation) + checklist 06 §6.9 (oracle) | eyes hit `pyth` / `switchboard` / any oracle account read or price feed |
| no `realm` / `proposal` / `spl-governance` (grep, incl. `vote_record` / `voter_weight`) | governance methodology (`references/methodologies/governance.md`) + KV 021 (vote buying), 119 (durable-nonce governance) | eyes hit `spl-governance` / `realm` / `proposal` / vote-weight logic |
| no `guardian` / `vaa` / `emitter` (grep, incl. `verify_signatures` / `attestation`) | bridges methodology (`references/methodologies/bridges.md`) + KV 022 (fake-proof bridge) | eyes hit `guardian` / `vaa` / `emitter` / cross-chain message verification |
| no `tokenlist` / `assetId` / `getTokenBySymbol` / `riskScore` / `trustTier` (grep, incl. `tokens.xyz` / `rugcheck` / `webacy` / `isVerified`) | token-registry methodology (`references/methodologies/token-registry-risk.md`) + KV 132 (canonical-asset spoofing), 133 (risk-score farming) | eyes hit any symbol→mint resolution, a fetched token list, or a grade / tier / `verified` flag used in a decision |
| no `getTransaction` / `getBlock` / `blockSubscribe` / `yellowstone` / `geyser` / `ComputeBudget` / fee-payer service (grep, incl. `maxSupportedTransactionVersion` / `sponsor` / `paymaster` / `load_instruction_at`+`compute_budget`) | transaction-v1 vuln class (`references/vuln-classes/transaction-v1.md`) + KV 135 (sponsor cap bypass / disabled ComputeBudget gates), 136 (reader wedge / zero-budget indexing) + checklist 20 §20.6, 09 §9.18, 13 §13.12 | eyes hit any RPC transaction / block read, a Geyser stream, a service that signs as fee payer, or ComputeBudget introspection in a program |
| no `.github/workflows/*.y*ml` / `action.y*ml` (grep — `audit-scan` does not parse YAML), **or** workflows exist but none uses `pull_request_target` / `workflow_run` / `issue_comment` / `pull_request_review*` / `discussion*` / `issues` / `gollum` as a trigger and none runs an AI-agent action or CLI | GitHub Actions vuln class (`references/vuln-classes/github-actions.md`) + KV 139 (comment-triggered gating), 140 (`workflow_run` / `pull_request_target` pwn request) + checklist 13 §13.13 (DEP-090..096) + checklist 19 AI-034..035 | eyes hit any workflow, composite action or reusable-workflow `uses:` with one of those triggers, or an agent CLI (`claude -p`, `codex exec`) in a `run:` step |
| `unsafe_blocks: []` **and** Anchor detected | checklist 01 §1.10 (native/Pinocchio no-Anchor safety) + KV 109 (Pinocchio/p-token manual validation) | eyes hit `unsafe` / `pinocchio` / `p-token` / manual zero-copy account casting |
| `panic_sites: []` | checklist 03 DoS spot-check (unwrap/expect/index items) + KV 025 (compute-budget DoS), 111 (BPF stack overflow DoS) | eyes hit `unwrap()` / `expect()` / indexing / `panic!` / unbounded loop over user input |
| no `init_if_needed` in any `accounts_structs[].fields[].constraints` | KV 014 (account reinitialization), KV 127 (init front-running) + checklist 01 AV-023/AV-024 | eyes hit `init_if_needed` in any `#[account(...)]` |
| `remaining_accounts_sites: []` **and** no `unchecked: true` fields | checklist 01 remaining-accounts / manual-validation items + KV 027 (missing discriminator) | eyes hit `.remaining_accounts` or `UncheckedAccount` / bare `AccountInfo` |

**Two hard safety properties — do not weaken either:**

**(a) Gate on PROVABLE ABSENCE only.** An empty array means *the scanner found zero sites of that kind* — that, plus a confirming grep over the in-scope tree, is the only thing that justifies a skip-defer. Never skip-defer because a surface "looks low-risk" or "is probably fine"; low-likelihood is a Rule 5b judgment on an OPENED item, not a reason to skip loading it.

**(b) The prescan under-reports, so the re-open trigger fires on the MANUAL READ.** By its own honesty rule the scan misses macro-generated handlers and trait-dispatched CPIs. Therefore a skip-defer is **provisional**: the moment the auditor's eyes land on a marker the scan missed (a `CpiContext` behind a macro, a `get_extension` behind a helper), the corresponding cluster loads immediately and every item in it gets a verdict. The gate can only ever *defer* a read to the point of first evidence — it can never make a bug unreachable.

---

## `audit-mem` — cross-audit memory (dedup · regression · FP suppression · warm re-audits)

A local SQLite store (default `.audit-memory/audit.db`, self-ignored per Rule 11d; `--db <path>` selects another). Findings are **content-addressed**: `finding_id = sha256(program_id ‖ code_signature ‖ root_cause)`, so the *same* bug keeps its identity across commits and line drift (the same normalized signature `/re-audit` uses for its sibling sweep).

```bash
audit-mem init
audit-mem put-finding --program-id <id> --signature <sig> --root-cause <rc> \
    --title <t> --severity <n> [--commit <sha>] [--audit-n <n>] [--file <f>] [--line <n>] [--verdict <v>]
audit-mem set-status --program-id <id> --signature <sig> --root-cause <rc> --status FIXED|OPEN|ACKNOWLEDGED|DISPUTED
audit-mem rule  --program-id <id> --signature <sig> --ruling FALSE_POSITIVE|ACCEPTED_RISK --rationale <r> --by <who>
audit-mem check --program-id <id> --signature <sig>       # exit 0 = suppressed by a ruling, 1 = not
audit-mem regressions --program-id <id>                    # findings that went FIXED → re-observed
audit-mem warm --program-id <id>                           # {profile, invariants[], open_fp_rulings[]}
```

**Use only a store you created.** The default store sits under the working directory, which during an audit is the target repository, so a store found there is not necessarily yours. Before using `.audit-memory/`, run `GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false --icase-pathspecs ls-files -- .audit-memory` in the audited repository: it must print nothing and exit 0, and the store must be one you created, in this run or an earlier audit. Run it before creating `.audit-memory/.gitignore` and again before every `audit-mem` use, since a later pull can change the answer. Any output, in any letter case, or any error means: do not read it; start a fresh store outside the target tree by passing `--db <path outside the tree>` to every `audit-mem` call, and never overwrite a tracked `.audit-memory/.gitignore` (`OUTPUT-RULES.md` Rule 11d).

Once the store passes that check, write `.audit-memory/.gitignore` containing `*` before the first `audit-mem` call of a run — `mkdir -p .audit-memory && printf '*\n' > .audit-memory/.gitignore` (Rule 11d). The tool creates the directory itself, and the intake warm-up is often its first call.

Where each phase uses it:

- **Intake / Phase 0** — `audit-mem warm --program-id <id>` injects the prior protocol profile, known invariants, and open false-positive rulings. A re-audit starts **warm** instead of from zero.
- **Before emitting a finding** — `audit-mem check` by signature. An authoritative `FALSE_POSITIVE` ruling **auto-suppresses** the finding to `[N/A — prior ruling]` (record the ruling id). This is the biggest recurring-token saver on re-audits: the opus agents never re-litigate a settled false positive.
- **Triage / synthesis** — `put-finding` records an occurrence per run. A `finding_id` previously `FIXED` and now re-observed is auto-marked **`REGRESSED`** (deterministic, not LLM-judged) — feeds the `/re-audit` finding-diff and the "regressions since last audit" report section.

**Exactness over similarity.** This store is the source of truth for dedup, regression state, and FP rulings because those must be *auditable* ("suppressed by ruling #14, dated X"). Semantic recall (memsearch, "have we seen a bug shaped like this?") is a *secondary* fuzzy index over descriptions — never the authority for suppression or regression.

**Never suppress silently across trust boundaries.** An `ACCEPTED_RISK` or `FALSE_POSITIVE` ruling is scoped to its `program_id`; do not carry a client's ruling into a different codebase, and always surface suppressed items in an appendix so a reviewer can see what was withheld and why.
