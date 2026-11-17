#!/usr/bin/env bash
# snapshot-program.sh — preserve the deployed program bytes BEFORE anything else.
#
#   bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/snapshot-program.sh" <program_id> <incident_dir>
#
# $RPC_URL must already be exported (never typed on the command line). Run it from
# the installation, never as a relative scripts/ path: the audited repo may ship a
# same-named file.
#
# Why first: a hotfix upgrade overwrites the on-chain ELF. If the team ships a fix
# while the hunt is running, the incident binary is gone, and Leg 3 of
# `confirmed_exploited` (a PoC on the real bytes) can no longer be met. So step 1 of
# /auditor:hunt and /auditor:respond runs this for every implicated program, before
# any collection or analysis.
#
# What it does (read-only — no signing, and no keypair the CLI could sign with):
#   1. writes a throwaway CLI config in a private temp dir (mode 0700, removed on
#      exit): `json_rpc_url` is $RPC_URL, so the URL never appears in argv, and
#      `keypair_path` names a file that does not exist. `solana config get keypair`
#      must report that path back, or the CLI fell back to its defaults and the
#      script stops with a blocker.
#   2. `solana -C <config> program show <id>` into the temp dir (with a fixed
#      `--buffer-authority`, so the CLI never looks for a signer). It rejects a
#      loader-v4 program as "not an SBF program"; that one is read with
#      `program-v4 show --program-id <id>` (a fixed `--authority`, for the same
#      reason), and an account neither command reads stops with a blocker.
#   3. `solana -C <config> program dump <id>` (loader-v4: `program-v4 download
#      --program-id <id>`) into the temp dir, then `show` again: the slot and the
#      bytes come from separate reads, so a slot that moved means a deploy landed
#      in between. The dump is then taken once more, and a slot that moves again
#      stops the script with a blocker.
#   4. checks the ELF magic, hashes the dump the way solana-verify does (trailing
#      zero padding trimmed, then sha256), keeps the dump and the show output in
#      <incident_dir>/bin/, and prints ONE ledger-ready line:
#        program=<id> owner=<loader> last_deployed_slot=<N> authority=<A>
#        sha256_zero_trimmed=<hex> elf_bytes=<n> padding_bytes=<n> file=bin/<id>.so
#      A program under an immutable loader (BPFLoader2, or the older BPFLoader) has
#      no deploy slot and no authority: last_deployed_slot=n/a (immutable loader).
#
# NEVER OVERWRITTEN: the first snapshot is bin/<id>.so + bin/<id>.show.txt, the
# incident-time bytes that Leg 3 and the patch flow run on. A later run (respond
# runs this again after the hunt) compares the program on-chain with every
# snapshot already in bin/:
#   * the same last-deployed slot and zero-trimmed sha256 as one of them: it prints
#     "unchanged" and that snapshot's line, writes nothing, and exits 0;
#   * otherwise it keeps the current bytes as bin/<id>@<slot>.so and
#     bin/<id>@<slot>.show.txt, and prints the first snapshot's line and the new one.
# Files are written with noclobber (`set -C`): a name already taken stops the
# script with a blocker instead of being replaced.
#
# Compare `last_deployed_slot` to the incident slot: earlier → this dump IS the
# incident binary (binary_provenance: dumped-unchanged); later → a newer upgrade
# replaced it (dumped-after-hotfix; the incident bytes need an archived binary or a
# solana-verify hash-matched build).
#
# RUN DIRECTORY: <incident_dir>, and the nearest incident_* directory above it, must
# not be a symbolic link, hold one, or be tracked by git, and git and find must be
# able to check it; any other directory is refused with exit 2 before anything is
# written or the CLI runs.
#
# SECRETS: the CLI reads "$RPC_URL" from the temp config, never from argv; an
# $RPC_URL holding a quote, a backslash, whitespace or a control character is refused.
# The CLI's stderr is captured to a temp file and passed through redact.sh (the CLI
# echoes the full URL, key included, in its errors). Nothing written to
# <incident_dir> contains the URL.
#
# Exit: 0 ok · 2 usage / not a base58 32-byte public key / no or unusable $RPC_URL /
# a refused run directory · 3 named blocker (no solana CLI or python3, config not
# taken, CLI error or no program under any loader, dump without ELF magic, the
# last-deployed slot moving during two dumps, hash not computed, a snapshot name
# already taken).
# bash >= 3.2, and python3 for the id check and the hash: checked before the CLI
# runs, and run as `python3 -I` because the working directory is usually the audited
# repo: without -I, a hashlib.py there would be imported in place of the stdlib.

