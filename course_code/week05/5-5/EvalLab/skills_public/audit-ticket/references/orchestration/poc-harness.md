# Orchestration — PoC Harness Selection & Evidence Tiers

> **Load when:** building an executable proof-of-concept or a fix patch — i.e. running `/auditor:poc` or `/auditor:patch`, choosing a harness framework for a confirmed finding, or recording a `[PoC-*]` / `[FIX-*]` evidence tier.

A PoC turns an **asserted** finding into a **demonstrated** one. It never invents a
finding — Rule 5b (`OUTPUT-RULES.md`) must already have confirmed the finding with a
filled Reachability + Math/State-Bounds block (Attacker-Model for N ≥ 7). This
reference decides *which* harness reproduces it and *what tier* the result earns.

**Templates:** the crate the `poc-engineer` fills lives at
`<auditor-skill root>/templates/poc/` (feature-gated `vulnerable`/`fixed` arms,
`tests/exploit.rs` + `tests/fixed_blocked.rs`, `shared-test-utils`, `run.sh`). The patch
templates live at `<auditor-skill root>/templates/patch/`. `<auditor-skill root>` is the
absolute installation path the invoking command or skill gave you, never the working
directory, which is usually the audited repo (`OUTPUT-RULES.md` Rule 11e): copy the
scaffold from there, never from a relative `templates/` path.

**One rule above all:** *executable evidence outranks prose, but prose is never
removed.* An unbuildable or un-forkable target still yields a complete finding — you
downgrade the **evidence tier**, never the **severity**. A named blocker with the
prose PoC intact is honest; a fabricated green test is not.

---

## 1. Toolchain gates (detect — never assume)

Probe what is actually installed before choosing a framework. A missing tool is a
*blocker to name in the report*, not a reason to skip the finding or fake a result.

