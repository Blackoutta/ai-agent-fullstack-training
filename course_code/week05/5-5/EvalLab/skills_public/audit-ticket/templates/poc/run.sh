#!/usr/bin/env bash
# {FINDING_ID} — one-command proof-of-concept runner.
#
# Reproduces the finding from a clean checkout of THIS crate:
#   1. builds the `vulnerable` arm to SBF, runs tests/exploit.rs      → exploit must SUCCEED
#   2. builds the `fixed`      arm to SBF, runs tests/fixed_blocked.rs → same attack must be REJECTED
# Exit 0: the exploit reproduces on `vulnerable` and, when the fixed arm runs, is
# blocked on `fixed` — the evidence that earns [PoC-REPRODUCED]. Exit 1: the exploit
# did not reproduce. Exit 2: the fixed arm did not block it. Exits 1 and 2 need a
# contract assertion (shared-test-utils) that ran and did not hold. Exit 3: a named
# blocker (toolchain, inputs, a build that failed, the execution mode below) or an
# inconclusive arm (no contract assertion ran, the test failed outside them, the
# harness could not decide, or other bytes ran) — record [PoC-ATTEMPTED] and keep
# the prose PoC.
#
# Why two build+test passes and not one: both arms compile to the SAME `.so`
# filename ({PROGRAM_NAME}.so), so they cannot coexist in SBF_OUT_DIR. Build an arm,
# test it, then overwrite with the other arm. Mollusk loads the `.so`, never the
# host test binary — so the SBF build MUST precede each `cargo test`.
#
# Toolchain: cargo-build-sbf's default bundle is platform-tools v1.51 / cargo 1.84,
# which cannot parse the edition2024 manifests in the mollusk-svm dep tree. We pin
# --tools-version v1.54 (cargo >= 1.85) to build the graph with no dependency edits.
# Override via TOOLS_VERSION=... if the target repo standardizes on a newer one.
#
# EXECUTION MODE. Building this crate runs code on the machine that builds it: the
# build scripts and proc-macros of every dependency, then the tests. So every run
# needs the execution mode recorded for the audit or incident (OUTPUT-RULES.md Rule
# 11a, QUESTIONS.md Q46): AUDITOR_EXEC_MODE=isolated inside the isolated runner, or
# AUDITOR_EXEC_MODE=native (the report then states that the PoC build ran on this
# host). Without it, run.sh exits 3 before it copies or compiles anything.
#
# WHERE IT BUILDS. This crate normally sits inside the audited repo
# (audit_<n>/poc/…, incident_<n>/poc/…). Built there, cargo would read the target's
# .cargo/config* from every parent directory (rustc-wrapper, runner, linker,
# rustflags, an alias that shadows `build-sbf`), and rustup its rust-toolchain*
# (which can name a `path` toolchain, i.e. any binaries). So, in either mode:
#   * a crate that holds a symbolic link, a .cargo/ directory or a rust-toolchain*
#     file is refused (exit 3): the copy below never takes them.
#   * the crate is copied (without target/) into a fresh scratch directory,
#     `mktemp -d "${TMPDIR:-/tmp}/auditor-poc.XXXXXX"`, and built and tested there
#     with RUSTUP_TOOLCHAIN pinned to the caller's value, else rustup's default. The
#     directory is printed, and removed on exit unless KEEP_POC_BUILD=1; the resolved
#     Cargo.lock is copied back next to this file. A `path` dependency that leaves
#     the crate must therefore be absolute.
#   * to reuse compiled dependencies between runs of one audit, export
#     CARGO_TARGET_DIR to a cache directory you created outside any repository —
#     never one inside the target tree or one you did not create: cargo trusts the
#     build outputs it finds there. SBF_OUT_DIR stays in the scratch copy either way.
#   * mollusk looks for {CRATE}.so in tests/fixtures/ and BPF_OUT_DIR before
#     SBF_OUT_DIR, so run.sh unsets BPF_OUT_DIR and refuses a crate holding
#     tests/fixtures/{CRATE}.so: the bytes that run are the arm run.sh placed.
#
# PREBUILT BYTES (incidents under references/detection-response/, or a patch re-run
# against the target's own builds). Leg 3 of `confirmed_exploited` needs the exploit
# to run on the REAL program bytes, not on this crate's minimized arms:
#     VULNERABLE_SO=/path/to/deployed-or-vulnerable.so ./run.sh
# runs the exploit arm alone on those bytes, and adding
#     FIXED_SO=/path/to/patched-or-current.so
# also runs the fixed arm, on the FIXED_SO bytes. FIXED_SO without VULNERABLE_SO
# exits 3.
#   * a bad path, a file without the ELF magic, or a missing `cargo` or `python3`
#     exits 3 (a named precondition failure, never a bare `cp` error).
#   * an arm counts only on a contract assertion that RAN AND HELD:
#     assert_exploit_effect! on the vulnerable bytes; assert_exploit_rejected_with!
#     (our fix: the guard's exact error) or assert_exploit_blocked! (a fix the team
#     deployed, checked against a legitimate call on the same bytes) on the fixed
#     bytes. Each leaves markers in AUDITOR_POC_MARKERS, which run.sh points at a
#     fresh directory per arm; a passing test without its marker exits 3, and so
#     does an arm the harness could not decide. The marker is a floor, not proof:
#     read the assertion all the same.
#   * the bytes that ran are the bytes run.sh placed: mollusk_for (shared-test-utils)
#     records the path and zero-trimmed sha256 of every program it loads, and an arm
#     counts only when each of those hashes is the placed file's and the placed file
#     is unchanged after the test (exit 3 otherwise). Load the program under test
#     through mollusk_for; a runner built another way leaves no record.
#   * success prints the one line that can stand for Leg 3, naming that hash:
#       OK: reproduced on prebuilt bytes — vulnerable sha256=<64 hex> → [PoC-REPRODUCED]
#     or, with FIXED_SO, "... vulnerable sha256=<…> fixed sha256=<…> (<how the
#     fixed arm held>) → [PoC-REPRODUCED]". A build of this crate's own arms prints
#     another line, and a model is never Leg 3.
#   * an incident whose root cause is supply chain / CI is never built natively, and
#     its PoC never builds or links the target's crates in any mode (they may be the
#     payload): it runs on the dumped ELF here, with the template's own crates
#     (OUTPUT-RULES.md Rule 11a).