# -C (noclobber): no redirection in this script replaces an existing file.
set -Cuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REDACT="$HERE/redact.sh"

pid="${1:-}"; dir="${2:-}"
if [ -z "$pid" ] || [ -z "$dir" ]; then
  echo "usage: snapshot-program.sh <program_id> <incident_dir>" >&2
  exit 2
fi
# The id becomes part of file names under <incident_dir>/bin/: accept only a base58
# public key (32-44 characters of the Bitcoin alphabet), so it cannot carry a path;
# that it decodes to 32 bytes is checked once python3 is known to be there.
if ! [[ "$pid" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
  echo "snapshot-program.sh: '$pid' is not a base58 program id (32-44 characters of [1-9A-HJ-NP-Za-km-z])." >&2
  exit 2
fi
if [ -z "${RPC_URL:-}" ]; then
  echo "snapshot-program.sh: set \$RPC_URL in the environment." >&2
  exit 2
fi
# The URL goes into a quoted YAML value: refuse what could end or escape it.
case "$RPC_URL" in
  *[[:space:][:cntrl:]\"\\]*)
    echo "snapshot-program.sh: \$RPC_URL holds a quote, a backslash, whitespace or a control character; refusing it." >&2
    exit 2 ;;
esac
case "$dir" in */) dir="${dir%"${dir##*[!/]}"}"; [ -n "$dir" ] || dir=/ ;; esac

# refuse_planted <dir>: exit 2 unless <dir> is safe to write into — not a symbolic
# link, holding none, and not tracked by git. The git calls carry the Rule 11c flags,
# because the tree is usually the audited one. Outside a work tree nothing is tracked;
# inside one, a path git cannot classify is refused, and so is a directory find
# cannot read: a check that cannot run never counts as a pass.
refuse_planted() {
  local listed top
  if [ -L "$1" ]; then
    echo "${0##*/}: refusing $1: it is a symbolic link — use a new run directory." >&2; exit 2
  fi
  if [ -d "$1" ] && { listed="$(find "$1" -type l -print -quit 2>/dev/null)"; [ $? -ne 0 ] || [ -n "$listed" ]; }; then
    echo "${0##*/}: refusing $1: it contains a symbolic link, or a directory find cannot read — use a new run directory." >&2; exit 2
  fi
  [ -d "$(dirname "$1")" ] || return 0
  # A .git at or above the directory means git must answer; with none, nothing is tracked.
  if ! top="$(cd "$(dirname "$1")" && pwd -P)"; then
    echo "${0##*/}: refusing $1: its parent directory cannot be resolved." >&2; exit 2
  fi
  while [ ! -e "$top/.git" ]; do [ "$top" = / ] && return 0; top="$(dirname "$top")"; done
  if ! listed="$(GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false -C "$(dirname "$1")" --icase-pathspecs \
        ls-files -- ":(literal,icase)$(basename "$1")" 2>/dev/null)"; then
    echo "${0##*/}: refusing $1: it is inside a git work tree and git cannot tell whether it is tracked (git missing, or it does not trust this repository)." >&2; exit 2
  fi
  if [ -n "$listed" ]; then
    echo "${0##*/}: refusing $1: git tracks it, so it is not a run directory to write into." >&2; exit 2
  fi
  return 0
}
# <incident_dir>, and the nearest incident_* directory above it, checked as a whole.
refuse_planted "$dir"
run_dir="$dir"
while :; do
  case "$(basename "$run_dir")" in incident_*) [ "$run_dir" = "$dir" ] || refuse_planted "$run_dir"; break ;; esac
  case "$run_dir" in .|/) break ;; esac
  run_dir="$(dirname "$run_dir")"
done

if ! command -v solana >/dev/null 2>&1; then
  echo "[blocker] solana CLI not on PATH — install it, or dump the program another way and record its zero-trimmed sha256 and last-deployed slot in LEDGER.md by hand." >&2
  exit 3
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[blocker] python3 not on PATH — it checks the id and hashes the dump; install it, or snapshot $pid by hand and record its zero-trimmed sha256 and last-deployed slot in LEDGER.md." >&2
  exit 3
fi
# The CLI takes an id that is not 32 bytes as no id at all: `program-v4 show` then
# lists every loader-v4 program of the authority instead of failing.
case "$(python3 -I -c 'import sys
a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
n = 0
for c in sys.argv[1]:
    n = n * 58 + a.index(c)
print(len(sys.argv[1]) - len(sys.argv[1].lstrip("1")) + (n.bit_length() + 7) // 8)' "$pid" 2>/dev/null)" in
  32) ;;
  [0-9]*) echo "snapshot-program.sh: '$pid' does not decode to a 32-byte public key." >&2; exit 2 ;;
  *) echo "[blocker] python3 -I did not run; snapshot $pid by hand and record its zero-trimmed sha256 and last-deployed slot in LEDGER.md." >&2; exit 3 ;;
