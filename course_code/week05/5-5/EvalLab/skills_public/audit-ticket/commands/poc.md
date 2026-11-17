---
name: auditor:poc
description: "Generate an executable proof-of-concept exploit for a confirmed High/Critical finding — detect the toolchain, pick the harness framework by finding type, spawn poc-engineer, and emit a one-command runnable crate plus the earned [PoC-*] evidence tier. Never hard-fails: on toolchain absence it downgrades to [PoC-ATTEMPTED] and keeps the existing prose PoC."
argument-hint: "<finding-id | INC-n.k | file:line> [--fork] [--fuzz] [--force]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# auditor-skill — Executable Proof-of-Concept

**Arguments:** $ARGUMENTS

Turn a *confirmed* finding into a runnable exploit. Read `OUTPUT-RULES.md` first (severity 1-10, the **Rule 5b** gate — the finding must already carry a filled Reachability + Math/State-Bounds block, Attacker-Model for N≥7) and `references/orchestration/poc-harness.md` (the finding-type → framework matrix and the `[PoC-*]` evidence tiers this command emits). A PoC is *evidence that upgrades an asserted finding to a demonstrated one* — it never invents a finding that Rule 5b did not already confirm.

## Steps

1. **Resolve the finding.** Locate the target:
   - a finding id (`F-xxx`) resolved from the latest `audit_<n>/REPORT.md`, or a raw `file:line` — read its full finding block **and** its context worksheet under `audit_<n>/worksheets/context/*`; or
   - a run-qualified incident id **`INC-<n>.<k>`** resolved from `incident_<n>/INCIDENTS.json` (`references/detection-response/`). Its `vuln` entry is the finding (a Rule 5b block filled with the observed values), and outputs go to `incident_<n>/poc/INC-<n>.<k>/`.
   Pin the commit the report / incident names — the harness reproduces *that* commit (or the deployed bytes, below), never `HEAD`.

2. **Severity gate.** By default only **High/Critical (N≥7)** findings earn an executable PoC — a runnable exploit is the Rule 5b PoC those severities demand, and spending the harness budget on low-severity items is waste. `--force` overrides the gate for a deliberately-requested lower-severity demonstration. A finding still at `[UNCONFIRMED]` / `[PARTIAL]` is **not** eligible — confirm it through Rule 5b first. **An `INC-<n>.<k>` target bypasses the severity gate**: for an incident the executed PoC *is* the `confirmed_exploited` leg, so it runs regardless of the band.

3. **Detect the toolchain (never assume).** Probe what is actually installed, from a directory outside the target tree (`cd "${TMPDIR:-/tmp}"` first): inside it, the target's `.cargo/config*` can alias `build-sbf` to its own code and its `rust-toolchain*` can swap in its own `cargo`.
   - `cargo build-sbf --version` (SBF program build),
   - surfpool MCP reachable (mainnet-fork execution),
   - `trident --version` / `cargo fuzz --version` on PATH (coverage-guided fuzzing).
   Record which are present. A missing tool is a *blocker to name*, not a reason to fabricate.

4. **Pick the framework by finding type** (matrix in `references/orchestration/poc-harness.md`):
   - **logic / access-control / signer / owner / PDA / CPI** → **Mollusk** single-instruction harness (fastest, deterministic, one `process_instruction`).
   - **multi-step lifecycle** (init → mutate → withdraw, cross-instruction state) → **LiteSVM** stateful sequence.
   - **economic / oracle / MEV** → **Surfpool mainnet-fork** (`--fork`) — reproduce deposit→manipulate→withdraw against forked pool state for a real P/L figure.
   - **fuzz-discoverable parse / deser / math** → **Trident / cargo-fuzz** (`--fuzz`) — emit the fuzz target that finds the crashing input.
   `--fork` / `--fuzz` force the Surfpool / fuzz path respectively when the finding type is ambiguous.