set -euo pipefail

# ── Fill in ─────────────────────────────────────────────────────────────────────
CRATE="{PROGRAM_NAME}"          # package name == compiled .so base name
# ────────────────────────────────────────────────────────────────────────────────

TOOLS_VERSION="${TOOLS_VERSION:-v1.54}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# ── Execution mode (see EXECUTION MODE above) ───────────────────────────────────
case "${AUDITOR_EXEC_MODE:-}" in
  isolated|native) ;;
  *)
    echo "[PoC-ATTEMPTED] blocker: AUDITOR_EXEC_MODE is '${AUDITOR_EXEC_MODE:-}', not isolated or native — nothing was copied or built." >&2
    echo "Building this crate runs code (dependency build scripts and proc-macros, then the tests), so every run needs the execution mode recorded at intake (OUTPUT-RULES.md Rule 11a, QUESTIONS.md Q46): AUDITOR_EXEC_MODE=isolated inside the isolated runner, or AUDITOR_EXEC_MODE=native (the report then states that the PoC build ran on this host)." >&2
    exit 3
    ;;
esac

VULNERABLE_SO="${VULNERABLE_SO:-}"
FIXED_SO="${FIXED_SO:-}"
PREBUILT=0
if [[ -n "${FIXED_SO}" && -z "${VULNERABLE_SO}" ]]; then
  echo "[PoC-ATTEMPTED] blocker: FIXED_SO needs VULNERABLE_SO — the fixed bytes are checked against the exploit on the vulnerable ones." >&2
  exit 3