esac

# mktemp -d creates the directory with mode 0700.
tmp="$(mktemp -d "${TMPDIR:-/tmp}/dnr_snap.XXXXXX")" || {
  echo "[blocker] cannot create a private temp directory for the CLI config." >&2; exit 3; }
trap 'rm -rf "$tmp"' EXIT
err="$tmp/stderr"; cfg="$tmp/cli.yml"; nokey="$tmp/no-keypair.json"
printf 'json_rpc_url: "%s"\nwebsocket_url: ""\nkeypair_path: "%s"\n' "$RPC_URL" "$nokey" > "$cfg"
# A config the CLI cannot parse is silently replaced by its defaults (public
# mainnet-beta and the default keypair), so confirm it took this one.
case "$(solana -C "$cfg" config get keypair 2>/dev/null)" in
  *"$nokey"*) ;;
  *) echo "[blocker] the solana CLI did not load the keyless config; snapshot $pid by hand and record its zero-trimmed sha256 and last-deployed slot in LEDGER.md." >&2
     exit 3 ;;
esac

show="$tmp/show.txt"; dump="$tmp/dump.so"; v4=0
# show_program <file>: the program's `show` output. --buffer-authority and
# --authority only matter for listings; naming one (the System Program id) stops
# the CLI from resolving a default signer.
show_program() {
  rm -f "$1" "$err"
  if [ "$v4" -eq 1 ]; then
    solana -C "$cfg" program-v4 show --program-id "$pid" --authority 11111111111111111111111111111111 >"$1" 2>"$err"
  else
    solana -C "$cfg" program show "$pid" --buffer-authority 11111111111111111111111111111111 >"$1" 2>"$err"
  fi
}
# dump_program <file>: the program's bytes, as the CLI writes them.
dump_program() {
  rm -f "$1" "$err"
  if [ "$v4" -eq 1 ]; then
    solana -C "$cfg" program-v4 download --program-id "$pid" "$1" >/dev/null 2>"$err"
  else
    solana -C "$cfg" program dump "$pid" "$1" >/dev/null 2>"$err"
  fi
}
field() { awk -F': *' -v k="$1" '$1 == k {print $2; exit}' "$2" 2>/dev/null; }
# slot_of <show output>: the last-deployed slot; an immutable loader has none.
slot_of() {
  case "$(field "Owner" "$1")" in
    BPFLoader2111111111111111111111111111111111|BPFLoader1111111111111111111111111111111111)
      echo "n/a (immutable loader)" ;;
    *) field "Last Deployed In Slot" "$1" ;;
  esac
}

# `program show` reads upgradeable and immutable-loader programs and rejects a
# loader-v4 one, which `program-v4 show` reads.
if ! show_program "$show"; then
  mv "$err" "$tmp/stderr.show"
  v4=1
  if ! show_program "$show" || [ "$(field "Owner" "$show")" != LoaderV411111111111111111111111111111111111 ]; then
    echo "[blocker] neither solana program show nor program-v4 show reads $pid as a program:" >&2
    "$REDACT" <"$tmp/stderr.show" >&2
    "$REDACT" <"$err" >&2
    exit 3
  fi
fi
slot="$(slot_of "$show")"; seen="$slot"; dumps=0
# Read the slot again after each dump; a deploy in between means the bytes may be
# the newer program's, so dump once more, and stop if the slot moves again.
while :; do
  if ! dump_program "$dump"; then
    echo "[blocker] the solana CLI could not dump $pid:" >&2
    "$REDACT" <"$err" >&2
    exit 3
  fi
  dumps=$((dumps + 1))
  if ! show_program "$show"; then
    echo "[blocker] the solana CLI could not read $pid again after the dump:" >&2
    "$REDACT" <"$err" >&2
    exit 3
  fi
  now="$(slot_of "$show")"
  [ "$now" = "$slot" ] && break
  seen="$seen -> $now"
  if [ "$dumps" -ge 2 ]; then
    echo "[blocker] the last-deployed slot of $pid moved during both dumps ($seen): deploys are still landing. Run the snapshot again once they stop; nothing was written." >&2
    exit 3
  fi
  echo "  ! the last-deployed slot of $pid moved during the dump ($seen); dumping again" >&2
  slot="$now"
done

