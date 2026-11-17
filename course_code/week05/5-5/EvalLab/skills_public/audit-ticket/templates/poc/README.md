# PoC — {FINDING_ID}: {ONE_LINE_TITLE}

Runnable proof-of-concept for finding **{FINDING_ID}** ({SEVERITY}, `{FILE}:{LINE}`),
pinned to audited commit `{COMMIT}`. One feature-gated crate: the exploit lands on
the `vulnerable` arm and is turned away on the `fixed` arm.

## Attack narrative

Fill every field. This is the prose the executable proves — it must map 1:1 onto
`tests/exploit.rs`. Vocabulary matches the Rule 5b **Attacker-Model** block in
`OUTPUT-RULES.md`, so it drops straight into the finding.

- **Actor:** {WHO — permissionless caller | one depositor | co-signer | compromised admin}
- **Capability / setup cost:** {what they start with — public keys only | one deposit | flash-loanable capital | ~$X + N accounts}
- **Guard bypassed:** {the single check that is missing or wrong — e.g. `is_signer` never verified on `authority` at `{FILE}:{LINE}`}

**Steps** (each maps to lines in `tests/exploit.rs`):

1. {e.g. attacker reads the public `authority` pubkey from the on-chain config}
2. {e.g. builds `update_authority` with that key supplied but UNSIGNED, self as the only signer}
3. {e.g. submits the tx — the program compares keys, skips `is_signer`, and accepts}
4. {e.g. config authority is now attacker-controlled}

- **Quantified outcome:** {the damage, with a number — "drains the full vault balance (up to u64 deposits)" | "mints unbacked tokens 1:1 with attacker capital" | "griefing: permanent DoS, no direct profit"}
- **Atomicity:** {single-tx | multi-tx | multi-slot}
- **Net:** {profitable | griefing-only | requires-privilege — privilege caps severity per Rule 1}

## Reproduce

```bash
AUDITOR_EXEC_MODE=isolated ./run.sh   # or native: the execution mode recorded for the run
```

Building this crate runs code — dependency build scripts and proc-macros, then the
tests — so every run needs `AUDITOR_EXEC_MODE` set to the execution mode recorded
at intake (`OUTPUT-RULES.md` Rule 11a): `isolated` inside a container, VM or
sandbox with no keys mounted, or `native` on this machine, which the report then
states. Without it, `run.sh` exits `3` before it copies or compiles anything.

Builds both arms with `cargo build-sbf` (platform-tools >= v1.54) and runs both
tests with `SBF_OUT_DIR` wired — never inside the audited repo. The crate is copied
to a scratch directory under `$TMPDIR` (printed; `KEEP_POC_BUILD=1` keeps it) and
built there with the toolchain pinned, so the target's `.cargo/config*` and
`rust-toolchain*` never apply; a crate holding a symbolic link, a `.cargo/`
directory or a `rust-toolchain*` file is refused, and so is a
`tests/fixtures/{PROGRAM_NAME}.so`, which mollusk would load in place of the arm.
Exit `0` means the exploit reproduced on `vulnerable` **and**, when the fixed arm
runs, was blocked on `fixed`; `1` / `2` mean a contract assertion ran on that arm and
did not hold — see its message; `3` is a named blocker (no execution mode, no SBF
toolchain, bad inputs, a build that failed) or an inconclusive arm (no contract
assertion ran, the test failed outside them, the harness could not decide, or the
test loaded other bytes than the placed arm), and the finding's prose PoC still
stands.

**Dependencies.** Framework crates by default, as in the template. A crate copied
from the target's manifest runs its build script in the recorded mode, so add one
only when the PoC needs it, and read what the manifest pulls in. A `path`
dependency on target crates must be an absolute path: the build runs from the
scratch copy, not from this directory.

**Build cache.** Each run compiles every dependency from cold in its fresh scratch
directory. To reuse compiled dependencies between runs of one audit, create a
directory outside any repository, e.g.
`${XDG_CACHE_HOME:-$HOME/.cache}/auditor-skill/poc-target/<repo-name>-audit_<n>`,
export it as `CARGO_TARGET_DIR`, and delete it when the engagement ends. Never
point `CARGO_TARGET_DIR` inside the target tree or at a directory you did not
create: cargo trusts the build outputs it finds there.

## Contract

| Arm | Test | Asserts | Meaning |
|-----|------|---------|---------|
| `vulnerable` | `tests/exploit.rs` | `assert_exploit_effect!` | the flaw is real — the attack goes through and leaves a concrete value in the account it targets |
| `fixed` | `tests/fixed_blocked.rs` | `assert_exploit_rejected_with!` | the fix closes it — the same attack is turned away with the guard's exact error |

`src/fixed.rs` is `src/vulnerable.rs` with only the cited guard restored — it is the
patch (`templates/patch/patch.md`) made runnable.

The expected error is a value compared with `==`, never a pattern. To check a fix the
team already deployed, whose error you cannot know in advance, swap in the commented
lines in `tests/fixed_blocked.rs`: `assert_exploit_blocked!` with its positive control.
It passes when a legitimate call (the same instruction, as its rightful caller makes
it) goes through on the same bytes and changes the account, and the attack then fails
with an error that is not a harness error (a wrong program id or account list) and
leaves the account unchanged. A control that fails or changes nothing is inconclusive;
when no legitimate call can show the change on those bytes, pin the fix's error with
`assert_exploit_rejected_with!` instead. `assert_exploit_succeeds!` /
`assert_exploit_rejected!` accept any `Ok` / any error and fit an audit-time model
only.

**Prebuilt bytes.** `VULNERABLE_SO=<.so>` runs the exploit arm alone on those bytes;
adding `FIXED_SO=<.so>` runs the fixed arm on others. Each contract assertion leaves a
marker when it starts and another when it holds, and on prebuilt bytes `run.sh`
accepts an arm only with its assertion's marker. `mollusk_for` records the path and
zero-trimmed sha256 of every program it loads, and an arm counts only when each is the
`.so` `run.sh` placed, still unchanged after the test: load the program under test
only through `mollusk_for`, by name. A test that fails before any contract assertion
ran (the program did not load, the setup panicked) exits `3` (inconclusive), not `1`
or `2`, and so does a fixed arm that fails on a harness error. The markers are a
floor, not proof: read the assertion all the same. Success prints the only line that
can stand for Leg 3 of an incident, naming the bytes that ran:

```
OK: reproduced on prebuilt bytes — vulnerable sha256=<zero-trimmed sha256> → [PoC-REPRODUCED]
```

With `FIXED_SO`, the line also names `fixed sha256=<…>` and how the fixed arm held:
`(rejected with the pinned error)` or `(blocked: failed, account unchanged)`. A run of
this crate's own arms prints a different line: a model is never Leg 3.

## Evidence tier

A green `./run.sh` earns **`[PoC-REPRODUCED]`** for this finding (Mollusk, deterministic
single-instruction). Record it on the finding block. Other tiers and the fallback
ladder — Surfpool `[PoC-SIM-REPRODUCED]`, fuzz `[PoC-FUZZ-REPRODUCED]`, `[PoC-ATTEMPTED]`,
`[PoC-PROSE]` — are defined in `references/orchestration/poc-harness.md`. A downgraded
tier never downgrades the finding's severity; prose is never removed.