fi
if [[ -n "${VULNERABLE_SO}" ]]; then
  for arm in vulnerable fixed; do
    if [[ "${arm}" == vulnerable ]]; then path="${VULNERABLE_SO}"; else path="${FIXED_SO}"; fi
    [[ -n "${path}" ]] || continue
    if [[ ! -f "${path}" ]]; then
      echo "[PoC-ATTEMPTED] blocker: ${arm} .so not found at '${path}'." >&2
      exit 3
    fi
    # ELF magic: 0x7f 'E' 'L' 'F'. A dump that is actually an RPC error or base64
    # text fails here with a named blocker instead of a silent bad run.
    magic="$(head -c 4 "${path}" | od -An -tx1 | tr -d ' \n')"
    if [[ "${magic}" != "7f454c46" ]]; then
      echo "[PoC-ATTEMPTED] blocker: ${arm} file '${path}' is not an ELF (magic=${magic:-empty}); supply the dumped program .so." >&2
      exit 3
    fi
  done
  # The build runs from a scratch directory, so pin the paths absolute now.
  abs_path() {
    local p="$1" d f
    case "${p}" in */*) d="${p%/*}"; f="${p##*/}" ;; *) d="."; f="${p}" ;; esac
    d="$(cd "${d:-/}" && pwd -P)"
    [[ "${d}" == "/" ]] && d=""
    printf '%s/%s\n' "${d}" "${f}"
  }
  VULNERABLE_SO="$(abs_path "${VULNERABLE_SO}")"
  if [[ -n "${FIXED_SO}" ]]; then FIXED_SO="$(abs_path "${FIXED_SO}")"; fi
  # The success line names the zero-trimmed hash of the bytes that ran.
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[PoC-ATTEMPTED] blocker: python3 not on PATH — prebuilt mode names the zero-trimmed sha256 of the bytes it ran, which needs python3." >&2
    exit 3
  fi
  PREBUILT=1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[PoC-ATTEMPTED] blocker: cargo not on PATH — the host test binary cannot be built here." >&2
  echo "The finding's prose PoC stands." >&2
  exit 3
fi
if [[ "${PREBUILT}" -eq 0 ]] && ! command -v cargo-build-sbf >/dev/null 2>&1; then
  echo "[PoC-ATTEMPTED] blocker: cargo-build-sbf not on PATH — install the Solana/Agave toolchain (platform-tools >= ${TOOLS_VERSION}), or pass VULNERABLE_SO/FIXED_SO to run against prebuilt bytes." >&2
  echo "The finding's prose PoC stands; this crate could not be built here." >&2
  exit 3
fi

# ── Where to build (see WHERE IT BUILDS above) ──────────────────────────────────
# No here-documents or here-strings below: bash 3.2 may put their temp files in the
# working directory (it does under a sandbox that denies /tmp), where a listing of
# the crate would pick them up.

# The first symbolic link, .cargo/ or rust-toolchain* inside the crate; prints
# nothing when there is none. copy_crate takes none of them, so a crate holding one
# is refused rather than built in a shape it was not written in.
crate_extra() {
  local found
  found="$(cd "${HERE}" && find . \( -name target -type d \) -prune -o \( -type l -o -name .cargo -o -name 'rust-toolchain*' \) -print)"
  if [[ -n "${found}" ]]; then echo "${found%%$'\n'*}"; fi
  return 0
}

# The first cargo/rustup config file at or above <dir> (the user's own CARGO_HOME
# config excepted), so a scratch directory never inherits one.
inherited_config() {
  local d="$1" f home_cargo="${CARGO_HOME:-${HOME:-/nonexistent}/.cargo}"
  while :; do
    for f in "${d}/.cargo/config" "${d}/.cargo/config.toml" "${d}/rust-toolchain" "${d}/rust-toolchain.toml"; do
      [[ -e "${f}" ]] || continue
      [[ "${f}" == "${home_cargo}/config" || "${f}" == "${home_cargo}/config.toml" ]] && continue
      echo "${f}"; return 0
    done
    [[ "${d}" == "/" ]] && return 0
    d="$(dirname "${d}")"
  done
}

copy_crate() {  # copy_crate <dest> : the crate's files, never target/, .cargo/ or rust-toolchain*
  local list rel IFS=$'\n'
  list="$(cd "${HERE}" && find . \( \( -name target -type d \) -o -name .cargo -o -name 'rust-toolchain*' -o -name .git \) -prune -o -type f -print)" || return 1
  set -f
  for rel in ${list}; do
    if ! { mkdir -p "$1/$(dirname "${rel}")" && cp -p "${HERE}/${rel}" "$1/${rel}"; }; then
      set +f; return 1
    fi
  done
  set +f
  return 0
}