magic="$(head -c 4 "$dump" | od -An -tx1 | tr -d ' \n')"
if [ "$magic" != "7f454c46" ]; then
  echo "[blocker] dump of $pid is not an ELF (magic=${magic:-empty}); not usable as program bytes." >&2
  exit 3
fi

# hash_of <file>: "<sha256 of the bytes without trailing zeros> <their length> <padding length>"
hash_of() {
  python3 -I -c 'import hashlib, sys
raw = open(sys.argv[1], "rb").read()
trimmed = raw.rstrip(b"\0")
print(hashlib.sha256(trimmed).hexdigest(), len(trimmed), len(raw) - len(trimmed))' "$1" 2>/dev/null
}
re='^[0-9a-f]{64} [0-9]+ [0-9]+$'
hashed() {  # hashed <file>: hash_of, or a blocker
  local s
  s="$(hash_of "$1")"
  if ! [[ "$s" =~ $re ]]; then
    echo "[blocker] python3 -I did not hash ${1#"$dir/"}; hash it by hand (trailing zero bytes trimmed, then sha256)." >&2
    exit 3
  fi
  echo "$s"
}
sha="$(hashed "$dump")" || exit 3
sha="${sha%% *}"
# ledger_line <.so> <.show.txt>: the line for one snapshot kept in bin/.
ledger_line() {
  local s o l a
  s="$(hashed "$1")" || exit 3
  o="$(field "Owner" "$2")"; l="$(slot_of "$2")"; a="$(field "Authority" "$2")"
  # shellcheck disable=SC2086
  set -- "${1#"$dir/"}" $s
  echo "program=$pid owner=${o:-unknown} last_deployed_slot=${l:-unknown} authority=${a:-none} sha256_zero_trimmed=$2 elf_bytes=$3 padding_bytes=$4 file=$1"
}
# keep <temp file> <path in bin/>: copy under a name that must still be free. With
# set -C the `: >` fails on a taken name, so a kept snapshot is never replaced.
keep() {
  if ! { : > "$2"; } 2>/dev/null; then
    echo "[blocker] ${2#"$dir/"} already exists; a snapshot is never overwritten, and nothing replaced it." >&2
    exit 3
  fi
  if ! cat "$1" >> "$2"; then
    rm -f "$2"
    echo "[blocker] could not write ${2#"$dir/"}." >&2
    exit 3
  fi
}

mkdir -p "$dir/bin" || exit 2
# Rule 11d: an incident_<n>/ directory ignores itself when it has no .gitignore of
# its own, so the dumped program never shows in git status.
case "$(basename "$dir")" in
  incident_*) [ -e "$dir/.gitignore" ] || printf '*\n' > "$dir/.gitignore" ;;
esac
first="$dir/bin/$pid.so"; first_show="$dir/bin/$pid.show.txt"
if [ ! -e "$first" ] && [ ! -e "$first_show" ]; then
  keep "$dump" "$first"; keep "$show" "$first_show"
  ledger_line "$first" "$first_show"
  exit 0
fi
if [ ! -e "$first" ]; then
  echo "[blocker] bin/$pid.show.txt exists without bin/$pid.so (an earlier snapshot did not finish): move it aside and run again; it is never overwritten." >&2
  exit 3
fi
# A later run: the program on-chain may be a snapshot already kept.
for f in "$first" "$dir/bin/$pid"@*.so; do
  [ -f "$f" ] || continue
  if [ "$(slot_of "${f%.so}.show.txt")" = "$slot" ] \
     && [ "$(hash_of "$f" | cut -d' ' -f1)" = "$sha" ]; then
    echo "unchanged: the program on-chain matches ${f#"$dir/"} (same last-deployed slot and zero-trimmed sha256); nothing written"
    ledger_line "$f" "${f%.so}.show.txt"
    exit 0
  fi
done
case "$slot" in
  ''|*[!0-9]*)
    echo "[blocker] the program on-chain differs from every snapshot in bin/, and its last-deployed slot ('$slot') cannot name a new one; nothing written." >&2
    exit 3 ;;
esac
new="$dir/bin/$pid@$slot.so"; new_show="$dir/bin/$pid@$slot.show.txt"
if [ -e "$new" ] || [ -e "$new_show" ]; then
  echo "[blocker] bin/$pid@$slot.so or bin/$pid@$slot.show.txt already exists, with other bytes than the program on-chain; it is never overwritten, and nothing was written." >&2
  exit 3
fi
keep "$dump" "$new"; keep "$show" "$new_show"
echo "changed since bin/$pid.so: the current bytes are kept as bin/$pid@$slot.so; bin/$pid.so stays the first snapshot"
ledger_line "$first" "$first_show"
ledger_line "$new" "$new_show"