5. **Spawn `poc-engineer`.** Hand it the finding block, the context worksheet, the pinned commit, the chosen framework, the detected toolchain, and the execution mode recorded for the run (`audit_<n>/intake.md` §8, or for an incident the ledger header; `OUTPUT-RULES.md` Rule 11a). If no mode is recorded, ask once (a non-interactive run is native, and the report says so) and pass it on as `AUDITOR_EXEC_MODE`. `poc-engineer` copies the matching crate from the installation's `"${CLAUDE_PLUGIN_ROOT}/templates/poc/"` — never a relative `templates/` path, which would resolve inside the audited repo — and fills it: a feature-gated `vulnerable` arm the exploit **succeeds** against, leaving its effect, and a `fixed` arm it is **rejected** against with the guard's exact error (`assert_exploit_effect!` / `assert_exploit_rejected_with!` from our `shared-test-utils`). The exploit test must **assert** the vulnerability, not merely run.

   **Incident mode (`INC-<n>.<k>`).** Leg 3 of `confirmed_exploited` requires the program's **real bytes**, so a minimized-replica `[PoC-*]` does not satisfy it. `poc-engineer` runs the exploit arm on real bytes via `run.sh` `VULNERABLE_SO`: the dumped on-chain ELF (accepted only when its last-deployed slot precedes the incident slot, owning loader checked) or a `solana-verify` hash-matched build. `VULNERABLE_SO` alone suffices; `FIXED_SO` adds the fixed arm once a patched build or a deployed hotfix exists. It uses the **real program id** and asserts the **observed effect** on the `vulnerable` arm with `assert_exploit_effect!` (`Ok` alone proves nothing on real bytes). On the `fixed` arm it asserts the guard's **exact** error with `assert_exploit_rejected_with!`, or, for a deployed hotfix, `assert_exploit_blocked!` with its positive control (a legitimate call that goes through on the same bytes). `run.sh` accepts a prebuilt arm only when its assertion ran and held on the bytes it placed; a test that fails before its assertion ran is inconclusive (exit 3). Leg 3 is met only by the final line `OK: reproduced on prebuilt bytes — vulnerable sha256=<the snapshot's hash> … → [PoC-REPRODUCED]`; a model-only PoC never meets it. The bytes come from the snapshot `/auditor:hunt` / `/auditor:respond` take in step 1 (`incident_<n>/bin/`, via `bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/snapshot-program.sh"`) — a hotfix erases the incident binary, so it is taken before anything else. Build the incident commit only per `OUTPUT-RULES.md` Rule 11a, and never natively when the root cause is supply-chain / CI; under that root cause the PoC never builds or links the target's crates in any mode (they may be the payload) and runs on the dumped bytes alone.

6. **Emit outputs** under `audit_<n>/poc/F-xxx/` (or `incident_<n>/poc/INC-<n>.<k>/`):
   - the filled harness crate (copied from `"${CLAUDE_PLUGIN_ROOT}/templates/poc/"`),
   - a one-command **`run.sh`** that reproduces the result from a clean checkout: the template's own for its crate (`cargo test`), or one `poc-engineer` writes for a `trident fuzz` or `cargo fuzz` target or the surfpool scenario. Every runner needs `AUDITOR_EXEC_MODE` set to the run's recorded mode (`OUTPUT-RULES.md` Rule 11a) and otherwise exits 3 → `[PoC-ATTEMPTED]` before it copies or compiles anything; a runner `poc-engineer` writes starts with the template `run.sh`'s mode gate, verbatim (the lines are in `references/orchestration/poc-harness.md` §1). No runner builds inside the target tree: each copies the crate to a scratch directory outside it (printed) with the toolchain pinned,
   - the earned **`[PoC-*]` evidence tier** recorded against the finding (see vocabulary below), which `audit-cycle` / `re-audit` fold back into the report's finding block.

## Evidence tiers (emit exactly one)

| Tier | Meaning |
|------|---------|
| `[PoC-REPRODUCED]` | The exploit ran and **asserted** the flaw — succeeds on the `vulnerable` arm, rejected on the `fixed` arm (Mollusk / LiteSVM). |
| `[PoC-SIM-REPRODUCED]` | Reproduced against a **Surfpool mainnet-fork** with a recorded net P/L (economic / oracle / MEV). |
| `[PoC-FUZZ-REPRODUCED]` | A **Trident / cargo-fuzz** target produced the crashing / invariant-breaking input; the corpus entry is saved. |
| `[PoC-ATTEMPTED]` | A required tool was absent (no `cargo build-sbf`, surfpool unreachable, fork state unavailable), the recorded execution mode could not run it, **or** the flaw could not be minimized into a self-contained crate. Name the exact blocker, **keep the existing prose PoC**, and record what a maintainer must install/provide to promote it. |

## Never hard-fail

On any toolchain absence or minimization failure, emit `[PoC-ATTEMPTED]` with the named blocker and **preserve the finding's existing structured attacker-narrative PoC** — a prose PoC is a first-class Rule 5b proof form. Downgrading the evidence tier never downgrades the finding's severity. Do **not** fabricate a passing test to reach `[PoC-REPRODUCED]`; an asserted-only-in-prose finding is honest, a faked green test is not.