finish() {  # keep the resolved Cargo.lock with the crate; drop the scratch directory
  if [[ -f "${BUILD_DIR}/Cargo.lock" ]]; then
    cp -p "${BUILD_DIR}/Cargo.lock" "${HERE}/Cargo.lock" 2>/dev/null || true
  fi
  case "${BUILD_DIR}" in
    */auditor-poc.*) if [[ "${KEEP_POC_BUILD:-0}" != 1 ]]; then rm -rf "${BUILD_DIR}" || true; fi ;;
  esac
  return 0
}

extra="$(crate_extra)"
if [[ -n "${extra}" ]]; then
  echo "[PoC-ATTEMPTED] blocker: ${extra#./} inside the crate is a symbolic link, a .cargo/ directory or a rust-toolchain* file. run.sh builds a copy of the crate outside the target tree and never copies these; remove it (for a link, copy in the file itself)." >&2
  exit 3
fi
if [[ -e "${HERE}/tests/fixtures/${CRATE}.so" ]]; then
  echo "[PoC-ATTEMPTED] blocker: tests/fixtures/${CRATE}.so would load in place of the arm run.sh puts in SBF_OUT_DIR (mollusk looks in tests/fixtures first); remove it." >&2
  exit 3
fi
if ! BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/auditor-poc.XXXXXX")"; then
  echo "[PoC-ATTEMPTED] blocker: cannot create a scratch build directory under ${TMPDIR:-/tmp}." >&2
  exit 3
fi
BUILD_DIR="$(cd "${BUILD_DIR}" && pwd -P)"
trap finish EXIT
inherited="$(inherited_config "${BUILD_DIR}")"
if [[ -n "${inherited}" ]]; then
  echo "[PoC-ATTEMPTED] blocker: the scratch build directory ${BUILD_DIR} would inherit ${inherited}; point TMPDIR outside any repository." >&2
  exit 3
fi
if ! copy_crate "${BUILD_DIR}"; then
  echo "[PoC-ATTEMPTED] blocker: could not copy the crate into ${BUILD_DIR}." >&2
  exit 3
fi
# Pin the toolchain instead of letting rustup look for a rust-toolchain file.
if [[ -z "${RUSTUP_TOOLCHAIN:-}" ]] && command -v rustup >/dev/null 2>&1; then
  default_tc="$(cd "${BUILD_DIR}" && rustup default 2>/dev/null || true)"
  case "${default_tc}" in
    *"(default)"*) export RUSTUP_TOOLCHAIN="${default_tc%% *}" ;;
    *) echo "[PoC-ATTEMPTED] blocker: no Rust toolchain to pin — set RUSTUP_TOOLCHAIN or a rustup default." >&2
       exit 3 ;;
  esac
fi
# mollusk reads BPF_OUT_DIR before SBF_OUT_DIR; only the arm placed below may load.
unset BPF_OUT_DIR
export SBF_OUT_DIR="${BUILD_DIR}/target/deploy"
if ! { cd "${BUILD_DIR}" && mkdir -p "${SBF_OUT_DIR}"; }; then
  echo "[PoC-ATTEMPTED] blocker: cannot prepare ${SBF_OUT_DIR}." >&2
  exit 3
fi
echo ">> build dir: ${BUILD_DIR} (scratch copy outside the target tree; AUDITOR_EXEC_MODE=${AUDITOR_EXEC_MODE}; toolchain ${RUSTUP_TOOLCHAIN:-unpinned: no rustup}; $([[ "${KEEP_POC_BUILD:-0}" == 1 ]] && echo kept || echo removed on exit))"

# Print the .so path and a solana-verify-style hash: trailing zero padding (the
# loader pads a program account well past the ELF — a live JUP6 dump carried
# ~892 KB of it) is trimmed before hashing, so the digest matches `solana-verify`.
# python3 runs isolated (-I): `python3 -c` would otherwise import a hashlib.py from
# the caller's working directory, or from PYTHONPATH, in place of the stdlib.
elf_hash() {
  local path="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -I -c 'import hashlib, sys; b = open(sys.argv[1], "rb").read().rstrip(b"\0"); print(hashlib.sha256(b).hexdigest())' "$path"
  else
    echo "(hash unavailable: python3 not found)"
  fi
}

