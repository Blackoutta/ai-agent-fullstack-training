# Orchestration Boundary — auditor-skill × Trail of Bits

auditor-skill's native corpus is the **knowledge** layer (checklists, vectors, severity, gates).
Trail of Bits (vendored at `vendor/trailofbits`) is the **execution** layer — real tools that
auditor-skill's prose + grep cannot run. Subagents delegate to it when present, and fall back to
native grep checks when a clone has not initialized the submodule. The pinned commit is the one
README.md names (Installation → Tool execution); it moves only through the review in `CONTRIBUTING.md` §5.

Two rules from `OUTPUT-RULES.md` Rule 11 apply to the rows below. A row that builds or runs target code
follows the execution mode recorded at intake (Rule 11a). A row that sends code or dependency data to an
outside service is listed in the report — tool, service, what was sent (Rule 11b).

## Detection

Before delegating, confirm the submodule is present in the installation; its plugins are read and run
from there too. `<auditor-skill root>` is the absolute installation path the invoking command or skill
gave you, never the working directory, which is usually the audited repo (`OUTPUT-RULES.md` Rule 11e):

```
test -d "<auditor-skill root>/vendor/trailofbits/plugins" && echo present
```

**Paths inside a vendored skill.** Read straight from the vendored tree, a Trail of Bits skill has nothing
that defines its `{baseDir}` placeholder or anchors its relative paths (`scripts/…`, `references/…`,
`workflows/…`, `tools/…`) — the semgrep skill, for one, runs `{baseDir}/scripts/run-scans.sh`. Both
point into that plugin's own directory, `<auditor-skill root>/vendor/trailofbits/plugins/<plugin>/`:
for a skill file, normally `skills/<skill>/`; some plugins keep a tool at the plugin root (e.g.
`constant-time-analysis/ct_analyzer/`), and plugin-level agents count from the plugin root. Substitute
that absolute directory before running or reading anything, and never resolve such a path against the
working directory (`OUTPUT-RULES.md` Rule 11e).

If absent (submodule not initialized), run the native fallback and note in the report:
"deeper tooling available via `git submodule update --init --depth 1 -- vendor/trailofbits`, run in the
auditor-skill directory (plugin and install.sh installs already include it)".

## Capability → plugin map

| Capability | ToB plugin (`<auditor-skill root>/vendor/trailofbits/plugins/…`) | auditor-skill use | Native fallback |
|------------|---------------------------------------------|-------------|-----------------|
| Interprocedural SAST (taint) | `static-analysis`, `semgrep-rule-creator`, `variant-analysis` | `vuln-hunter` runs SAST over in-scope languages; fold SARIF into verdicts. A CodeQL database build compiles the target (Rule 11a) | `discovery/grep-commands.md` scanners |
| Property / fuzz harnesses | `testing-handbook-skills`, `property-based-testing` | generate + run a harness for any ≥High arithmetic/economic finding (the Rule 5b PoC); `/auditor:poc` orchestrates this. Harnesses on target code follow Rule 11a | checklist 16 "does the suite exist" prose checks |
| Coverage & mutation | `testing-handbook-skills`, `mutation-testing` | evidence-back FV coverage items; an uncaught mutant downgrades the corresponding checklist PASS; `/auditor:patch --verify-with-mutation` uses a caught mutant on the patched line as fix evidence. Mutation runs follow Rule 11a | FV items marked `[PARTIAL — not machine-verified]` |
| Secret zeroization (IR-level) | `zeroize-audit` | verify KV-112 / RS-015 at the IR level; it compiles the target (Rule 11a) | grep `zeroize`/`Zeroizing` on secret-bearing types |
| Constant-time (custom crypto) | `constant-time-analysis` | check secret-dependent branches when custom crypto is present; it compiles the code it checks (Rule 11a) | note "manual constant-time review needed" |
| Entry-point enumeration | `entry-point-analyzer` | seed the Phase 0 instruction matrix (has native Solana support) | manual `#[instruction]` enumeration |
| Supply-chain metadata | `supply-chain-risk-auditor` | enrich checklist 11 (SC-044..046). Covers npm / PyPI / Go only. Its collector sends the project's dependency names to 8 outside services — OSV, the npm registry and downloads API, PyPI, the Go module proxy, deps.dev, the GitHub API (with your `gh` token when logged in) and OpenSSF Scorecard — so the report records it (Rule 11b). `--offline` only replays cached responses; it is not a privacy control | `npm audit` / `cargo audit` + grep |
| Dimensional / unit analysis | `dimensional-analysis` | annotate + propagate units through DeFi value paths (checklist 03/06) — catches mixed-decimals / wrong-scale bugs | manual per-quantity unit tracking |
| Insecure-default trace | `insecure-defaults` (now a command + Workflow, `/insecure-defaults:audit`, that runs only with the ToB plugin installed; from the vendored tree, read its `references/*.md` category files) | fail-open vs fail-secure path trace for suspected weak defaults (checklist 12/13) | grep fallback-secret patterns |
| API misuse / footguns | `sharp-edges` | misuse-resistance review of a program's own public/CPI interface + config schema | `references/framework-idioms/*` footgun catalog |
| Exploitability verify | `fp-check` (local; an executable PoC it builds follows Rule 11a); `second-opinion` sends the selected code to an external LLM CLI — OpenAI Codex or Google Antigravity / Gemini — so the report records it (Rule 11b) | `peer-reviewer` + `poc-engineer` confirm a finding is real, not a harness artifact | manual re-derivation |
| Fix blast-radius | `differential-review` | `/auditor:patch` step 4 + `patch-engineer`: confirm the fix closes the exploit path and leaves every other path unchanged | `/auditor:re-audit` 4b differential execution (Rule 11a) plus a manual review of the patched function's callers and sibling instructions |

## FV / harness delegation gates

Before delegating an FV/fuzz harness (the `property-based-testing` / `testing-handbook-skills` /
`mutation-testing` rows above), apply the ladder in `references/audit-lifecycle/methodology.md` §6:

- **Trident stateful sequences first.** The default harness for any non-trivial program is
  **multi-instruction stateful** fuzzing (Trident / SVM-level), because most real Solana logic bugs
  live in cross-instruction state (ordering, accumulation, stale-state, multi-user interleaving), not
  in a single pure function. Delegate proptest-on-pure-functions as the cheap first probe, but treat
  the stateful Trident sequence as the **primary bug-finder** — do **not** escalate to deductive FV
  (Certora/Kani) for a property a stateful fuzzer would surface in minutes. Reserve Certora/Kani for
  the 3–10 invariants whose single counterexample is catastrophic.
- **Skip FV if the target is CPI-dominated.** Deductive/BMC proof reasons only about code you have.
  When an instruction's outcome is decided mainly by a **cross-program invocation into
  untrusted/foreign code** (aggregator swap, arbitrary callee, external program whose post-state
  cannot be modeled), FV cannot conclude anything useful — **do not spend the FV budget on it**.
  Fall back to Trident sequences that mock the CPI boundary adversarially plus manual CPI-trust review
  (`references/framework-idioms/anchor.md` per-CPI checklist). Note this abstention explicitly in the
  report's Assumptions & Simplifications section.

## Rule

Delegation **augments**, never replaces, the native verdict. Every finding still carries an
auditor-skill verdict and (if N ≥ 6) a filled Rule 5b gate. Tool output is *evidence*, not a verdict.