**Execution gate ([`OUTPUT-RULES.md` Rule 11a](../../OUTPUT-RULES.md#rule-11-operating-safety)).**
Building a PoC runs code — the build scripts and proc-macros of its dependencies, then
its tests — and the crate can carry target code or crates taken from the target's
manifest. So every PoC runs in the execution mode recorded at intake (for an incident,
the mode the command recorded in the ledger header): `templates/poc/run.sh` needs
`AUDITOR_EXEC_MODE` set to it — `isolated` inside the isolated runner, or `native` —
and otherwise exits 3 before it compiles anything, which makes the PoC
`[PoC-ATTEMPTED]`. With no recorded mode, ask once (a non-interactive run is native,
and the report says so). As a second layer, `run.sh` never builds inside the target
tree: cargo reads `.cargo/config*` and rustup reads `rust-toolchain*` from every
parent directory, so a crate built under `audit_<n>/poc/` or `incident_<n>/poc/`
would pick up the target's rustc wrapper, runner, linker, `[env]` and toolchain.
`run.sh` copies the crate to a scratch directory outside the tree and builds it there
with a pinned toolchain; it refuses a crate holding a symbolic link, a `.cargo/`
directory or a `rust-toolchain*` file, and a `path` dependency on target crates must
be absolute. Building the target itself (for example `cargo build-sbf` /
`anchor build` on the client tree to get its `.so`) runs target code in the same mode.
An incident whose root cause is supply chain / CI is never built natively, and its PoC
never builds or links the target's crates in any mode, since they may be the payload:
it runs on the dumped program bytes alone (`run.sh` prebuilt mode), with the
template's own crates. If the recorded mode cannot run the PoC, record
`[PoC-ATTEMPTED]` with the blocker "no isolated runner" and keep the prose PoC.

**Build cache.** `run.sh` builds every run in a fresh scratch directory, so each run
compiles the whole dependency graph from cold. To reuse compiled dependencies between
runs of one audit, create a directory outside any repository, e.g.
`${XDG_CACHE_HOME:-$HOME/.cache}/auditor-skill/poc-target/<repo-name>-audit_<n>`
(`…-incident_<n>` for an incident), pass it to every `run.sh` call as
`CARGO_TARGET_DIR`, and delete it when the engagement ends. Never point
`CARGO_TARGET_DIR` inside the target tree or at a directory you did not create: cargo
trusts the build outputs it finds there. The `.so` files stay in the scratch copy
(`SBF_OUT_DIR`).

**Runners you write.** `templates/poc/run.sh` is the runner for the template's crate. A
Trident or cargo-fuzz target or a Surfpool scenario has no template, so `poc-engineer`
writes its `run.sh`, and that runner keeps both rules above. It starts with `run.sh`'s
mode gate, these lines verbatim, so it exits 3 before it copies or builds anything:

```bash
case "${AUDITOR_EXEC_MODE:-}" in
  isolated|native) ;;
  *)
    echo "[PoC-ATTEMPTED] blocker: AUDITOR_EXEC_MODE is '${AUDITOR_EXEC_MODE:-}', not isolated or native — nothing was copied or built." >&2
    echo "Building this crate runs code (dependency build scripts and proc-macros, then the tests), so every run needs the execution mode recorded at intake (OUTPUT-RULES.md Rule 11a, QUESTIONS.md Q46): AUDITOR_EXEC_MODE=isolated inside the isolated runner, or AUDITOR_EXEC_MODE=native (the report then states that the PoC build ran on this host)." >&2
    exit 3
    ;;
esac
```

Then it builds and runs from a scratch copy outside the target tree, as `run.sh` does:
a directory from `mktemp -d "${TMPDIR:-/tmp}/auditor-poc.XXXXXX"`, the crate copied in
without `target/`, refusing a symbolic link, a `.cargo/` directory or a
`rust-toolchain*` file; `RUSTUP_TOOLCHAIN` pinned; every `cargo`, `trident` or
`surfpool` command started from that copy; a `path` dependency on target crates
absolute. A runner without both is not a PoC runner, and the tier is `[PoC-ATTEMPTED]`.

**Run the probes below from `${TMPDIR:-/tmp}`, never from inside the target tree**
(`cd "${TMPDIR:-/tmp}"` first, with `RUSTUP_TOOLCHAIN` pinned — Rule 11a). Inside it,
the target's `.cargo/config*` can define an `[alias]` named `build-sbf` or `fuzz` that
shadows the real subcommand (cargo only warns), and a parent `rust-toolchain*` that
names a `path` toolchain runs even on a bare `cargo --version`.

| Gate | Detect | Enables | If absent |
|------|--------|---------|-----------|
| **`cargo build-sbf`** (platform-tools ≥ **v1.54** / cargo ≥ **1.85**) | `cargo build-sbf --version`, run from `${TMPDIR:-/tmp}`; check the bundled cargo ≥ 1.85 (default bundle is v1.51/cargo 1.84 and **cannot** parse the edition2024 manifests in the modern `mollusk-svm`/`litesvm` dep tree — pass `--tools-version v1.54`) | Mollusk **and** LiteSVM PoCs (both load a compiled `.so`) | No on-chain executable PoC → `[PoC-ATTEMPTED]`, keep prose. Name it: "install Agave platform-tools ≥ v1.54". |
| **Surfpool** (CLI + MCP) | `surfpool --version` on PATH; the surfpool MCP reachable | mainnet-fork economic/oracle/MEV reproduction with a real P/L. The fork loads state from the RPC datasource it is started with (`--rpc-url` / `--network`), which receives the program ids and account addresses it fetches: the report lists that provider and what it was sent (`OUTPUT-RULES.md` Rule 11b) | No fork simulation → fall back to Mollusk/LiteSVM if the logic is modelable, else `[PoC-ATTEMPTED]`. Name it: "surfpool CLI + MCP unreachable / fork state unavailable". |
| **Trident** (stateful SVM fuzzer) | `trident --version` on PATH | coverage-guided multi-instruction fuzzing → crash/invariant artifact | Try `cargo fuzz` (below); if neither, keep the prose invariant argument → `[PoC-ATTEMPTED]`. |
| **cargo-fuzz** (libFuzzer unit fuzz) | `cargo fuzz --version` on PATH, run from `${TMPDIR:-/tmp}` | fuzzing a single pure function (parse/deser/math) → crashing input | If absent, a hand-written failing unit test on the boundary value is the fallback; else `[PoC-ATTEMPTED]`. |

Record which gates passed in the finding's PoC block. `run.sh` in `templates/poc/`
self-detects `cargo-build-sbf` and exits `3` with a named blocker when it is missing —
mirror that discipline for the other tools.

---

## 2. Framework-selection matrix (finding type → harness)

Pick by what the bug actually *is*. The cheapest harness that faithfully reproduces
the flaw wins — do not reach for a mainnet fork when a single-instruction Mollusk test
proves it deterministically.

| Finding type | Harness | Why | Tier on success |
|--------------|---------|-----|-----------------|
| logic / access-control / **signer** / **owner** / **PDA** / **CPI-target** / arithmetic contained in **one instruction** | **Mollusk** (single `process_instruction`) | fastest, deterministic, in-process; one crafted ix against one `.so` | `[PoC-REPRODUCED]` |
| **multi-step lifecycle** — init → mutate → withdraw; **reinit**; **close → revival**; any bug living in cross-instruction state | **LiteSVM** stateful sequence | replays an ordered instruction sequence and carries state between them, which a single-ix runner cannot | `[PoC-REPRODUCED]` |
| **economic / oracle / MEV / first-depositor** — value depends on live pool/oracle state or ordering | **Surfpool mainnet-fork** | reproduce deposit → manipulate → withdraw against forked real state for a concrete net **P/L** figure | `[PoC-SIM-REPRODUCED]` |
| **parse / deser / math** that is **fuzz-discoverable** (the crashing input is not obvious) | **Trident stateful** (default) or **cargo-fuzz unit** (pure function) | let the fuzzer *find* the input; emit the crashing artifact as the proof | `[PoC-FUZZ-REPRODUCED]` |
| **off-chain** TS/Rust client, indexer, keeper, backend | **cargo-fuzz** / **vitest** / **proptest** on the off-chain code | the bug is not on-chain; prove it where it lives | `[PoC-FUZZ-REPRODUCED]` (fuzz) or `[PoC-REPRODUCED]` (deterministic test) |

Escalation discipline (from `boundary-map.md` §"FV / harness delegation gates"): a
**stateful Trident sequence is the primary bug-finder** for non-trivial programs —
proptest-on-pure-functions is a cheap first probe, not the destination. Do **not**
escalate to deductive FV (Certora/Kani) for a property a stateful fuzzer surfaces in
minutes, and **skip FV entirely when the instruction's outcome is decided by a CPI
into untrusted/foreign code** — mock that boundary adversarially in Trident instead
and note the abstention in the report's Assumptions & Simplifications.

---

## 3. Evidence-tier fallback ladder

Award the **highest tier the available tooling actually reached**, then stop. Each
rung down is a real, reportable finding — the ladder degrades gracefully to prose.

```
[PoC-REPRODUCED]       Mollusk (or LiteSVM) executed the exploit: it SUCCEEDS on the
   (strongest)         vulnerable arm and is REJECTED on the fixed arm. Deterministic.
        │
[PoC-SIM-REPRODUCED]   Reproduced on a Surfpool mainnet-fork with a recorded net P/L
        │              (economic / oracle / MEV — value needs live forked state).
        │
[PoC-FUZZ-REPRODUCED]  A Trident / cargo-fuzz target produced the crashing or
        │              invariant-breaking input; the corpus/crash artifact is saved.
        │
[PoC-ATTEMPTED]        A required tool was absent (no cargo build-sbf, surfpool
        │              unreachable, fork state unavailable), the recorded execution
        │              mode could not run it (no isolated runner — Rule 11a), OR the
        │              flaw could not be minimized into a self-contained crate. Name
        │              the exact blocker, KEEP the prose PoC, record what a maintainer
        │              must install/provide.
        │
[PoC-PROSE]            No executable attempt applicable/possible; the structured
   (weakest, still      attacker-narrative PoC (actor → capability → steps → guard
    a valid finding)    bypassed → quantified outcome) stands on its own. A prose PoC
                        is a first-class Rule 5b proof form.
```

**Never fabricate a passing test to climb the ladder.** An asserted-only-in-prose
finding recorded as `[PoC-PROSE]`/`[PoC-ATTEMPTED]` is honest; a faked green test is
not. Downgrading the tier never downgrades the finding's severity or removes its prose.

**The contract assertions.** `tests/exploit.rs` asserts the effect with
`assert_exploit_effect!` (the account the attack changes, how to read the field, and the
concrete value the attack leaves there, which the account did not hold before), and
`tests/fixed_blocked.rs` asserts the guard's exact error with
`assert_exploit_rejected_with!` (a value compared with `==`, never a pattern). For a
fix the team deployed, whose error is not known in advance, the fixed arm uses
`assert_exploit_blocked!` instead, with a positive control: a legitimate call (the
instruction the finding concerns, with valid accounts and signers) goes through on the
same bytes and runner and changes the account the attack targets, and the attack then
fails with an error that is not a harness error and leaves that account unchanged. A
control that fails or changes nothing makes the run inconclusive. When no legitimate
call can show the change on those bytes (a hotfix that turned the instruction off),
pin the hotfix's error with `assert_exploit_rejected_with!` instead: a failure alone is
never a block.

Each assertion leaves a marker when it starts and another when it holds. A failed test
is a verdict (exit 1 or 2) only when an assertion ran and did not hold. It is
inconclusive, exit 3, when it failed before any assertion ran (the program did not
load, the setup panicked) or the harness could not decide (a harness error such as
`Custom(4100)` or a short account list, a control that failed). On prebuilt bytes
`run.sh` accepts an arm only with its assertion's marker, and only when every program
`mollusk_for` loaded is the `.so` `run.sh` placed, unchanged after the test
(`mollusk_for` records each path and zero-trimmed sha256): load the program under test
only through `mollusk_for`, by name. The markers are a floor, not proof: whoever reads
the PoC still checks that the assertion states the finding's effect and the guard's
error.

**Leg 3 of an incident** (`references/detection-response/README.md`) is met only by a
`run.sh` run on prebuilt bytes that ends with

```
OK: reproduced on prebuilt bytes — vulnerable sha256=<64 hex> → [PoC-REPRODUCED]
```

(with `FIXED_SO`, the same line also names `fixed sha256=<…>` and how the fixed arm
held), where `<64 hex>` is the zero-trimmed sha256 recorded for the incident snapshot
or the hash-matched build. `VULNERABLE_SO` alone is enough for Leg 3: no fix needs to
exist yet. A run of the crate's own arms, a model, prints another line and never
satisfies Leg 3, whatever its tier.

---

## 4. Fix tiers (the patch side)

After a PoC exists, `/auditor:patch` proposes a minimal idiomatic diff and proves it by
re-running that PoC. The verdict maps to the report's **Auditor Verification** field
(templates: `templates/patch/patch.md` + `VERIFICATION.md`).

```
[FIX-VERIFIED]      Diff applied to a SCRATCH worktree, rebuilt, and the finding's PoC
   (strongest)      re-ran and now REVERTS — closure shown by execution. Optional
        │           mewt-mutation / blast-radius clean.
        │
[FIX-INSUFFICIENT]  The diff does not fully close the bound: the PoC still exploits a
        │           residual path, a mutant survives on the patched line, or an
        │           adjacent path regressed (blast-radius). State what remains open.
        │
[FIX-PROPOSED]      A minimal idiomatic diff re-derived from the code closes the cited
   (weakest)        bound, but NO executable PoC was available to run the revert.
                    Verified by reasoning, flagged not-yet-executed — never silently
                    promoted to [FIX-VERIFIED].
```

A cosmetic patch ≠ FIXED. `[FIX-VERIFIED]` requires an *executed* revert of the
finding's own exploit — a diff that merely reads plausibly is `[FIX-PROPOSED]` at most.
The scratch-worktree rebuild runs target-controlled code (Rule 11a): it uses the
execution mode recorded at intake, and when that mode cannot run it the patch stays
`[FIX-PROPOSED]`.
The patch is a **proposal**: the auditor stays read-only on the client tree and hands
back the diff plus this verification record for the client to apply and re-test.

**Re-detonating against the target's own build.** The PoC proves the patch either on
the minimized model (the patch transplanted onto the crate's `vulnerable` arm, as in
`VERIFICATION.md` §2) or on the target itself: `run.sh` with `VULNERABLE_SO` set to the
unpatched build and `FIXED_SO` to the patched one. That is prebuilt mode: `run.sh`
exits 3 unless both files are ELF programs and each arm's contract assertion ran and
held on the bytes `run.sh` placed, `assert_exploit_effect!` on the unpatched bytes and
`assert_exploit_rejected_with!` on the patched ones. Our patch is shown only by a line ending in `(rejected with the
pinned error) → [PoC-REPRODUCED]`; a `(blocked: …)` line comes from the check of a fix
the team deployed and is reported apart, never as evidence for our patch. The PoC must
also use the program's real id (an Anchor program checks its own `declare_id!`), which
`run.sh` does not check. The run needs `AUDITOR_EXEC_MODE` like any other.
`VERIFICATION.md` records which target the PoC re-ran against in its *Re-detonated
against* field.

---

## 5. Where this sits in the flow

1. Rule 5b confirms the finding (`OUTPUT-RULES.md`).
2. `/auditor:poc` → detect gates (§1) → pick framework (§2) → `poc-engineer` fills a
   copy of `<auditor-skill root>/templates/poc/` → `run.sh` → award the highest tier reached (§3).
3. `/auditor:patch` → `patch-engineer` writes `templates/patch/` diff → apply to a
   scratch worktree → re-run the PoC → award a fix tier (§4).
4. `audit-cycle` / `re-audit` fold both tiers back into the finding block; the report's
   **Auditor Verification** line carries the fix verdict.

Build/toolchain failures that block any of this are troubleshooting, not findings —
resolve via `references/framework-idioms/build-and-tooling.md` (GLIBC floors, the
`edition2024` / platform-tools pin, the LiteSVM → bankrun/Mollusk GLIBC fallback).