place_arm() {  # place_arm <arm> : put {CRATE}.so in SBF_OUT_DIR for this arm; PLACED_HASH names its bytes
  local arm="$1" so="${SBF_OUT_DIR}/${CRATE}.so"
  if [[ "${PREBUILT}" -eq 1 ]]; then
    local src; [[ "${arm}" == "vulnerable" ]] && src="${VULNERABLE_SO}" || src="${FIXED_SO}"
    if ! cp -f "${src}" "${so}"; then
      echo "[PoC-ATTEMPTED] blocker: could not place the ${arm} .so from ${src}." >&2
      exit 3
    fi
    echo ">> ${arm} arm: prebuilt ${src}"
  else
    echo ">> building '${arm}' arm to SBF (${CRATE}.so)"
    if ! cargo build-sbf \
      --tools-version "${TOOLS_VERSION}" \
      --manifest-path "${BUILD_DIR}/Cargo.toml" \
      --no-default-features --features "${arm}" \
      --sbf-out-dir "${SBF_OUT_DIR}"; then
      echo "[PoC-ATTEMPTED] blocker: SBF build failed for the ${arm} arm — see the cargo output above." >&2
      exit 3
    fi
  fi
  PLACED_HASH="$(elf_hash "${so}")" || PLACED_HASH=""
  if [[ "${PREBUILT}" -eq 1 && ! "${PLACED_HASH}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "[PoC-ATTEMPTED] blocker: could not hash the placed ${arm} .so ${so}." >&2
    exit 3
  fi
  echo "   ${arm} .so: ${so}"
  echo "   ${arm} sha256 (zero-trimmed): ${PLACED_HASH}"
}

build_tests() {  # build_tests <arm> <test>: a test binary that does not compile is a blocker, not a verdict
  if ! cargo test --manifest-path "${BUILD_DIR}/Cargo.toml" \
        --no-default-features --features "$1" --test "$2" --no-run; then
    echo "[PoC-ATTEMPTED] blocker: tests/$2.rs failed to build for the $1 arm — see the cargo output above." >&2
    exit 3
  fi
}

run_tests() {  # run_tests <arm> <test>: the arm's test, with an empty marker directory of its own
  local dir="${BUILD_DIR}/markers/$1"
  if ! { rm -rf "${dir}" && mkdir -p "${dir}"; }; then
    echo "[PoC-ATTEMPTED] blocker: cannot prepare the marker directory ${dir}." >&2
    exit 3
  fi
  AUDITOR_POC_MARKERS="${dir}" cargo test --manifest-path "${BUILD_DIR}/Cargo.toml" \
    --no-default-features --features "$1" --test "$2" -- --nocapture
}

marker() {  # marker <arm> <kind>: the first line of the marker an assertion left, if any
  local file="${BUILD_DIR}/markers/$1/$2"
  [[ -s "${file}" ]] && head -n 1 "${file}"
}

count() {  # count <arm> <kind>: how many lines the arm's <kind> marker holds
  local file="${BUILD_DIR}/markers/$1/$2"
  if [[ -f "${file}" ]]; then awk 'END { print NR }' "${file}"; else echo 0; fi
}

inconclusive() {  # inconclusive <arm> <reason>: the arm decided nothing — a blocker, never a verdict
  local what="whether the fix holds"
  [[ "$1" == vulnerable ]] && what="whether the exploit reproduces"
  echo "[PoC-ATTEMPTED] blocker: the $1 arm is inconclusive: $2. This run does not show ${what}; fix the PoC and re-run." >&2
  exit 3
}

# ran_placed <arm>: the arm's test loaded program bytes through mollusk_for, every load
# named the bytes place_arm put in SBF_OUT_DIR, and those bytes are still there.
# Otherwise it sets WHY and fails.
ran_placed() {
  local file="${BUILD_DIR}/markers/$1/loaded" other
  if [[ ! -s "${file}" ]]; then
    WHY="no program was loaded through mollusk_for, so which bytes ran is unknown"
    return 1
  fi
  other="$(awk -v want="${PLACED_HASH}" '$1 != want { print; exit }' "${file}")"
  if [[ -n "${other}" ]]; then
    WHY="the test loaded bytes other than the ones run.sh placed (sha256 and path: ${other})"
    return 1
  fi
  if [[ "$(elf_hash "${SBF_OUT_DIR}/${CRATE}.so")" != "${PLACED_HASH}" ]]; then
    WHY="the placed .so changed while the test ran"
    return 1
  fi
  return 0
}

# settle <arm> <status>: the verdict on an arm from its test's exit status and the
# markers it left. Returns 1 for a verdict against the arm — a contract assertion ran
# (on the placed bytes, for prebuilt bytes) and did not hold; returns 0 for a pass;
# exits 3 for everything else.
settle() {
  local arm="$1" status="$2" why attempted held
  if why="$(marker "${arm}" inconclusive)"; then inconclusive "${arm}" "${why}"; fi
  attempted="$(count "${arm}" attempted)"
  held="$(count "${arm}" held)"
  if [[ "${status}" -ne 0 ]]; then
    if [[ "${attempted}" -eq 0 ]]; then
      inconclusive "${arm}" "no contract assertion ran; the test failed before one (did the program load?)"
    fi
    if [[ "${PREBUILT}" -eq 1 ]] && ! ran_placed "${arm}"; then inconclusive "${arm}" "${WHY}"; fi
    if [[ "${attempted}" -le "${held}" ]]; then
      inconclusive "${arm}" "every contract assertion that ran held, so the test failed outside them"
    fi
    return 1
  fi
  if [[ "${PREBUILT}" -eq 1 ]]; then
    if [[ "${attempted}" -ne "${held}" ]]; then
      inconclusive "${arm}" "a contract assertion ran and did not hold, yet the test passed"
    fi
    if ! ran_placed "${arm}"; then inconclusive "${arm}" "${WHY}"; fi
  fi
  return 0
}

WHY=""

# 1. vulnerable arm — the exploit must land.
place_arm vulnerable
VULNERABLE_HASH="${PLACED_HASH}"
build_tests vulnerable exploit
echo ">> running exploit against 'vulnerable' (expect: SUCCEEDS)"
status=0
run_tests vulnerable exploit || status=$?
if ! settle vulnerable "${status}"; then
  echo "FAIL: exploit did not reproduce on the vulnerable arm — PoC is not valid." >&2
  exit 1
fi
if [[ "${PREBUILT}" -eq 1 ]]; then
  if ! effect="$(marker vulnerable effect)"; then
    echo "[PoC-ATTEMPTED] blocker: tests/exploit.rs passed on the prebuilt bytes, but no assert_exploit_effect! ran and held — Ok alone proves nothing on real bytes; assert the effect the attack leaves (shared-test-utils)." >&2
    exit 3
  fi
  echo "   effect: ${effect}"
  if [[ -z "${FIXED_SO}" ]]; then
    echo "OK: reproduced on prebuilt bytes — vulnerable sha256=${VULNERABLE_HASH} → [PoC-REPRODUCED]"
    exit 0
  fi
fi

# 2. fixed arm — the same attack must be turned away.
place_arm fixed
build_tests fixed fixed_blocked
echo ">> running same attack against 'fixed' (expect: REJECTED)"
status=0
run_tests fixed fixed_blocked || status=$?
if ! settle fixed "${status}"; then
  echo "FAIL: the fixed arm did not block the attack — fix is incomplete." >&2
  exit 2
fi
if [[ "${PREBUILT}" -eq 0 ]]; then
  echo "OK: exploit reproduces on 'vulnerable' and is blocked on 'fixed' (this crate's own arms: a model, never Leg 3)  → [PoC-REPRODUCED]"
  exit 0
fi
if held="$(marker fixed rejected_with)"; then
  how="rejected with the pinned error"
elif held="$(marker fixed blocked)"; then
  how="blocked: failed, account unchanged"
else
  echo "[PoC-ATTEMPTED] blocker: tests/fixed_blocked.rs passed on the prebuilt bytes, but neither assert_exploit_rejected_with! nor assert_exploit_blocked! ran and held — any Err is not a fix on real bytes." >&2
  exit 3
fi
echo "   fixed arm: ${held}"
echo "OK: reproduced on prebuilt bytes — vulnerable sha256=${VULNERABLE_HASH} fixed sha256=${PLACED_HASH} (${how}) → [PoC-REPRODUCED]"
