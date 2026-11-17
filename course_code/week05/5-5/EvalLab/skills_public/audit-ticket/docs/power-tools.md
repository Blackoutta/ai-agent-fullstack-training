# Power Tools

The tooling that makes auditor-skill more than a prompt: a deterministic pre-scanner, cross-audit memory, vendored SAST/fuzz/coverage/mutation, mainnet-fork economic sim, the PoC/patch harness stack, and the bundled scripts the commands run. Back to the [docs index](README.md).

Every tool here is an **optional layer**. The corpus works fully without any of them — each one either saves tokens, adds memory, or upgrades an asserted finding to a demonstrated one, and degrades gracefully (with a named blocker) when absent.

| Tool | Buys you | Built/enabled by |
|------|----------|------------------|
| [`audit-scan`](#audit-scan) | ~30-40% fewer input tokens; a map of the risky surface | `cargo build --release` |
| [`audit-mem`](#audit-mem) | exact de-dup, regression detection, FP suppression, warm re-audits | `cargo build --release` |
| [Trail of Bits plugins](#trail-of-bits-plugins) | real SAST, fuzzing, coverage, mutation | plugin install or `install.sh`; else `git submodule update --init --depth 1 -- vendor/trailofbits` |
| [Surfpool sim](#surfpool-economic-simulation) | a real $ P/L for economic findings | `surfpool` CLI + MCP |
| [PoC/patch harness](#pocpatch-harness-stack) | executable exploits + verified fixes | platform-tools ≥ v1.54 |
| [Bundled scripts](#bundled-scripts) | incident corpus collection and queries, the threat-model history collector, the Trail of Bits bump review | nothing to build: bash ≥ 3.2, plus `jq`, `python3`, `curl` or the `solana` CLI per script |

---

## audit-scan

A deterministic Rust AST pass (`syn` with `span-locations`, so every hit carries a real line number) that emits the *risky surface* of a Solana/Anchor codebase as one JSON — so the LLM auditor spends tokens on **judgment**, not mechanical enumeration.

### Run it

Build once, then run the binary by its absolute path from the repository under audit. `<auditor-skill root>` is the directory auditor-skill is installed in, never a path relative to your project ([`OUTPUT-RULES.md` Rule 11e](../OUTPUT-RULES.md#11e--bundled-paths)):

```bash
cd "<auditor-skill root>/tools/auditor-tools" && cargo build --release        # once
"<auditor-skill root>/tools/auditor-tools/target/release/audit-scan" ./programs/my-program/src --pretty --out audit_1/prescan.json
```

The installation belongs outside the repository under audit. If it sits inside it anyway (the `install.sh` default, `.claude/skills/auditor-skill`), the build runs inside the target tree, where cargo and rustup read the target's `.cargo/config*` and `rust-toolchain*` from every parent directory. Build there only in [Rule 11a](../OUTPUT-RULES.md#rule-11-operating-safety) isolated mode, or delete that copy and install a fresh one outside the repository (the plugin, or `install.sh ~/.claude/skills/auditor-skill`) and build that one. Never move or update a copy you find inside a repository ([README](../README.md#installation)).

Recursively walks `*.rs` (skipping `target/`, `.git/`, `node_modules/`), parses each with `syn::parse_file`, prints one JSON object to stdout or `--out FILE`. Files that fail to parse are skipped (best-effort).

### What it extracts

| Key | Seeds |
|-----|-------|
| `instructions[]` | every `#[program]` handler + typed args (the Anchor `Context<..>` param dropped) → Phase 0.3 instruction matrix |
| `accounts_structs[]` | every `#[derive(Accounts)]` struct; each field's parsed `#[account(...)]` constraints (`init`/`init_if_needed`/`mut`/`signer`/`has_one`/`seeds`/`bump`/`close`/`owner`/`token`/`associated_token`/`realloc`) + `unchecked` flag for `UncheckedAccount` fields + raw text → checklists 01/04 |
| `pdas[]` | every `seeds = [...]` catalog → checklist 04 PDA review |
| `arithmetic_sites[]` | every RAW `+ - * /` / `+= -= *= /=` (NOT `.checked_*`) with `file:line` → the checklist-03 worklist |
| `panic_sites[]` | `.unwrap()`/`.expect()`/index `x[y]`/`panic!`/`unreachable!`/`unwrap!` → checklist 03 / DoS review |
| `cpi_sites[]` | `invoke`/`invoke_signed`/`CpiContext` → checklist 04 CPI review |
| `remaining_accounts_sites[]` | `.remaining_accounts` field access → checklist 01 remaining-accounts review |
| `unsafe_blocks[]`, `functions[]` | unsafe surface + call-graph seed |

### The one rule: it is a map, not a verdict

The scan output has **no verdicts**. A raw `arithmetic_sites` or `panic_sites` entry is a *candidate*, never a confirmed bug — it still goes through the checklist + Rule 5b reachability/bounds analysis. Never report a scan hit as a finding on its own.

It is a syntactic pass: it does not resolve macros, generics, or cross-crate types, so it **under-reports** (macro-generated handlers, trait-dispatched CPIs) and **over-reports** (raw arithmetic on already-bounded operands). The report must state that a deterministic pre-scan seeded the review and its output was *verified, not trusted*, by the item-by-item walk.

### The token win

Feed `prescan.json` to the auditor at Phase 0. Two effects: (1) the instruction/constraint/PDA/arithmetic tables are already built, so Phase 0.2-0.4 cost near-zero; (2) a file with **zero** scan hits gets a spot-check instead of a full read. This collapses the mechanical multipliers (checklist cross-ref ~0.3×, discovery ~0.2×, checkpoint re-reads ~0.1×) toward ~0.1× total — on a 50K-line program roughly **200-300K fewer input tokens** (variable multiplier ~1.6× → ~1.0×; e.g. Opus ≈ $32 → ~$20 per [COSTS.md](../COSTS.md)). Used at Phase 0 of the automated flow and by `context-builder`; falls back to the grep walk when `cargo` is absent.

Reference: [`references/orchestration/pre-scan.md`](../references/orchestration/pre-scan.md).

---

## audit-mem

A local SQLite findings store (default `.audit-memory/audit.db`, self-ignored ([Rule 11d](../OUTPUT-RULES.md#11d--output-hygiene)); schema created lazily) for cross-audit memory. It is the **authoritative** source for de-dup, regression state, and FP rulings — because those must be *auditable* ("suppressed by ruling #14, dated X").

### Content-addressed identity

```
finding_id = sha256(program_id ‖ code_signature ‖ root_cause)
```

The same bug keeps its identity across commits and line drift — the same normalized signature `/auditor:re-audit` uses for its sibling sweep, and `/auditor:triage` uses for root-cause de-dup.

### The four capabilities

- **Exact de-dup** — two candidates with the same `finding_id` are one finding (all locations recorded). `/auditor:triage` collapses them.
- **Regression detection** — when `put-finding` re-observes a finding whose stored status was `FIXED`, it transitions to `REGRESSED` and prints `REGRESSED <id>` (deterministic, not LLM-judged). `audit-mem regressions --program-id <id>` lists them → the `/auditor:re-audit` finding-diff and the report's "regressions since last audit" section.
- **False-positive suppression** — `audit-mem rule ... --ruling FALSE_POSITIVE` records a ruling; `audit-mem check` gates on it (exit 0 = suppressed). Before emitting a finding, `/auditor:triage` runs `check` by signature — an authoritative ruling auto-suppresses it to `[N/A — prior ruling #<id>]`. The opus agents never re-litigate a settled false positive: the biggest recurring-token saver on re-audits.
- **Warm re-audits** — `audit-mem warm --program-id <id>` returns `{profile, invariants[], open_fp_rulings[]}` so a re-audit starts warm, not from zero. Used at intake / Phase 0 and by `threat-modeler`.

### Lifecycle example

Use an in-tree store only if you created it and the [Rule 11d](../OUTPUT-RULES.md#11d--output-hygiene) check passes: `GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false --icase-pathspecs ls-files -- .audit-memory`, run in the repository under audit, prints nothing and exits 0. Any output, in any letter case, or any error means: do not use that store, and pass `--db <path outside the tree>` instead. Run the check before writing `.audit-memory/.gitignore` (containing `*`) and before every `audit-mem` use. The example uses the in-tree store, so it runs from the repository under audit; `audit-mem` stands for `"<auditor-skill root>/tools/auditor-tools/target/release/audit-mem"`.

```bash
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false --icase-pathspecs ls-files -- .audit-memory   # must print nothing and exit 0; repeat before each call
mkdir -p .audit-memory && printf '*\n' > .audit-memory/.gitignore
audit-mem --db .audit-memory/audit.db init

# first observation -> "OPEN <id>"
audit-mem put-finding --program-id VaultProg... --signature 'unchecked_sub@vault.balance' \
  --root-cause 'unchecked subtraction can underflow vault balance' \
  --title 'Vault balance underflow' --severity 3 --commit c0ffee1 --audit-n audit-1 \
  --file src/withdraw.rs --line 42 --verdict TRUE_POSITIVE

# dev fixes it
audit-mem set-status --program-id VaultProg... --signature 'unchecked_sub@vault.balance' \
  --root-cause 'unchecked subtraction can underflow vault balance' --status FIXED

# next audit re-observes -> "REGRESSED <id>"
audit-mem put-finding --program-id VaultProg... --signature 'unchecked_sub@vault.balance' \
  --root-cause 'unchecked subtraction can underflow vault balance' \
  --title 'Vault balance underflow' --severity 3 --commit c0ffee3 --audit-n audit-3

# suppress a known FP, then gate on it
audit-mem rule --program-id VaultProg... --signature 'unchecked_sub@vault.balance' \
  --ruling FALSE_POSITIVE --rationale 'guarded by prior require!' --by auditor
audit-mem check --program-id VaultProg... --signature 'unchecked_sub@vault.balance'
#   -> {"suppressed":true,"ruling":{...}}   (exit 0)
```

### Subcommands

`init` · `put-finding` · `set-status` (`FIXED`|`OPEN`|`ACKNOWLEDGED`|`DISPUTED`) · `rule` (`FALSE_POSITIVE`|`ACCEPTED_RISK`) · `check` · `regressions` · `warm`. `--db` defaults to `.audit-memory/audit.db`. Schema: `findings`, `occurrences`, `fp_rulings`, `invariants`, `protocol_profile`.

### Exactness over similarity

This store is the source of truth *because* suppression and regression must be auditable and deterministic. Semantic recall ("have we seen a bug shaped like this?") is a **secondary fuzzy index** over descriptions — never the authority for suppression or regression. And rulings are **scoped to their `program_id`**: never carry a client's ruling into a different codebase, and always surface suppressed items in an appendix.

Reference: [`references/orchestration/pre-scan.md`](../references/orchestration/pre-scan.md) · [`tools/auditor-tools/README.md`](../tools/auditor-tools/README.md).

---

## Trail of Bits plugins

auditor-skill's corpus is the **knowledge** layer; Trail of Bits (vendored at `vendor/trailofbits`, CC-BY-SA — a reference, not a copy) is the **execution** layer — tools prose + grep cannot run. The plugin install and `install.sh` fetch it at the pinned commit, which the [README](../README.md#tool-execution-trail-of-bits--optional-rust-tools) names and which moves only through the review in [CONTRIBUTING.md §5](../CONTRIBUTING.md#5-tooling-changes). For any other clone, initialize it from the auditor-skill directory:

```bash
git submodule update --init --depth 1 -- vendor/trailofbits
test -d "<auditor-skill root>/vendor/trailofbits/plugins" && echo present    # the detection agents use
git ls-tree HEAD vendor/trailofbits                   # the pinned commit, initialized or not
```

Agents delegate when present, fall back to native grep when absent (and note "deeper tooling available via `git submodule update --init --depth 1 -- vendor/trailofbits`, run in the auditor-skill directory (plugin and install.sh installs already include it)" in the report).

Rows that build or run target code follow the execution mode recorded at intake ([`OUTPUT-RULES.md` Rule 11a](../OUTPUT-RULES.md#rule-11-operating-safety)); rows that send code or dependency data to an outside service are listed in the report (Rule 11b).

**Instruction files.** Trail of Bits ships a root `CLAUDE.md` that imports its contributor guide (`@AGENTS.md`, ~20 KB). When the submodule sits inside the project you run Claude Code in, that guide loads into the session the first time it reads a file under `vendor/trailofbits/`. To keep it out, add `"claudeMdExcludes": ["**/vendor/trailofbits/CLAUDE.md", "**/vendor/trailofbits/**/AGENTS.md"]` to your own `.claude/settings.local.json` — never to a client's committed `settings.json`.

### Capability → plugin → who uses it

| Capability | ToB plugin | auditor-skill use | Native fallback |
|------------|------------|-------------------|-----------------|
| Interprocedural SAST (taint) | `static-analysis`, `semgrep-rule-creator`, `variant-analysis` | `vuln-hunter` runs SAST, folds SARIF into verdicts; up-front in `audit-cycle` to clear the mechanical surface. A CodeQL build compiles the target (11a) | `discovery/grep-commands.md` |
| Property / fuzz harnesses | `testing-handbook-skills`, `property-based-testing` | generate + run a harness for any ≥High arithmetic/economic finding; `/auditor:poc` orchestrates (11a) | checklist 16 "does the suite exist" prose |
| Coverage & mutation | `testing-handbook-skills`, `mutation-testing` | evidence-back FV coverage; an uncaught mutant downgrades a PASS; `/auditor:patch --verify-with-mutation` uses a caught mutant as fix evidence (11a) | FV items `[PARTIAL — not machine-verified]` |
| Exploitability verify | `fp-check` (local); `second-opinion` sends the selected code to an external LLM CLI — OpenAI Codex or Google Antigravity / Gemini — so the report records it (11b) | `peer-reviewer` + `poc-engineer` confirm a finding is real, not a harness artifact | manual re-derivation |
| Secret zeroization (IR) | `zeroize-audit` | verify KV-112 / RS-015 at the IR level; compiles the target (11a) | grep `zeroize`/`Zeroizing` |
| Constant-time | `constant-time-analysis` | secret-dependent branches when custom crypto is present; compiles the code it checks (11a) | note "manual review needed" |
| Entry-point enumeration | `entry-point-analyzer` | seed the Phase 0 instruction matrix (Solana support) | manual `#[instruction]` enumeration |
| Supply-chain metadata | `supply-chain-risk-auditor` | enrich checklist 11 (SC-044..046); npm / PyPI / Go only. Its collector sends the project's dependency names to 8 outside services (OSV, npm registry + downloads API, PyPI, Go module proxy, deps.dev, GitHub API, OpenSSF Scorecard), so the report records it (11b); `--offline` only replays cached responses and is not a privacy control | `npm audit` / `cargo audit` + grep |
| Unit / dimensional analysis | `dimensional-analysis` | propagate units through DeFi value paths (checklist 03/06) — catches mixed-decimals bugs | manual per-quantity tracking |
| Insecure-default trace | `insecure-defaults` (a command + Workflow, `/insecure-defaults:audit`, that runs only with the ToB plugin installed; from the vendored tree, read its `references/*.md`) | fail-open vs fail-secure trace (checklist 12/13) | grep fallback-secret patterns |
| API misuse / footguns | `sharp-edges` | misuse-resistance review of the program's own CPI interface + config | `references/framework-idioms/*` |
| Fix blast-radius | `differential-review` | `/auditor:patch` step 4: the fix closes the exploit path and leaves every other path unchanged | `/auditor:re-audit` 4b differential execution (11a) + manual caller / sibling review |

**FV/harness escalation ladder** (from [methodology §6](../references/audit-lifecycle/methodology.md)): manual → proptest on pure fns → **Trident stateful sequences (the primary bug-finder)** → Certora/Kani reserved for the 3-10 catastrophic invariants → MIRAI/Clippy. Skip deductive FV when the target is dominated by an untrusted CPI (the callee is a hole in the proof) — mock the boundary adversarially in Trident instead and note the abstention.

**The rule:** delegation *augments*, never replaces, the native verdict. Every finding still carries an auditor-skill verdict and (if N≥6) a filled Rule 5b gate. Tool output is evidence, not a verdict. Reference: [`references/orchestration/boundary-map.md`](../references/orchestration/boundary-map.md).

---

## Surfpool economic simulation

For economic / oracle / MEV findings, a yes/no isn't proof — Rule 5b wants a dollar figure. `/auditor:economic-sim` (driven by `economic-analyst`) models capital/setup cost, extractable value, atomicity, and flash-loanable ceilings, then — when a Surfpool mainnet-fork is reachable — reproduces **deposit → manipulate → withdraw** against forked real pool state for a recorded net **P/L**.

```
/auditor:economic-sim F-003
/auditor:poc F-003 --fork     # build the executable Surfpool PoC → [PoC-SIM-REPRODUCED]
```

Enabled by the `surfpool` CLI + its MCP (keyless). The fork fetches mainnet state from its RPC datasource, which receives the program ids and account addresses the simulation reads, so the report names that provider's domain ([Rule 11b](../OUTPUT-RULES.md#11b--outside-service-disclosure)). Absent → fall back to Mollusk/LiteSVM if the logic is modelable, else `[PoC-ATTEMPTED]` with the blocker named ("surfpool CLI + MCP unreachable / fork state unavailable"). See [poc-and-patches.md](poc-and-patches.md#framework-selection).

---

## PoC/patch harness stack

The stack that turns confirmed findings into executable exploits (`/auditor:poc` → `poc-engineer`) and verified fix patches (`/auditor:patch` → `patch-engineer`), writing to `audit_<n>/poc/F-xxx/` and `audit_<n>/patches/F-xxx.patch`.

Frameworks by finding type — **Mollusk** (single-instruction logic/access-control), **LiteSVM** (multi-step lifecycle), **Surfpool** (economic, fork), **Trident/cargo-fuzz** (fuzz-discoverable) — with evidence tiers `[PoC-REPRODUCED]` > `[PoC-SIM-REPRODUCED]` > `[PoC-FUZZ-REPRODUCED]` > `[PoC-ATTEMPTED]` > `[PoC-PROSE]` and fix tiers `[FIX-VERIFIED]` > `[FIX-INSUFFICIENT]` > `[FIX-PROPOSED]`.

Toolchain gate: **`cargo build-sbf` platform-tools ≥ v1.54** (the default v1.51/cargo 1.84 bundle cannot parse the `edition2024` manifests in modern `mollusk-svm`/`litesvm` — pass `--tools-version v1.54`). Never hard-fails: any absence → `[PoC-ATTEMPTED]` + the prose PoC is kept; downgrading the evidence tier never downgrades the finding's severity.

Full walkthrough — layout, framework matrix, tiers, the "executable outranks prose but prose is never removed" rule, toolchain requirements: **[poc-and-patches.md](poc-and-patches.md)**. Reference: [`references/orchestration/poc-harness.md`](../references/orchestration/poc-harness.md).

---

## Bundled scripts

Shell and Python scripts that ship with auditor-skill; there is nothing to build. The commands run them by absolute path from the installation, never by a `scripts/` path relative to the audited repository ([Rule 11e](../OUTPUT-RULES.md#11e--bundled-paths)), and run the Python ones as `python3 -I`. The shell scripts run under bash 3.2 or later. The blocks below give each script's arguments, exit codes, network use and outputs.

### Detection & response recipes (`scripts/dnr/`)

The recipes behind `/auditor:hunt` and `/auditor:respond` ([detection-response.md](detection-response.md); method and hazards: [`scripts/dnr/README.md`](../scripts/dnr/README.md)). They summarise a transaction corpus without reading it into context. The two that use the network take the endpoint from `$RPC_URL` in the environment, never from the command line, and hand it to curl or the `solana` CLI through a config, never as an argument.

#### `snapshot-program.sh`

```bash
bash "<auditor-skill root>/scripts/dnr/snapshot-program.sh" <program_id> <incident_dir>
```

Step 1 of every hunt and response: it keeps the deployed program bytes before a hotfix can replace them. It runs `solana program show` and `solana program dump`, or `solana program-v4 show` and `download` for a loader-v4 program. It reads the program again after the dump and dumps once more if the last-deployed slot moved. It checks the ELF header, hashes the dump the way `solana-verify` does (trailing zero padding trimmed, then sha256), and prints a ledger line: `program=… owner=… last_deployed_slot=… authority=… sha256_zero_trimmed=… elf_bytes=… padding_bytes=… file=bin/<id>[@<slot>].so`. A program on an immutable loader shows `last_deployed_slot=n/a (immutable loader)` and `authority=none`.

- **Arguments:** a base58 program id (32 bytes) and the incident directory. No flags.
- **Exit:**
  - 0: a new snapshot, or `unchanged`.
  - 2, refused before any CLI call:
    - a usage error;
    - an id that is not base58 or not 32 bytes;
    - no `$RPC_URL`, or one that holds a quote, a backslash, whitespace or a control character;
    - a run directory that is a symbolic link, contains one, is tracked by git, or that git or find cannot check (the check fails closed).
  - 3, a named blocker:
    - no `solana` CLI or `python3`;
    - the CLI did not take the keyless config;
    - a CLI error, or no program under any loader;
    - a dump without the ELF magic;
    - a slot that moved during both dumps;
    - a hash that could not be computed;
    - a snapshot name already taken, or a lone `bin/<id>.show.txt`.
- **Network:** read-only `solana` CLI calls to `$RPC_URL`, which reaches the CLI through a temporary `-C` config with no usable keypair path; it signs nothing. CLI errors pass through `redact.sh`.
- **Writes:** in `<incident_dir>/bin/`:
  - The first snapshot is `<id>.so` with `<id>.show.txt`.
  - If the slot and zero-trimmed sha256 match a kept snapshot, a later run prints `unchanged: …` with that snapshot's line and writes nothing.
  - After a redeploy it keeps the new bytes as `<id>@<slot>.so` with its `.show.txt` and prints the first snapshot's line and the new one.
  - A kept file is never replaced.
  - An `incident_*` directory without a `.gitignore` gets one containing `*` (Rule 11d).
- **Needs:** the `solana` CLI and `python3`, which hashes the dump as `python3 -I`.

#### `collect.sh`

```bash
bash "<auditor-skill root>/scripts/dnr/collect.sh" --out <dir> --confirmed [--since <unix>] [--until <unix>] \
  [--before <signature>] [--max-pages N] [--max-tx N] -- <address> [<address> ...]
```

The one gated collector: it pages each address's signature history, failed transactions included (they are evidence of attempts), and fetches every transaction in the window into a local JSONL corpus, newest first.

| Flag | Meaning |
|------|---------|
| `--out <dir>` | corpus directory (required). One that holds `signatures.jsonl`, `transactions.jsonl` or `collection-gaps.tsv`, even an empty one, is refused, so a resume goes into a new directory |
| `--confirmed` | required; the commands pass it only after a person has approved the addresses, the window, the caps and the estimated call count |
| `--since <unix>`, `--until <unix>` | the window, on `blockTime`; `0` (the default) leaves that end open |
| `--before <signature>` | start paging just older than this signature: resume a capped run, or skip activity after the incident |
| `--max-pages N` | pages of up to 1,000 signatures per address (default 20). An empty page ends that address's history; a page of fewer than 1,000 ends it only on the last page the cap allows, since a node can return a short page before the end, so a history that ends inside the cap costs one more call |
| `--max-tx N` | `getTransaction` calls in total, failures included (default 2000); the oldest signatures are left out first. After 10 failed calls in a row the run stops |
| `-- <address> ...` | the base58 addresses to page |

- **Exit:**
  - 0: done, collection gaps included.
  - 2, refused before anything is written or sent:
    - no `--confirmed`;
    - a usage error or an unknown argument;
    - no `$RPC_URL`, or one that holds a quote, a backslash, whitespace or a control character;
    - an address or `--before` value that is not base58;
    - a number that is not a plain integer;
    - an `--out`, or the nearest `incident_*` directory at or above it, that is a symbolic link, contains one, is tracked by git (in any letter case), or that git or find cannot check;
    - an `--out` that already holds a corpus file.
  - 3, a named blocker:
    - no curl or jq;
    - a jq that rounds large integers and no working `python3`;
    - no private temp directory.
- **Network:** read-only JSON-RPC to `$RPC_URL` (`getSignaturesForAddress`, then `getTransaction` at `finalized` with `maxSupportedTransactionVersion: 1`), and only with `--confirmed`. The URL reaches curl through a config on stdin (`curl -q -K -`), never as an argument. The `provider:` line names the provider's domain (the host's last two labels) for the Rule 11b disclosure; curl errors pass through `redact.sh`.
- **Writes:** `<dir>/signatures.jsonl`, `<dir>/transactions.jsonl` and `<dir>/collection-gaps.tsv`.
  - `transactions.jsonl` is written by jq only when a test round-trip shows jq keeps 64-bit integers exact (a check of behaviour, not of the version); otherwise it is written by `python3 -I`.
  - `collection-gaps.tsv` has one `<signature or address><TAB><reason>` row per gap: a failed `getTransaction`, a failed signature page (older history not collected), a page cap that stopped on a full page, where older history may exist (with the `--before` to resume from), the `--max-tx` cap, or the stop after 10 failed calls in a row.
  - stdout ends with `collection gaps: N (see …)`. Notices go to stderr and start with `  ! `.
  - An `incident_*` directory (`<dir>` or its parent) without a `.gitignore` gets one containing `*`.
- **Needs:** curl and jq; `python3` too when jq rounds large integers (before jq 1.7).

#### `profile.sh`

```bash
bash "<auditor-skill root>/scripts/dnr/profile.sh" <corpus.jsonl> [<corpus.jsonl> ...]
```

The baseline of one or more `getTransaction` JSONL corpora, such as every `incident_<n>/corpus*/transactions.jsonl`, counting each signature once. It reads structural fields only, never log text, and reports the succeeded / failed split, the transaction-version histogram, the `blockTime` window, and the top 20 fee payers, signers and top-level programs. It keeps the first occurrence of each signature and skips malformed lines; closing `-- skipped` lines give both counts.

- **Arguments:** one or more corpus files. No flags.
- **Exit:** 0 done · 2 usage error or no such file · 3 `jq` or `python3` missing, checked before anything is read (`[blocker] <tool> is not on PATH; profile.sh needs jq and python3.`).
- **Network:** none. **Writes:** stdout only. Needs `jq` and `python3` (the one-per-signature pass runs as `python3 -I`).

#### `frames.py`

```bash
python3 -I "<auditor-skill root>/scripts/dnr/frames.py" [--instructions] [<corpus.jsonl> ...]    # reads stdin when no file is named
```

Attributes each `Program log:`, `Program data:` and `Program return:` line to the program frame that emitted it. It walks the log array one element at a time with anchored patterns, so a newline inside a log payload cannot forge a frame. Output is JSONL on stdout, one `{sig, ok, depth, program, kind, text}` record per line, where `kind` is `log`, `data`, `return`, `truncated` or `unparsed`; an input line that is not JSON becomes a `parse_error` record. A log line is what the program asserted, never proof that state changed.

- **Arguments:** corpus files (several corpora count each signature once; skipped copies are reported on stderr), or none for stdin.
- **`--instructions`:** prints the instruction records instead; the default output is unchanged without it. An `ix` record for each entry of `message.instructions` and `meta.innerInstructions` gives the program, the top-level and inner index, the stack height, the accounts, and the data as given (or `parsed-only`). An `invoke` record gives each invocation's depth, outcome and the `ix_seq` it ran. No `ix` field comes from log text.
- **Exit:** 0 done · 1 a file that cannot be read.
- **Network:** none. **Writes:** stdout only.

#### `deltas.py`

```bash
python3 -I "<auditor-skill root>/scripts/dnr/deltas.py" lamports|tokens [<corpus.jsonl> ...]    # reads stdin when no file is named
```

Balance movements of successful transactions, computed in Python integers so that amounts above 2^53 stay exact.

- `lamports` prints `signature`, `account`, `delta` for each non-zero lamport change, with the fee added back for the fee payer.
- `tokens` prints one row per token account: `signature`, `owner` (`?` when the corpus names none), `mint`, `delta` in raw units, and the token account. Sum the rows per owner and mint for an owner's net movement.

The output is TSV on stdout; tabs, newlines, carriage returns and backslashes inside a field are escaped. Several corpora count each signature once; skipped copies are reported on stderr.

- **Arguments:** the mode, then corpus files or none.
- **Exit:** 0 done · 2 a missing or unknown mode · 1 a file that cannot be read, checked before any row is printed.
- **Network:** none. **Writes:** stdout only.

#### `redact.sh`

```bash
set -o pipefail; some-command 2>&1 | bash "<auditor-skill root>/scripts/dnr/redact.sh"    # pipefail keeps the command's exit status
```

A filter from stdin to stdout that removes provider credentials. In a URL of any scheme it keeps the scheme and the host's last two DNS labels (`REDACTED.provider.example`; an IP address or a two-label host stays whole), replaces userinfo with `REDACTED@` and replaces the path and query with `/REDACTED`. On curl's own error and verbose lines it shortens bare host names the same way and redacts the request path. A bare `api-key=`, `token=`, `secret=`, `auth=` or `access-token=` value outside a URL is redacted too. It is a convenience, not a guarantee: no RPC URL goes into a ledger, `INCIDENTS.json` or a report in any case. Record the provider's domain, as `collect.sh` prints it, and the literal string `$RPC_URL` instead.

- **Arguments:** none. **Exit:** 0. **Network:** none.

### Threat-model collector

#### `threat-model/collect.sh`

```bash
bash "<auditor-skill root>/scripts/threat-model/collect.sh" --repo <dir> --out audit_<n>/bootstrap [options]
bash "<auditor-skill root>/scripts/threat-model/collect.sh" --repo <dir> --out audit_<n>/bootstrap --detect
```

The read-only collector behind `/auditor:threat-model --bootstrap` ([method and output contract](../references/audit-lifecycle/threat-model-bootstrap.md)). It gathers commits whose message matches security keywords, reverts, account-guard lines that were removed or quietly added, churn, an optional fork-parent comparison, provenance signals, prior-vulnerability inputs and the `audit-mem` warm block. It never checks out, builds, runs or modifies the target, and it runs git with the Rule 11c hardening.

| Flag | Meaning |
|------|---------|
| `--repo <dir>` | the target (required): the top level of its own repository, or a bare repository. Anything else, a partial clone, or a target whose config git cannot read exits 3 |
| `--out <dir>` | the run directory (required), normally `audit_<n>/bootstrap`: a plain path without `.` or `..` components. If it, or its `audit_<n>` parent, is a symbolic link, holds one, is tracked by git, or cannot be checked (find cannot read all of it, or git cannot answer, as for a repository git refuses as owned by another user), the run exits 2 |
| `--pin <rev>` | the commit to analyse (default `HEAD`); only its ancestry is mined. Exit 3 if it does not resolve |
| `--paths <pathspec>` | target pathspec, repeatable (default `programs/*.rs` when the commit has a `programs/` directory, else `*.rs`) |
| `--parent <https-url\|dir>` | the fork parent: an `https://` URL, cloned bare into a temp directory that is deleted on exit, or the top level of a local repository. A local path that is not a top level, is a partial clone, or has a config git cannot read is recorded as not used, R5 prints `NOT FOUND`, and the run goes on |
| `--parent-paths <spec>` | parent pathspec, repeatable (default: the same rule, applied to the parent) |
| `--import <rev>` | the target commit that brought the parent's code in (default: the root commit). Pass it when the code arrived after the root commit (a README-only first commit, say), or R5 reports `NOT FOUND`. It must resolve to a commit, else the run exits 2 |
| `--vulns <file\|https-url>` | a prior-vulnerability input, repeatable: PDF, Markdown, text, CSV, JSON, or an `INCIDENTS.json` (allowlisted fields only) |
| `--program-id <id>` | the program id for R8's `audit-mem warm` (needs the built tool and `--audit-mem-db`) |
| `--audit-mem-db <path>` | the audit-mem store R8 reads. There is no default: without it no store is read, and the collector never looks in the target tree. Pass only a store that passes the Rule 11d check |
| `--keywords <ere>` | extra commit-message keywords, as an ERE alternation such as `drain\|bypass` |
| `--offline` | never use the network: `--parent` and `--vulns` URLs are recorded, not fetched |
| `--detect` | evaluate triggers T3 and T4 only, print them and exit; writes nothing |
| `--cap <n>` | rows per section before `TRUNCATED` (default 60); re-run with a higher value when a section is truncated |
| `--small <n>` | changed-line ceiling for an `ADDED-QUIET` (quiet-fix) commit (default 40) |
| `--fix-ceiling <n>` | changed-line ceiling for the `ADDED` rows of a keyword commit (default 300) |
| `-h`, `--help` | print the usage header, flags and exit statuses included |

- **Exit:** 0 done (a section may print `NOT FOUND`) · 2 usage error or rejected input, including an `--out` with `.` or `..` components, a run directory that is a symbolic link, holds one, is tracked by git, or cannot be checked by git or find (the check fails closed), and an `--import` that is not a commit · 3 `--repo` is not the top level of a git repository (or a bare repository), the pin does not resolve, the target is a partial clone (reading it could fetch from its promisor remote), or git cannot read its config.
- **Network:** only for an `https://` URL passed in `--parent` (a bare clone without submodules, credential helpers or other protocols) or in `--vulns` (curl, https only through redirects too, with 60-second and 50 MB limits). Never with `--offline` or `--detect`, and never for a URL found in target content. Every git call runs with `GIT_NO_LAZY_FETCH=1` and `protocol.allow=never`, the parent's https clone allowing https for that call only, so no remote the target configures is contacted. URLs in `history.md`, `inputs.tsv` and stderr show userinfo, query string and fragment as `***`.
- **Writes:** in `<out>`:
  - `history.md`: sections R0 to R8; a "Shallow clone" line when the target is shallow; and which git settings are pinned.
  - `inputs.tsv`: the manifest of every input.
  - `inputs/`: converted or copied inputs.
  - `diffs/`: `target-<sha>.diff` and `parent-<sha>.diff` for up to 20 flagged commits each. Each holds the full id, the date, the subject and up to 20 body lines, then the diff limited to the files its rows name, up to 400 lines. Every cut ends in a `TRUNCATED (…)` line naming the command for the rest, to run in a scratch copy ([Rule 11c](../OUTPUT-RULES.md#11c--untrusted-git-checkouts)): `GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false show --no-textconv --no-ext-diff <full id> -- '<path>' …`, each path escaped like other target text and single-quoted (`--no-patch` and no path for a cut message).
  - With `--program-id` and `--audit-mem-db`, `audit-mem-warm.json`.
  - Target text in `history.md` and `inputs.tsv` shows TAB, LF and CR as `\t`, `\n` and `\r`, and other control characters as `?`. Values over 500 characters are cut with `...`.
  - An `incident_*/INCIDENTS.json` that is a symbolic link, sits in a linked directory, or lies in a tracked `incident_*` directory is not read; `inputs.tsv` records it as skipped. Neither is a local `--vulns` path that is a symbolic link or that reaches its file through a directory link inside the target tree. An `incidents` value that is not an array gives an empty extract and a "malformed" status.
  - `<out>`, and an `audit_*` parent without a `.gitignore`, each get a `.gitignore` containing `*`.
  - `--detect` prints `T3 yes|no <signals>` and `T4 yes|no <signals>` to stdout.
- **Needs:** git; `jq` or `python3` for JSON inputs, `pdftotext` to convert PDFs, `curl` for `--vulns` URLs. The environment variable `TM_JSON_TOOL=jq|python3|none` pins the JSON tool; the self-test uses it.

### Trail of Bits bump review

#### `tob-delta-review.sh`

```bash
bash "<auditor-skill root>/scripts/tob-delta-review.sh" [--fetch] <tob-clone> <old-sha> <new-sha>
```

The maintainer's report for moving the `vendor/trailofbits` pin ([CONTRIBUTING.md §5](../CONTRIBUTING.md#bumping-vendortrailofbits)). It prints markdown to stdout: the commit count and ancestry, plugins added or removed, load surfaces (nested `.claude/`, hooks, MCP and LSP servers, settings, `CLAUDE.md` / `AGENTS.md`, workflow scripts), plugin manifests and the ones that declare hooks or servers inline, skill and command counts per plugin, new executables, symbolic links and gitlinks, hosts in added script, config and Markdown lines, remote-exec patterns in added lines with continuation lines joined (a download piped to a shell or interpreter, `sh -c "$(curl …)"`, `<(curl …)`, `npx --yes`, `pip` or `uvx` from a URL), the `LICENSE`, and whether every plugin that `references/orchestration/boundary-map.md` and this page name still exists. Git's colour, external-diff, textconv, rename-detection and signature settings are off for every call, so the maintainer's own config does not change the report. The scans also diff with `--text` and, on git 2.40 or later, read attributes from the empty tree, so upstream's own `.gitattributes` cannot mark a changed file binary. The report informs a human reviewer; it is not a verdict.

- **Arguments:** `<tob-clone>` is a full, non-shallow clone of `https://github.com/trailofbits/skills` (a shallow one draws a warning); `<old-sha>` and `<new-sha>` are the current and proposed pins. `--fetch` runs `git fetch origin` in the clone first.
- **Exit:** 0 report printed · 2 usage error, a missing clone directory, a failed fetch, or a commit the clone does not have.
- **Network:** only with `--fetch`. **Writes:** nothing but a temp directory, removed on exit.
