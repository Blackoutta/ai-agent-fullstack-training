#!/usr/bin/env bash
# collect.sh — threat-model bootstrap collector (read-only on the target repository).
#
# Gathers history-derived leads for /auditor:threat-model: security-keyword commits, reverts, removed
# or quietly added account guards, churn, an optional fork-parent comparison, provenance signals,
# prior-vulnerability inputs and the audit-mem warm block. It never checks out, builds, runs, fetches
# into or modifies the target: lazy fetching and transport protocols are off, and a partial clone is
# refused. Output contract: references/audit-lifecycle/threat-model-bootstrap.md.
# Git hardening follows OUTPUT-RULES.md Rule 11c; the output directory follows Rule 11d.
#
# Usage (from the installation, never as a scripts/ path relative to the working directory):
#   bash "${CLAUDE_PLUGIN_ROOT}/scripts/threat-model/collect.sh" --repo <dir> --out <audit_n>/bootstrap [options]
#   bash "${CLAUDE_PLUGIN_ROOT}/scripts/threat-model/collect.sh" --repo <dir> --out <audit_n>/bootstrap --detect
#
# Options:
#   --pin <rev>               commit to analyse (default HEAD); only its ancestry is mined
#   --paths <pathspec>        target pathspec, repeatable (default 'programs/*.rs' when the commit has
#                             a programs/ dir, else '*.rs'); pass the in-scope program dirs
#   --parent <https-url|dir>  fork parent: https URL (bare clone into a temp dir) or the top level of a
#                             local repository
#   --parent-paths <spec>     parent pathspec, repeatable (default: the same rule, applied to the parent)
#   --import <rev>            target commit that imported the parent code (default: the root commit);
#                             pass it when the code arrived after the root commit, or R5 finds no match
#   --vulns <file|https-url>  prior-vulnerability input, repeatable: PDF, Markdown, text, CSV, JSON,
#                             or INCIDENTS.json (schema auditor-incidents/1; allowlisted fields only); a
#                             local path that is a symbolic link, or passes through a directory link in
#                             the target tree, is skipped
#   --program-id <id>         save `audit-mem warm --program-id <id>` from the --audit-mem-db store
#                             (needs the built tool)
#   --audit-mem-db <path>     audit-mem store that --program-id reads; nothing is read without it (the
#                             collector never looks for a store in the target tree)
#   --keywords <ere>          extra commit-message keywords, an ERE alternation such as 'drain|bypass'
#   --offline                 never use the network; --parent / --vulns URLs are recorded, not fetched
#   --detect                  only evaluate triggers T3 and T4, print them and exit (writes nothing)
#   --cap <n>                 rows per section before TRUNCATED (default 60)
#   --small <n>               changed-line ceiling for a quiet-fix candidate commit (default 40)
#   --fix-ceiling <n>         changed-line ceiling for a keyword commit's ADDED rows (default 300)
#
# Exit status: 0 done (sections may print NOT FOUND), 2 usage error or rejected input (including an
#              --import that is not a commit, and a run directory that is or holds a symbolic link,
#              that git tracks, or that git or find cannot check),
#              3 --repo is not the top level of a git repository (or a bare repository), the pin
#              does not resolve, or the target is a partial clone (reading it could fetch from its
#              promisor remote) or git cannot read its config.

set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
# No git call may fetch a missing object from a promisor remote (partial clones are refused below too).
export GIT_NO_LAZY_FETCH=1 LC_ALL=C

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
SKILL_ROOT=$(cd "$SELF_DIR/../.." && pwd)
COLLECTOR_VERSION=1

die() { echo "collect.sh: $*" >&2; exit 2; }

# ---- arguments ------------------------------------------------------------------------------------
REPO="" OUT="" PIN="HEAD" PARENT="" IMPORT="" PROGRAM_ID="" AUDIT_MEM_DB="" EXTRA_KW=""
OFFLINE=0 DETECT=0 CAP=60 SMALL=40 FIX_CEILING=300
TPATHS_NL="" PPATHS_NL="" VULNS_NL=""
nl=$'\n'

need() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)          need "$@"; REPO=$2; shift 2 ;;
    --out)           need "$@"; OUT=$2; shift 2 ;;
    --pin)           need "$@"; PIN=$2; shift 2 ;;
    --paths)         need "$@"; TPATHS_NL="$TPATHS_NL$2$nl"; shift 2 ;;
    --parent)        need "$@"; PARENT=$2; shift 2 ;;
    --parent-paths)  need "$@"; PPATHS_NL="$PPATHS_NL$2$nl"; shift 2 ;;
    --import)        need "$@"; IMPORT=$2; shift 2 ;;
    --vulns)         need "$@"; VULNS_NL="$VULNS_NL$2$nl"; shift 2 ;;
    --program-id)    need "$@"; PROGRAM_ID=$2; shift 2 ;;
    --audit-mem-db)  need "$@"; AUDIT_MEM_DB=$2; shift 2 ;;
    --keywords)      need "$@"; EXTRA_KW=$2; shift 2 ;;
    --offline)       OFFLINE=1; shift ;;
    --detect)        DETECT=1; shift ;;
    --cap)           need "$@"; CAP=$2; shift 2 ;;
    --small)         need "$@"; SMALL=$2; shift 2 ;;
    --fix-ceiling)   need "$@"; FIX_CEILING=$2; shift 2 ;;
    -h|--help)       sed -n '2,/^$/p' "$0"; exit 0 ;;
    *)               die "unknown argument: $1 (see --help)" ;;
  esac
done
[ -n "$REPO" ] || die "--repo is required"
[ -n "$OUT" ]  || die "--out is required"
# The run directory and its audit_<n> parent are checked by name below, so --out is a plain path: no "."
# or ".." component (a leading "./" aside) and no trailing slash, which would resolve a final link.
OUT=${OUT#./}
case "/$OUT/" in */./*|*/../*) die "--out takes a plain path without . or .. components: $OUT" ;; esac
while [ "${OUT%/}" != "$OUT" ] && [ "$OUT" != / ]; do OUT=${OUT%/}; done
case "$CAP" in ''|*[!0-9]*) die "--cap must be a number" ;; esac
case "$SMALL" in ''|*[!0-9]*) die "--small must be a number" ;; esac
case "$FIX_CEILING" in ''|*[!0-9]*) die "--fix-ceiling must be a number" ;; esac

# Only https URLs are ever fetched, and only when the user passed them explicitly. Any other scheme,
# and scp-style "host:path" (a colon before the first slash), is rejected. Anything else is a local
# file or repository path. Pure parameter expansion: no pipeline whose early exit could flip the answer.
classify_source() {
  case "$1" in
    https://*) echo url ;;
    *://*)     echo rejected ;;
    *)         case "${1%%/*}" in *:*) echo rejected ;; *) echo path ;; esac ;;
  esac
}
# URLs are written to history.md, inputs.tsv and stderr without the parts that carry credentials or
# signed tokens: the userinfo, the query string and the fragment of a URL become ***. redact_urls
# filters text (any URL at the start of a line or after a space); redact does one value.
redact_urls() {
  sed -E -e 's%(^|[[:space:]])([A-Za-z][A-Za-z0-9+.-]*://)[^/@?#[:space:]]*@%\1\2***@%g' \
         -e 's%(^|[[:space:]])([A-Za-z][A-Za-z0-9+.-]*://[^?#[:space:]]*)[?][^#[:space:]]*%\1\2?***%g' \
         -e 's%(^|[[:space:]])([A-Za-z][A-Za-z0-9+.-]*://[^#[:space:]]*)[#][^[:space:]]*%\1\2#***%g'
}
redact() { printf '%s\n' "$1" | redact_urls | awk 'NR > 1 { printf "\n" } { printf "%s", $0 }'; }
if [ -n "$PARENT" ] && [ "$(classify_source "$PARENT")" = rejected ]; then
  die "--parent accepts an https:// URL or a local path, not: $(redact "$PARENT")"
fi
while IFS= read -r v; do
  [ -z "$v" ] && continue
  [ "$(classify_source "$v")" = rejected ] && die "--vulns accepts a file or an https:// URL, not: $(redact "$v")"
done <<< "$VULNS_NL"
# Every caller-supplied path becomes absolute here: the collector later leaves the caller's working
# directory (usually the audited repository) so no tool can pick up a module or config file from it.
abspath() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }
OUT=$(abspath "$OUT")
[ -n "$AUDIT_MEM_DB" ] && AUDIT_MEM_DB=$(abspath "$AUDIT_MEM_DB")
[ -n "$PARENT" ] && [ "$(classify_source "$PARENT")" = path ] && PARENT=$(abspath "$PARENT")
abs_vulns=""
while IFS= read -r v; do
  [ -z "$v" ] && continue
  if [ "$(classify_source "$v")" = path ]; then v=$(abspath "$v"); fi
  abs_vulns="$abs_vulns$v$nl"
done <<< "$VULNS_NL"
VULNS_NL=$abs_vulns

# ---- hardened git (OUTPUT-RULES.md Rule 11c) --------------------------------------------------------
# The target's .git/config, attributes and hooks are attacker-controlled: never page, never run
# fsmonitor or signature helpers, and give every log/show --no-textconv --no-ext-diff with fixed diff
# prefixes. Nothing is ever checked out, so no smudge or clean filter can run, and no transport
# protocol is allowed, so no remote the target configures is ever contacted (the one https clone of a
# user-given --parent URL below allows https for that call only). Output-shaping settings
# (grep line numbers and columns, colour, path quoting, log encoding, the big-file threshold, hunk
# fusing, root-commit diffs) are pinned as well, from the target's config and from the auditor's own
# ~/.gitconfig alike, so the parsers below see plain text. Every diff runs with --text and every
# git grep with -a, so neither an attribute (-diff, diff=<driver> with binary set) nor a size
# threshold turns a change into "Binary files differ" or hides a file from a search.
G() {
  local d=$1; shift
  git --no-pager -C "$d" -c core.fsmonitor=false -c core.pager=cat -c log.showSignature=false \
      -c gpg.program=false -c gpg.ssh.program=false -c protocol.allow=never \
      -c grep.lineNumber=false -c grep.column=false -c grep.patternType=basic -c grep.extendedRegexp=false \
      -c color.ui=never -c color.grep=never -c color.diff=never -c core.quotePath=false \
      -c i18n.logOutputEncoding=UTF-8 -c core.bigFileThreshold=512m -c diff.interHunkContext=0 \
      -c log.showRoot=true "$@"
}
DIFFSAFE=(--text --no-textconv --no-ext-diff --no-color --src-prefix=a/ --dst-prefix=b/)

# repo_top <dir>: status 0 when <dir> is the top level of its own repository (or a bare repository
# itself), compared with symbolic links resolved on both sides. A plain directory inside another
# repository fails, so that outer repository is never mined in its place.
repo_top() {
  local top
  if [ "$(G "$1" rev-parse --is-bare-repository 2>/dev/null)" = true ]; then
    top=$(G "$1" rev-parse --absolute-git-dir 2>/dev/null) || return 1
  else
    top=$(G "$1" rev-parse --show-toplevel 2>/dev/null) || return 1
  fi
  [ -n "$top" ] && [ "$(cd "$top" 2>/dev/null && pwd -P)" = "$(cd "$1" 2>/dev/null && pwd -P)" ]
}
repo_top "$REPO" || { echo "collect.sh: not a git repository (or not its top level): $REPO" >&2; exit 3; }
# partial_clone <dir>: status 0 for a partial clone (extensions.partialClone, or a remote.<name>.promisor
# key), where reading a missing object would fetch it from the promisor remote; 1 for none; 2 when git
# cannot read the config (git config exits 1 only for "no match"). Reading config runs nothing.
partial_clone() {
  local keys rc
  keys=$(G "$1" config --get-regexp '^(extensions\.partialclone|remote\..*\.promisor)$' 2>/dev/null); rc=$?
  if [ "$rc" -eq 0 ] && [ -n "$keys" ]; then return 0; fi
  if [ "$rc" -le 1 ]; then return 1; fi
  return 2
}
partial_clone "$REPO"
case $? in
  0) echo "collect.sh: the target is a partial clone: reading missing objects would fetch from its promisor remote. Make a full copy you control first (OUTPUT-RULES Rule 11c)." >&2
     exit 3 ;;
  2) echo "collect.sh: git cannot read the target's config, so a partial clone cannot be ruled out: $REPO" >&2
     exit 3 ;;
esac
PIN_SHA=$(G "$REPO" rev-parse --verify --quiet "$PIN^{commit}") || { echo "collect.sh: pin does not resolve: $PIN" >&2; exit 3; }
# --import reaches git only as the full commit id it resolves to, never as the string given.
if [ -n "$IMPORT" ]; then
  IMPORT_SHA=$(G "$REPO" rev-parse --verify --quiet "$IMPORT^{commit}") || die "--import does not resolve to a commit: $IMPORT"
  IMPORT=$IMPORT_SHA
fi
REPO_ABS=$(cd "$REPO" && pwd)
REPO=$REPO_ABS
SHALLOW=$(G "$REPO" rev-parse --is-shallow-repository 2>/dev/null)
EMPTY_TREE=$(G "$REPO" hash-object -t tree /dev/null)
# Where this git has --attr-source, R4 reads gitattributes from the empty tree instead of the target's
# .gitattributes; an older git has no such option and keeps reading them.
ATTR_SRC=""
G "$REPO" --attr-source="$EMPTY_TREE" check-attr diff -- probe.rs >/dev/null 2>&1 && ATTR_SRC=$EMPTY_TREE

# Default pathspec: an Anchor-style programs/ tree when the commit has one, else every Rust file.
default_paths() { # default_paths <repo> <commit>
  if G "$1" cat-file -e "$2:programs" 2>/dev/null; then echo 'programs/*.rs'; else echo '*.rs'; fi
}
[ -n "$TPATHS_NL" ] || TPATHS_NL="$(default_paths "$REPO" "$PIN_SHA")$nl"
TPATHS=()
while IFS= read -r p; do [ -n "$p" ] && TPATHS+=("$p"); done <<< "$TPATHS_NL"

TMPD=$(mktemp -d "${TMPDIR:-/tmp}/tm-collect.XXXXXX") || die "cannot create a temp dir"
trap 'rm -rf "$TMPD"' EXIT
cd "$TMPD" || die "cannot enter the temp dir"

# ---- vocabulary -----------------------------------------------------------------------------------
# Base set (cve-, security, vuln, fix, exploit) plus Solana-stack terms, matched on the WHOLE message.
KW='cve-|security|vuln|fix|exploit|audit|signer|owner|authority|overflow|underflow|reinit|rounding|slippage|oracle'
[ -n "$EXTRA_KW" ] && KW="$KW|$EXTRA_KW"
# -G picks candidate commits (POSIX ERE inside git); the awk filters decide which lines are guards.
GUARD_G='require(_keys)?(_eq|_neq|_gt|_gte)?!|has_one|constraint[[:space:]]*=|is_signer|is_writable|Signer<|token::(authority|mint)|associated_token::(authority|mint)|mint::authority|owner\(?\)?[[:space:]]*[!=]=|key\(\)[[:space:]]*[!=]=|(address|seeds|bump|close|owner)[[:space:]]*='
# Awk receives these through ENVIRON, where "\t" is not an escape, so they carry a real tab.
TAB=$'\t'
export TM_ALWAYS_RE="require(_keys)?(_eq|_neq|_gt|_gte)?!|has_one|constraint[ $TAB]*=|is_signer|is_writable|Signer<|token::(authority|mint)|associated_token::(authority|mint)|mint::authority|owner\\(?\\)?[ $TAB]*[!=]=|key\\(\\)[ $TAB]*[!=]="
# address/seeds/bump/close/owner count only in attribute position: at line start or after "(" or ",",
# never on a `let` line or a line ending in ";" (variable names, not constraints).
export TM_ATTR_RE="(^|[(,])[ $TAB]*(address|seeds|bump|close|owner)[ $TAB]*=[^=]"
# git's built-in rust hunk-header pattern, passed to git for R4 so the target's config cannot redefine it.
RUST_FUNC="^[$TAB ]*((pub(\\([^\\)]+\\))?[$TAB ]+)?((async|const|unsafe|extern([$TAB ]+\"[^\"]+\"))[$TAB ]+)?(struct|enum|union|mod|trait|fn|impl|macro_rules!)[< $TAB]+[^;]*)\$"

# Target text reaches inputs.tsv and history.md as one value per cell and one row per line: TAB, LF and
# CR are shown as \t, \n and \r, every other control character (C0 and DEL) as ?, and a value longer
# than 500 characters is cut, ending in "...".
CLEAN_AWK='
  BEGIN { for (i = 1; i < 32; i++) esc[sprintf("%c", i)] = "?"
          esc["\t"] = "\\t"; esc["\n"] = "\\n"; esc["\r"] = "\\r"; esc[sprintf("%c", 127)] = "?" }
  function clean(s,   out, i, n, c) {
    n = length(s); if (n > 600) n = 600
    out = ""
    for (i = 1; i <= n; i++) { c = substr(s, i, 1); out = out ((c in esc) ? esc[c] : c) }
    if (length(out) > 500 || length(s) > 600) out = substr(out, 1, 500) "..."
    return out }'
clean()       { CLEAN_IN=$1 awk "$CLEAN_AWK"' BEGIN { printf "%s", clean(ENVIRON["CLEAN_IN"]) }'; }
clean_lines() { awk "$CLEAN_AWK"' { print clean($0) }'; }

# An empty section prints NOT FOUND and a capped one TRUNCATED, so "no rows" never reads as "clean".
emit_capped() { # emit_capped <file> <what was searched>
  local f=$1 what=$2 n
  n=$(wc -l < "$f" | tr -d ' ')
  if [ "$n" -eq 0 ]; then echo "NOT FOUND ($what)"; return 0; fi
  head -n "$CAP" "$f" | clean_lines
  if [ "$n" -gt "$CAP" ]; then echo "TRUNCATED (+$((n - CAP)) more rows; raise --cap)"; fi
  return 0
}
section() { printf '\n## %s\n\n%s\n\n```text\n' "$1" "$2"; }
endsec()  { printf '```\n'; }
strip_pin() { sed "s#^$PIN_SHA:##"; }

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else echo unavailable; fi
}

# guard_rows <repo> <rev-range> <pathspec...>
# One row per net guard-text change per commit:
#   "<short> <date> <TAG> x<count> <file[,file...]>: <text>    # <subject>"
# REMOVED always prints. ADDED prints for commits whose whole message matches a keyword and that change
# <= FIX_CEILING lines in the pathspec; ADDED-QUIET for keyword-free commits of <= SMALL lines. Within a
# commit, identical guard text (after trimming) is netted across all its files, and renames are detected
# (-M), so a guard moved unchanged (a git mv, a file split, a directory rename) prints nothing. An edited
# guard prints its old text as REMOVED, with the files it left, and its new text, with the files it
# entered, when the commit qualifies. Identical text removed in one file and added in another also nets
# out, even where the two guard different things.
# A commit's changed-line count comes from its own patch, which --pickaxe-all prints for every file in
# the pathspec (a --numstat count would be zero for a file git treats as binary).
# Each row starts with the commit's full id (for git; rows show the short one); with GR_SIZE=1 the
# commit's changed-line count follows it (a sort key for R5d). With GR_FILES=<file>, "<full id><TAB><path>"
# is appended there for every file a printed row names, so a saved diff can be limited to those files.
guard_rows() {
  local repo=$1 range=$2 kwfile; shift 2
  kwfile="$TMPD/kw.$RANDOM"
  G "$repo" log "${DIFFSAFE[@]}" -i -E --grep="$KW" --format=%H "$range" -- "$@" > "$kwfile" 2>/dev/null
  G "$repo" log "${DIFFSAFE[@]}" --min-parents=1 -p -U0 -M --pickaxe-all -G"$GUARD_G" \
      --format='__C__ %H %h %ad %s' --date=short "$range" -- "$@" 2>/dev/null |
  awk -v small="$SMALL" -v ceil="$FIX_CEILING" -v kwfile="$kwfile" -v filesout="${GR_FILES:-/dev/null}" '
    BEGIN { always = ENVIRON["TM_ALWAYS_RE"]; attr = ENVIRON["TM_ATTR_RE"]
            while ((getline l < kwfile) > 0) kw[l] = 1 }
    function isguard(s) {
      if (s ~ always) return 1
      if (s ~ attr && s !~ /(^|[^A-Za-z0-9_])let[ \t]/ && s !~ /;[ \t]*$/) return 1
      return 0 }
    function note(side, t, f,   had) {   # the files a guard text left ("-") or entered ("+") in this commit
      if (f == "" || ((side, t, f) in seen)) return
      seen[side, t, f] = 1
      had = ((side, t) in files)
      files[side, t] = had ? files[side, t] "," f : f
      path[side, t, ++npath[side, t]] = f }
    function paths(side, t,   k) { for (k = 1; k <= npath[side, t]; k++) print full "\t" path[side, t, k] > filesout }
    function flush(   t, n) {
      if (full == "") return
      for (t in net) {
        n = net[t]
        if (n < 0) {
          printf "%06d %s %d %s %s REMOVED x%d %s: %s    # %s\n", ci, full, size, short, date, -n, files["-", t], t, subj
          paths("-", t)
        } else if (n > 0 && (full in kw) && size <= ceil + 0) {
          printf "%06d %s %d %s %s ADDED x%d %s: %s    # %s\n", ci, full, size, short, date, n, files["+", t], t, subj
          paths("+", t)
        } else if (n > 0 && !(full in kw) && size <= small + 0) {
          printf "%06d %s %d %s %s ADDED-QUIET x%d %s: %s    # %s\n", ci, full, size, short, date, n, files["+", t], t, subj
          paths("+", t)
        }
      }
      delete net; delete files; delete seen; delete path; delete npath }
    /^__C__ / { flush(); ci++; full = $2; short = $3; date = $4; size = 0
                subj = $0; sub(/^__C__ [^ ]+ [^ ]+ [^ ]+ ?/, "", subj); inhdr = 0; next }
    /^diff --git / { inhdr = 1; oldp = ""; newp = ""; next }
    inhdr && /^--- a\// { oldp = substr($0, 7); next }
    inhdr && /^\+\+\+ b\// { newp = substr($0, 7); next }
    /^@@/ { inhdr = 0; next }
    inhdr { next }
    /^[-+]/ { size++; s = substr($0, 2)
              if (!isguard(s)) next
              t = s; gsub(/^[ \t]+|[ \t]+$/, "", t)
              if (substr($0, 1, 1) == "+") { net[t]++; note("+", t, newp) } else { net[t]--; note("-", t, oldp) } }
    END { flush() }' | sort -k1,1n -k6 | cut -d' ' -f"$([ "${GR_SIZE:-0}" = 1 ] && echo 2- || echo 2,4-)"
}

# The command a TRUNCATED line names for the rest of a saved diff: Rule 11c's git, run in a scratch copy.
SHOW_REST="GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false show --no-textconv --no-ext-diff"
# shell_word <text>: the text as one shell word that runs nothing when pasted: escaped and cut like any
# other target text, then single-quoted.
shell_word() { printf "'%s'" "$(clean "$1" | sed "s/'/'\\\\''/g")"; }

# save_diff <repo> <full id> <out file> <path list> <fallback pathspec...>
# Writes the commit's id, date, subject and at most 20 body lines, then its diff limited to the paths in
# <path list> (one per line; the fallback pathspec when it is empty), at most 400 lines. Each cut ends in a
# TRUNCATED line that names the git show call for the rest, with every path as a quoted shell word.
save_diff() {
  local repo=$1 c=$2 out=$3 plist=$4 p n shown="" specs nspec=0; shift 4
  specs=()
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    specs+=(":(literal)$p"); shown="$shown $(shell_word "$p")"; nspec=$((nspec + 1))
  done < "$plist"
  if [ "$nspec" -eq 0 ]; then
    specs=("$@")
    for p in "$@"; do shown="$shown $(shell_word "$p")"; done
  fi
  {
    G "$repo" log -1 --format='commit %H%n%ad%n%n%s' --date=short "$c" 2>/dev/null
    G "$repo" log -1 --format=%b "$c" 2>/dev/null | sed -e '$!b' -e '/^$/d' > "$TMPD/save.body"
    n=$(wc -l < "$TMPD/save.body" | tr -d ' ')
    if [ "$n" -gt 0 ]; then echo; head -n 20 "$TMPD/save.body"; fi
    if [ "$n" -gt 20 ]; then
      echo "TRUNCATED ($((n - 20)) more message lines; the whole message, from a Rule 11c scratch copy: $SHOW_REST --no-patch $c)"
    fi
    echo
    G "$repo" show "${DIFFSAFE[@]}" --format= "$c" -- "${specs[@]}" 2>/dev/null | sed '/./,$!d' > "$TMPD/save.diff"
    n=$(wc -l < "$TMPD/save.diff" | tr -d ' ')
    head -n 400 "$TMPD/save.diff"
    if [ "$n" -gt 400 ]; then
      echo "TRUNCATED ($((n - 400)) more lines; the rest, from a Rule 11c scratch copy: $SHOW_REST $c --$shown)"
    fi
  } > "$out"
}

# remote_urls: one "remote.<name>.url <value>" line per configured remote URL. Config is read NUL-separated,
# so a newline inside a value stays on its line, shown as \n.
remote_urls() {
  G "$REPO" config -z --get-regexp '^remote\..*\.url$' 2>/dev/null | tr '\n\000' '\001\n' |
    awk '{ i = index($0, "\001"); if (i) $0 = substr($0, 1, i - 1) " " substr($0, i + 1)
           out = ""; while ((i = index($0, "\001")) > 0) { out = out substr($0, 1, i - 1) "\\n"; $0 = substr($0, i + 1) }
           print out $0 }'
}

# ---- triggers T3 (provenance) and T4 (prior reports, incidents) ---------------------------------------
# T2 (intake §7 records a prior audit or an incident) is read by the command, not here.
FORK_PHRASES='fork(ed)? (of|from)|white[- ]?label'
REPORT_RE='audit|post-?mortem|incident'   # in any path component of a .pdf / .md file
norm_url() { tr 'A-Z' 'a-z' | sed -E 's#^[a-z+]+://##; s#^git@##; s#:#/#; s#\.git$##; s#/$##'; }
# Under pipefail a pipeline that ends in an early-exit reader (grep -q, head) can report the writer's
# SIGPIPE instead of the match, so every check whose status matters here counts, or reads a string.
eval_triggers() {
  local t3="" t4="" cur="" src remotes s d n
  G "$REPO" grep -a -i -q -E "$FORK_PHRASES" "$PIN_SHA" -- 'README*' '*/README*' 'docs/*' 2>/dev/null && t3="readme-phrase"
  src=$(G "$REPO" grep -h -a -E 'source_code[[:space:]]*:' "$PIN_SHA" -- '*.rs' 2>/dev/null |
        sed -nE 's/.*source_code[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | head -n 3)
  remotes=$(remote_urls | awk '{print $2}' | norm_url)
  # One string per line, read as written: target strings are never word-split or glob-expanded.
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    grep -qxF -- "$(printf '%s' "$s" | norm_url)" <<< "$remotes" || { t3="${t3:+$t3,}security_txt-source_code"; break; }
  done <<< "$src"
  [ -d "$(dirname "$OUT")" ] && cur=$(cd "$(dirname "$OUT")" && pwd)
  for d in "$REPO_ABS"/audit_*/; do
    [ -f "$d/REPORT.md" ] || continue
    [ "$(cd "$d" && pwd)" = "$cur" ] && continue
    t4="prior-audit-dir"; break
  done
  n=$(G "$REPO" ls-tree -r --name-only "$PIN_SHA" 2>/dev/null | grep -iE '\.(pdf|md)$' | grep -ciE "$REPORT_RE")
  if [ "${n:-0}" -gt 0 ]; then t4="${t4:+$t4,}in-tree-report"; fi
  if ls "$REPO_ABS"/incident_*/INCIDENTS.json >/dev/null 2>&1; then t4="${t4:+$t4,}incidents-json"; fi
  echo "T3 $([ -n "$t3" ] && echo yes || echo no) ${t3:-none}"
  echo "T4 $([ -n "$t4" ] && echo yes || echo no) ${t4:-none}"
}

if [ "$DETECT" -eq 1 ]; then eval_triggers; exit 0; fi

# ---- output dir (OUTPUT-RULES.md Rule 11d) -----------------------------------------------------------
# Only a run directory this audit made is written to: never one that is or holds a symbolic link, and
# never one git tracks, where the output would become changes to tracked files. Checked before the first
# write or removal, for the output dir and its audit_<n>/ parent. The check fails closed: a directory
# find cannot fully read, or one git cannot answer for (another owner, an unreadable config), is refused.
# The only git error that passes is "not a git repository" from discovery: the directory is outside
# every repository, so nothing there can be tracked.
check_run_dir() { # check_run_dir <dir>
  local d=$1 up links inside listed
  [ -L "$d" ] && die "refusing a run directory that is a symbolic link: $d (use a new audit_<n>)"
  if [ -d "$d" ]; then
    links=$(find "$d" -type l -print 2>/dev/null) || die "refusing a run directory that cannot be fully read: $d (use a new audit_<n>)"
    [ -z "$links" ] || die "refusing a run directory that holds symbolic links: $d (use a new audit_<n>)"
  fi
  up=$(dirname "$d")
  [ -d "$up" ] || return 0
  if ! inside=$(G "$up" rev-parse --is-inside-work-tree 2>"$TMPD/run-dir.err"); then
    grep -qi 'not a git repository (or any' "$TMPD/run-dir.err" && return 0
    die "refusing a run directory that git cannot check: $d (use a new audit_<n>)"
  fi
  [ "$inside" = true ] || return 0
  listed=$(G "$up" --icase-pathspecs ls-files -- "$(basename "$d")" 2>/dev/null) ||
    die "refusing a run directory that git cannot check: $d (use a new audit_<n>)"
  [ -z "$listed" ] || die "refusing a run directory that git tracks: $d (use a new audit_<n>)"
}
AUD_DIR=$(dirname "$OUT")
case "$(basename "$AUD_DIR")" in audit_*) check_run_dir "$AUD_DIR" ;; esac
check_run_dir "$OUT"
mkdir -p "$OUT" || die "cannot create $OUT"
# Working material never lands in the client's git status: the output dir ignores itself, and so does
# its audit_<n>/ parent when it has no .gitignore of its own (only for a dir named audit_*).
[ -e "$OUT/.gitignore" ] || printf '*\n' > "$OUT/.gitignore"
case "$(basename "$AUD_DIR")" in
  audit_*) [ -e "$AUD_DIR/.gitignore" ] || printf '*\n' > "$AUD_DIR/.gitignore" ;;
esac
if [ -f "$OUT/inputs.tsv" ]; then rm -rf "$OUT/inputs" "$OUT/diffs"; fi
rm -f "$OUT/history.md" "$OUT/inputs.tsv" "$OUT/audit-mem-warm.json"
mkdir -p "$OUT/inputs" "$OUT/diffs"
H="$OUT/history.md"
printf 'n\tsource\tformat\tsha256\tstored_as\tstatus\n' > "$OUT/inputs.tsv"

# ---- R5 parent acquisition (before the header, which names it) ----------------------------------------
PDIR="" PARENT_STATUS="none" PHEAD=""
if [ -n "$PARENT" ]; then
  if [ "$(classify_source "$PARENT")" = url ]; then
    if [ "$OFFLINE" -eq 1 ]; then
      PARENT_STATUS="given, not cloned (offline)"
    elif GIT_ASKPASS= SSH_ASKPASS= GIT_TERMINAL_PROMPT=0 git -c protocol.allow=never -c protocol.https.allow=always \
           -c protocol.file.allow=never -c credential.helper= -c http.extraHeader= -c core.askPass= -c core.fsmonitor=false \
           clone --quiet --bare --no-recurse-submodules -- "$PARENT" "$TMPD/parent.git" >/dev/null 2>&1; then
      PDIR="$TMPD/parent.git"; PARENT_STATUS="cloned (bare, temp dir, deleted on exit)"
    else
      PARENT_STATUS="clone failed"
    fi
  elif ! repo_top "$PARENT"; then
    PARENT_STATUS="not a git repository (or not its top level)"
  else
    partial_clone "$PARENT"
    case $? in
      0) PARENT_STATUS="the parent is a partial clone, not used (reading it could fetch from its promisor remote)" ;;
      2) PARENT_STATUS="git cannot read the parent's config, not used" ;;
      *) PDIR="$PARENT"; PARENT_STATUS="local repository" ;;
    esac
  fi
  if [ -n "$PDIR" ]; then PHEAD=$(G "$PDIR" rev-parse --verify --quiet 'HEAD^{commit}'); fi
fi
# Parent pathspec: --parent-paths, else the parent's own default (a fork may rename its program dir).
if [ -z "$PPATHS_NL" ]; then
  if [ -n "$PHEAD" ]; then PPATHS_NL="$(default_paths "$PDIR" "$PHEAD")$nl"; else PPATHS_NL=$TPATHS_NL; fi
fi
PPATHS=()
while IFS= read -r p; do [ -n "$p" ] && PPATHS+=("$p"); done <<< "$PPATHS_NL"

{
  echo "# Threat-model bootstrap — collector output"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Target | \`$(clean "$REPO_ABS")\` |"
  echo "| Pinned commit | \`$PIN_SHA\` |"
  echo "| Target paths | \`$(clean "${TPATHS[*]}")\` |"
  if [ -n "$PARENT" ]; then echo "| Parent | $(clean "$(redact "$PARENT")") — $PARENT_STATUS${PHEAD:+ @ \`$PHEAD\`} |"; else echo "| Parent | none |"; fi
  echo "| Parent paths | \`$(clean "${PPATHS[*]}")\` |"
  echo "| Network | $([ "$OFFLINE" -eq 1 ] && echo 'offline' || echo 'explicit https URLs only') |"
  echo "| Collector | scripts/threat-model/collect.sh v$COLLECTOR_VERSION, cap $CAP rows, quiet-fix ceiling $SMALL lines, fix ceiling $FIX_CEILING lines |"
  echo
  echo "Leads, not findings: every row points at history to re-derive from the code at the pinned commit."
  echo "Git ran without pager, fsmonitor, signature helpers, textconv or external diff (OUTPUT-RULES.md Rule 11c), with lazy fetching and every transport protocol off (a partial clone is refused), and with its grep, colour, path-quoting, log-encoding, big-file, hunk-fusing and root-commit settings pinned."
  if [ "$SHALLOW" = true ]; then
    echo "Shallow clone: history before the shallow boundary is missing, so a NOT FOUND or a short list below may only mean that history is cut."
  fi
  echo "Every diff and search runs as text, so no attribute (committed or in .git/info/attributes) or setting of the target makes git skip a file as binary; a matching line from a binary file is shown escaped and cut like all target text."
  if [ -n "$ATTR_SRC" ]; then
    echo "R4 function names use git's rust hunk-header pattern, pinned. The target's .gitattributes are ignored there (--attr-source); its .git/info/attributes still apply, and R4 counts the .rs files they send to another diff driver."
  else
    echo "R4 function names use git's rust hunk-header pattern, pinned. This git has no --attr-source, so the target's .gitattributes and .git/info/attributes still apply there; R4 counts the .rs files they send to another diff driver."
  fi
  echo "An empty section prints NOT FOUND; a capped one prints TRUNCATED (+n)."
} > "$H"

# ---- R0 preflight ---------------------------------------------------------------------------------
{
  section "R0 Preflight" "Shallow clones hide history. T3/T4 are the triggers this script can evaluate offline."
  echo "shallow: $SHALLOW"
  echo "commits in the pin ancestry touching the target paths: $(G "$REPO" rev-list --count "$PIN_SHA" -- "${TPATHS[@]}" 2>/dev/null)"
  eval_triggers
  endsec
} >> "$H"

# ---- R1 keyword commits (whole message) --------------------------------------------------------------
G "$REPO" log "${DIFFSAFE[@]}" -i -E --grep="$KW" --format='%h %ad %s' --date=short "$PIN_SHA" -- "${TPATHS[@]}" > "$TMPD/r1" 2>/dev/null
{ section "R1 Commits whose message matches security keywords" "Case-insensitive, whole commit message: \`$(clean "$KW")\`"
  emit_capped "$TMPD/r1" "no commit message in the pin ancestry matches"; endsec; } >> "$H"

# ---- R2 reverts ------------------------------------------------------------------------------------
G "$REPO" log "${DIFFSAFE[@]}" -E --grep='^Revert "|This reverts commit [0-9a-f]{7,40}' --format='%H %h %ad %s' --date=short "$PIN_SHA" -- "${TPATHS[@]}" 2>/dev/null |
while read -r full short date subj; do
  rev=$(G "$REPO" log "${DIFFSAFE[@]}" -1 --format=%B "$full" 2>/dev/null | grep -oE 'reverts commit [0-9a-f]{7,40}' | head -n 1 | awk '{print substr($3, 1, 10)}')
  echo "$short $date $subj  -> reverts ${rev:-unknown}"
done > "$TMPD/r2"
{ section "R2 Reverts" "A reverted fix, or a revert of a revert, marks a surface someone changed their mind about."
  emit_capped "$TMPD/r2" "no revert commit in the pin ancestry"; endsec; } >> "$H"

# ---- R3 guard lines removed / added ------------------------------------------------------------------
GR_FILES="$TMPD/r3.paths" guard_rows "$REPO" "$PIN_SHA" "${TPATHS[@]}" > "$TMPD/r3ids"
cut -d' ' -f2- "$TMPD/r3ids" > "$TMPD/r3"
grep -E ' REMOVED x' "$TMPD/r3" > "$TMPD/r3a"
grep -E ' ADDED-QUIET x' "$TMPD/r3" > "$TMPD/r3b"
grep -E ' ADDED x' "$TMPD/r3" > "$TMPD/r3c"
{ section "R3 Account-guard lines removed or added" \
"Guard text a commit removed from the target paths (REMOVED), or added in a keyword-free commit changing <= $SMALL lines (ADDED-QUIET) or in a commit of <= $FIX_CEILING lines whose message matches a keyword (ADDED). Each commit nets identical guard text across its files: a guard moved unchanged prints nothing, an edited one prints its old text as REMOVED. Blind spots: flipped comparisons, changed inputs to an unchanged guard, plain \`if ... { return Err(...) }\` checks, merge resolutions, identical text removed in one file and added in another by the same commit."
  echo "--- R3a REMOVED ---"
  emit_capped "$TMPD/r3a" "no guard text removed in the pin ancestry"
  echo "--- R3b ADDED-QUIET (quiet-fix candidates) ---"
  emit_capped "$TMPD/r3b" "no guard text added by a small keyword-free commit"
  echo "--- R3c ADDED in keyword commits ---"
  emit_capped "$TMPD/r3c" "no guard text added by a keyword commit"
  endsec; } >> "$H"
# Saved diffs name the commit by its full id (a short id could also be the name of a ref) and hold only
# the files the commit's rows name.
grep -E ' (REMOVED|ADDED-QUIET) x' "$TMPD/r3ids" | awk '!s[$1]++ { print $1, $2 }' | head -n 20 |
while read -r full c; do
  awk -F '\t' -v c="$full" '$1 == c && !s[$2]++ { print $2 }' "$TMPD/r3.paths" > "$TMPD/save.paths"
  save_diff "$REPO" "$full" "$OUT/diffs/target-$c.diff" "$TMPD/save.paths" "${TPATHS[@]}"
done

# ---- R4 churn --------------------------------------------------------------------------------------
G "$REPO" log "${DIFFSAFE[@]}" --no-renames --format= --name-only "$PIN_SHA" -- "${TPATHS[@]}" 2>/dev/null | sed '/^$/d' | sort | uniq -c | sort -k1,1nr -k2 > "$TMPD/r4a"
# Function names come from hunk headers: *.rs maps to the rust driver, whose pattern is passed on the
# command line, and with ATTR_SRC the target's .gitattributes are not read. Its .git/info/attributes
# still are; the .rs files they send to another driver are counted in a note.
printf '*.rs diff=rust\n' > "$TMPD/rs.attributes"
R4_GIT=(${ATTR_SRC:+"--attr-source=$ATTR_SRC"} -c core.attributesFile="$TMPD/rs.attributes" -c diff.rust.xfuncname="$RUST_FUNC")
G "$REPO" "${R4_GIT[@]}" log "${DIFFSAFE[@]}" -p -U0 --no-renames \
    --format='__C__ %h' "$PIN_SHA" -- "${TPATHS[@]}" 2>/dev/null | awk '
  /^__C__ / { c = $2; next }
  /^@@ / { s = $0; sub(/^@@ [^@]*@@ ?/, "", s)
           if (match(s, /fn [A-Za-z0-9_]+/)) { f = substr(s, RSTART + 3, RLENGTH - 3)
             if (!seen[c SUBSEP f]++) cnt[f]++ } }
  END { for (f in cnt) printf "%4d %s\n", cnt[f], f }' | sort -k1,1nr -k2 > "$TMPD/r4b"
R4_OTHER=$(sed -E 's/^ *[0-9]+ //' "$TMPD/r4a" | grep -E '\.rs"?$' |
  G "$REPO" "${R4_GIT[@]}" check-attr --stdin diff 2>/dev/null | grep -vc ': diff: rust$')
{ section "R4 Churn" "Files, then functions (hunk headers from git's rust pattern, pinned), by number of commits touching them."
  emit_capped "$TMPD/r4a" "no file in the target paths changed"
  echo "--- functions ---"
  if [ "${R4_OTHER:-0}" -gt 0 ]; then
    echo "note: the target's attributes send $R4_OTHER .rs file(s) above to another diff driver; their hunks may name no function, or one that driver chose"
  fi
  emit_capped "$TMPD/r4b" "no rust function header in the diffs"; endsec; } >> "$H"

# ---- R5 fork parent --------------------------------------------------------------------------------
{
  section "R5 Fork parent" "Hints only: a fork point and the parent's later guard additions (absent rows and smaller commits first). Neither proves a fix was or was not carried."
  if [ -z "$PARENT" ]; then
    echo "NOT FOUND (no --parent given; a URL found in target content is never fetched)"
  elif [ -z "$PDIR" ] || [ -z "$PHEAD" ]; then
    echo "NOT FOUND (parent $(clean "$(redact "$PARENT")"): $PARENT_STATUS)"
  else
    G "$PDIR" rev-list --all > "$TMPD/parent.revs" 2>/dev/null
    # The fork point is looked for on the target's first-parent line first: a parent commit reached only
    # through a merge (one made with -s ours records the parent's history without its code) must not
    # move the fork point past fixes the target never applied. R5d then tags each later parent guard
    # present or absent at the pin. Without a shared commit on that line, the whole ancestry is searched.
    FORK="" METHOD="shared history, first-parent line"
    if [ -s "$TMPD/parent.revs" ]; then
      G "$REPO" rev-list --first-parent "$PIN_SHA" > "$TMPD/target.revs" 2>/dev/null
      FORK=$(awk 'NR == FNR { p[$1] = 1; next } ($1 in p) { print; exit }' "$TMPD/parent.revs" "$TMPD/target.revs")
      if [ -z "$FORK" ]; then
        METHOD="shared history"
        G "$REPO" rev-list "$PIN_SHA" > "$TMPD/target.revs" 2>/dev/null
        FORK=$(awk 'NR == FNR { p[$1] = 1; next } ($1 in p) { print; exit }' "$TMPD/parent.revs" "$TMPD/target.revs")
      fi
    fi
    if [ -z "$FORK" ]; then
      METHOD="blob identity"
      [ -n "$IMPORT" ] || IMPORT=$(G "$REPO" rev-list --max-parents=0 "$PIN_SHA" | tail -n 1)
      # ls-tree takes literal paths, not globs; a diff from the empty tree honours the pathspec.
      G "$REPO" diff-tree "${DIFFSAFE[@]}" -r --no-renames "$EMPTY_TREE" "$IMPORT" -- "${TPATHS[@]}" 2>/dev/null |
        awk '/^:/ { print $4 }' | sort -u | head -n 2000 > "$TMPD/import.blobs"
      if [ -s "$TMPD/import.blobs" ]; then
        G "$PDIR" log "${DIFFSAFE[@]}" --all --no-renames --raw --no-abbrev --format='__C__ %ct %H' -- "${PPATHS[@]}" 2>/dev/null |
          awk 'NR == FNR { want[$1] = 1; total++; next }
               /^__C__ / { ct = $2; h = $3; next }
               /^:/ { if ($4 in want) intro[$4] = ct " " h }
               END { for (b in intro) { split(intro[b], a, " "); m++; if (a[1] + 0 > best + 0) { best = a[1]; bh = a[2] } }
                     if (m > 0) printf "%s %d %d\n", bh, m, total }' "$TMPD/import.blobs" - > "$TMPD/blobmatch"
        FORK=$(awk '{print $1}' "$TMPD/blobmatch")
        [ -n "$FORK" ] && METHOD="blob identity: $(awk '{print $2 " of " $3}' "$TMPD/blobmatch") import blobs found in the parent"
      fi
    fi
    if [ -z "$FORK" ]; then
      echo "NOT FOUND (no shared commit and no identical file content between the target import and the parent)"
    else
      echo "fork point: $(clean "$(G "$PDIR" log "${DIFFSAFE[@]}" -1 --format='%h %ad %s' --date=short "$FORK")") — $METHOD"
      echo "parent head: $(clean "$(G "$PDIR" log "${DIFFSAFE[@]}" -1 --format='%h %ad %s' --date=short "$PHEAD")")"
      if [ "$(G "$PDIR" rev-parse --is-shallow-repository 2>/dev/null)" = true ]; then
        echo "note: the parent is a shallow clone; its history before the shallow boundary is missing"
      fi
      echo
      echo "--- R5c parent commits after the fork point whose whole message matches a keyword ---"
      G "$PDIR" log "${DIFFSAFE[@]}" -i -E --grep="$KW" --format='%h %ad %s' --date=short "$FORK..$PHEAD" -- "${PPATHS[@]}" > "$TMPD/r5c" 2>/dev/null
      emit_capped "$TMPD/r5c" "no keyword commit in the parent after the fork point"
      echo
      echo "--- R5d guard lines the parent added after the fork point, looked up in the target @ pin ---"
      G "$REPO" grep -h -a -e '' "$PIN_SHA" -- "${TPATHS[@]}" 2>/dev/null | awk '{ gsub(/[ \t]/, ""); print }' > "$TMPD/target.lines"
      echo "__no_line_matches_this__" >> "$TMPD/target.lines"   # keeps the join below two-file even for an empty tree
      # Absent rows first, then smaller commits, then commit order: a real fix should not fall past
      # the cap behind feature releases.
      GR_FILES="$TMPD/r5.paths" GR_SIZE=1 guard_rows "$PDIR" "$FORK..$PHEAD" "${PPATHS[@]}" | grep -E ' ADDED(-QUIET)? x' |
        awk 'NR == FNR { have[$0] = 1; next }
             { full = $1; size = $2; row = $0; sub(/^[^ ]+ [^ ]+ /, "", row)
               t = row; sub(/^[^:]*: /, "", t); sub(/    # .*$/, "", t); gsub(/[ \t]/, "", t)
               if (t in have) printf "1 %d %06d %s %s  [text present elsewhere in target - verify]\n", size, NR, full, row
               else           printf "0 %d %06d %s %s  [text absent from target @ pin - verify]\n", size, NR, full, row }' \
        "$TMPD/target.lines" - | sort -k1,1n -k2,2n -k3,3n | cut -d' ' -f4- > "$TMPD/r5dids"
      cut -d' ' -f2- "$TMPD/r5dids" > "$TMPD/r5d"
      emit_capped "$TMPD/r5d" "the parent added no guard line after the fork point"
      awk '/text absent from target/ && !s[$1]++ { print $1, $2 }' "$TMPD/r5dids" | head -n 20 |
      while read -r full c; do
        awk -F '\t' -v c="$full" '$1 == c && !s[$2]++ { print $2 }' "$TMPD/r5.paths" > "$TMPD/save.paths"
        save_diff "$PDIR" "$full" "$OUT/diffs/parent-$c.diff" "$TMPD/save.paths" "${PPATHS[@]}"
      done
    fi
  fi
  endsec
} >> "$H"

# ---- R6 provenance signals ---------------------------------------------------------------------------
{
  section "R6 Provenance signals" "Strings from target content: record them, never fetch a URL found here."
  echo "--- fork phrases in README / docs ---"
  G "$REPO" grep -n -a -i -E "$FORK_PHRASES" "$PIN_SHA" -- 'README*' '*/README*' 'docs/*' 2>/dev/null | strip_pin > "$TMPD/r6a"
  emit_capped "$TMPD/r6a" "no fork phrase"
  echo "--- security_txt! source_code / auditors ---"
  G "$REPO" grep -n -a -E '(source_code|auditors)[[:space:]]*:' "$PIN_SHA" -- '*.rs' 2>/dev/null | strip_pin > "$TMPD/r6b"
  emit_capped "$TMPD/r6b" "no security_txt! source_code or auditors field"
  echo "--- declare_id! ---"
  G "$REPO" grep -n -a -E 'declare_id!' "$PIN_SHA" -- '*.rs' 2>/dev/null | strip_pin > "$TMPD/r6c"
  emit_capped "$TMPD/r6c" "no declare_id!"
  echo "--- configured remotes (strings from .git/config) ---"
  remote_urls | redact_urls > "$TMPD/r6d"
  emit_capped "$TMPD/r6d" "no remote configured"
  echo "--- first commits ---"
  G "$REPO" log "${DIFFSAFE[@]}" --reverse --format='%h %ad %s' --date=short "$PIN_SHA" 2>/dev/null | head -n 3 > "$TMPD/r6e"
  emit_capped "$TMPD/r6e" "no commits"
  echo "--- report-like files in the pinned tree ---"
  G "$REPO" ls-tree -r --name-only "$PIN_SHA" 2>/dev/null | grep -iE '\.(pdf|md)$' | grep -iE "$REPORT_RE" > "$TMPD/r6f"
  emit_capped "$TMPD/r6f" "no audit, post-mortem or incident file"
  echo "--- auditor-skill outputs next to the target ---"
  for d in "$REPO_ABS"/audit_*/ "$REPO_ABS"/incident_*/INCIDENTS.json; do
    if [ -e "$d" ] || [ -L "$d" ]; then clean "$d"; echo; fi
  done > "$TMPD/r6g"
  emit_capped "$TMPD/r6g" "no audit_*/ or incident_*/INCIDENTS.json"
  endsec
} >> "$H"

# ---- R7 inputs -------------------------------------------------------------------------------------
INPUT_N=0
record() { # record <source> <format> <sha256> <stored_as> <status>
  INPUT_N=$((INPUT_N + 1))
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$INPUT_N" "$(clean "$(redact "$1")")" "$2" "$3" "$4" "$(clean "$5")" >> "$OUT/inputs.tsv"
}
# JSON tools in order of preference. When jq is missing, too old, or fails on a file, python3 takes
# over; with neither, JSON inputs are recorded but never copied. TM_JSON_TOOL (jq | python3 | none)
# pins the choice for tests.
case "${TM_JSON_TOOL:-}" in
  jq) JSON_TOOLS="jq" ;; python3) JSON_TOOLS="python3" ;; none) JSON_TOOLS="" ;;
  *) JSON_TOOLS=""
     command -v jq >/dev/null 2>&1 && JSON_TOOLS="jq"
     command -v python3 >/dev/null 2>&1 && JSON_TOOLS="${JSON_TOOLS:+$JSON_TOOLS }python3" ;;
esac
# Top-level "schema" string of a JSON file (empty if it has none). Status 1 if no tool could parse it.
json_schema() {
  local tool out
  for tool in $JSON_TOOLS; do
    case "$tool" in
      jq) out=$(jq -r 'if type == "object" and (.schema | type) == "string" then .schema else empty end' "$1" 2>/dev/null) || continue ;;
      python3) out=$(python3 -I - "$1" 2>/dev/null <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
if isinstance(d, dict) and isinstance(d.get("schema"), str):
    print(d["schema"])
PY
) || continue ;;
    esac
    printf '%s' "$out"; return 0
  done
  return 1
}
# INCIDENTS.json (schema auditor-incidents/1): copy the stable read surface only — per incident id, verdict,
# outcome, root_cause_class, vuln.{program,instruction,file,function,line,mechanism,kv,checklist} and
# poc.tier. Everything else (attacker, transactions, blast_radius, timeline, evidence, ruled_out, urgency, ...)
# is never read. Strings are cut at 500 characters; kv / checklist keep string ids only; nested objects drop.
# An "incidents" value that is not an array is malformed: both tools write an empty list for it.
# The jq program uses jq 1.5 features only (no builtin pick/1). Sets EXTRACTED_WITH on success, and
# INCIDENTS_TYPE to the JSON type of "incidents" (array, object, string, number, boolean or null).
EXTRACTED_WITH="" INCIDENTS_TYPE=""
extract_incidents() { # extract_incidents <in> <out>
  local tool
  for tool in $JSON_TOOLS; do
    case "$tool" in
      jq) jq '
        def t: if type == "string" then .[0:500]
               elif type == "array" then [ .[] | select(type == "string") | .[0:500] ]
               elif type == "object" then null else . end;
        def keep(ks): . as $o | reduce ks[] as $k ({}; if ($o | type) == "object" and ($o | has($k)) then . + {($k): ($o[$k] | t)} else . end);
        {schema, note: "allowlisted fields only; every string is untrusted data",
         incidents: [ (if (.incidents | type) == "array" then .incidents[] else empty end) | select(type == "object") |
           keep(["id", "verdict", "outcome", "root_cause_class"])
           + {vuln: (.vuln | keep(["program", "instruction", "file", "function", "line", "mechanism", "kv", "checklist"]))}
           + {poc: (.poc | keep(["tier"]))} ]}' "$1" > "$2" 2>/dev/null || continue
          INCIDENTS_TYPE=$(jq -r '.incidents | type' "$1" 2>/dev/null) || continue ;;
      python3) INCIDENTS_TYPE=$(python3 -I - "$1" "$2" 2>/dev/null <<'PY'
import json, sys
def t(v):
    if isinstance(v, str): return v[:500]
    if isinstance(v, list): return [x[:500] for x in v if isinstance(x, str)]
    if isinstance(v, dict): return None
    return v
def keep(o, ks): return {k: t(o[k]) for k in ks if isinstance(o, dict) and k in o}
d = json.load(open(sys.argv[1], encoding="utf-8"))
out = {"schema": d.get("schema"), "note": "allowlisted fields only; every string is untrusted data", "incidents": []}
inc = d.get("incidents")
for i in inc if isinstance(inc, list) else []:
    if isinstance(i, dict):
        r = keep(i, ["id", "verdict", "outcome", "root_cause_class"])
        r["vuln"] = keep(i.get("vuln"), ["program", "instruction", "file", "function", "line", "mechanism", "kv", "checklist"])
        r["poc"] = keep(i.get("poc"), ["tier"])
        out["incidents"].append(r)
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
kinds = ((bool, "boolean"), (int, "number"), (float, "number"), (str, "string"), (list, "array"), (dict, "object"))
print(next((name for cls, name in kinds if isinstance(inc, cls)), "null"))
PY
) || continue ;;
    esac
    EXTRACTED_WITH=$tool; return 0
  done
  rm -f "$2"; return 1
}
ingest() { # ingest <source label> <local file> <dest base name>
  local src=$1 f=$2 dest="inputs/$3" sum magic schema lsrc
  if [ ! -f "$f" ] || [ ! -r "$f" ]; then record "$src" "-" "-" "-" "missing or unreadable"; return 0; fi
  sum=$(sha256_of "$f")
  magic=$(head -c 5 "$f" 2>/dev/null | tr -d '\000')
  if [ "$magic" = "%PDF-" ]; then
    if command -v pdftotext >/dev/null 2>&1 && pdftotext -layout -enc UTF-8 "$f" "$OUT/$dest.txt" 2>/dev/null; then
      record "$src" pdf "$sum" "$dest.txt" "converted (pdftotext -layout)"
    else
      record "$src" pdf "$sum" "-" "not converted: read the PDF with Read (<= 20 pages per call) or ask for a Markdown/text export"
    fi
    return 0
  fi
  case "$f" in
    *.json|*.JSON)
      if ! schema=$(json_schema "$f"); then
        record "$src" json "$sum" "-" "not copied: no working jq or python3 parsed it (or invalid JSON)"
      elif [ "$schema" = "auditor-incidents/1" ]; then
        if ! extract_incidents "$f" "$OUT/$dest"; then record "$src" incidents "$sum" "-" "not extracted: no working jq or python3"
        elif [ "$INCIDENTS_TYPE" = array ]; then record "$src" incidents "$sum" "$dest" "allowlisted fields extracted ($EXTRACTED_WITH)"
        else record "$src" incidents "$sum" "$dest" "malformed: incidents is $INCIDENTS_TYPE, not an array; empty extract ($EXTRACTED_WITH)"; fi
      elif [ -n "$schema" ]; then
        record "$src" json "$sum" "-" "skipped: schema \"$schema\" is not auditor-incidents/1"
      elif lsrc=$(printf '%s' "$src" | tr 'A-Z' 'a-z'); [ "${lsrc#*incident}" != "$lsrc" ]; then
        record "$src" json "$sum" "-" "not copied: could not confirm it is not an incident file"
      else
        cp "$f" "$OUT/$dest" && record "$src" json "$sum" "$dest" "copied (list)"
      fi ;;
    *.csv|*.CSV)          cp "$f" "$OUT/$dest" && record "$src" csv "$sum" "$dest" "copied (list)" ;;
    *.md|*.MD|*.markdown) cp "$f" "$OUT/$dest" && record "$src" markdown "$sum" "$dest" "copied" ;;
    *.txt|*.TXT|*.lst)    cp "$f" "$OUT/$dest" && record "$src" text "$sum" "$dest" "copied" ;;
    *)                    record "$src" unknown "$sum" "-" "unsupported format; supply PDF, Markdown, text, CSV or JSON" ;;
  esac
}
safe_name() { printf '%s' "$1" | sed 's/[^A-Za-z0-9._-]/_/g'; }
# A local --vulns path is read only when it is not a symbolic link and reaches its file through no directory
# link inside the target tree: the target controls those, and a link can point anywhere (a keypair, a .env).
# Links outside the tree, such as /tmp on macOS or the caller's own, are followed.
REPO_PHYS=$(cd "$REPO_ABS" && pwd -P)
tree_link() { # tree_link <absolute path>: status 0 when the path is a symbolic link, or passes through a
              # directory link that sits inside the target tree or whose place cannot be resolved
  local rest=${1#/} cur="" comp phys
  [ -L "$1" ] && return 0
  while :; do
    case "$rest" in */*) comp=${rest%%/*}; rest=${rest#*/} ;; *) return 1 ;; esac
    if [ -n "$comp" ] && [ -L "$cur/$comp" ]; then
      phys=$(cd "${cur:-/}" 2>/dev/null && pwd -P) || return 0
      case "$phys/" in "$REPO_PHYS"/*) return 0 ;; esac
    fi
    cur="$cur/$comp"
  done
}
vi=0
while IFS= read -r v; do
  [ -z "$v" ] && continue
  vi=$((vi + 1))
  if [ "$(classify_source "$v")" = url ]; then
    if [ "$OFFLINE" -eq 1 ]; then record "$v" url "-" "-" "recorded, not fetched (offline)"; continue; fi
    if ! command -v curl >/dev/null 2>&1; then record "$v" url "-" "-" "not fetched: curl unavailable"; continue; fi
    name=$(safe_name "$(printf '%s' "${v%%[?#]*}" | sed 's#.*/##')")
    [ -n "$name" ] || name=download
    if curl -q --proto '=https' --proto-redir '=https' -fsSL --max-time 60 --max-filesize 52428800 \
         -A 'auditor-skill-threat-model' -o "$TMPD/fetch-$vi-$name" "$v" 2>/dev/null; then
      ingest "$v" "$TMPD/fetch-$vi-$name" "v$vi-$name"
    else
      record "$v" url "-" "-" "fetch failed"
    fi
  elif tree_link "$v"; then
    record "$v" "-" "-" "-" "skipped: symbolic link (the file, or a directory on its path inside the target tree)"
  else
    ingest "$v" "$v" "v$vi-$(safe_name "$(basename "$v")")"
  fi
done <<< "$VULNS_NL"
# An incident file counts only where an auditor run wrote it: not a symbolic link, not inside a linked
# directory, and not in an incident_* directory the target tracks.
ii=0
for f in "$REPO_ABS"/incident_*/INCIDENTS.json; do
  d=$(dirname "$f")
  if [ -L "$f" ] || [ -L "$d" ]; then record "$f" "-" "-" "-" "skipped: symbolic link (file or directory)"; continue; fi
  [ -f "$f" ] || continue
  if ! listed=$(G "$REPO_ABS" --icase-pathspecs ls-files -- "$(basename "$d")" 2>/dev/null) || [ -n "$listed" ]; then
    record "$f" "-" "-" "-" "skipped: tracked by the target, not written by an auditor run"; continue
  fi
  ii=$((ii + 1)); ingest "$f" "$f" "incident$ii-INCIDENTS.json"
done
ri=0
sort -r "$TMPD/r6f" > "$TMPD/r6f.newest"   # reverse name order: dated report names come newest first
while IFS= read -r p; do
  [ -z "$p" ] && continue
  ri=$((ri + 1))
  if [ "$ri" -gt 20 ]; then record "(further in-tree reports)" "-" "-" "-" "skipped: cap of 20 in-tree reports, listed in R6"; break; fi
  tmp="$TMPD/tree$ri-$(safe_name "$(basename "$p")")"
  G "$REPO" cat-file blob "$PIN_SHA:$p" > "$tmp" 2>/dev/null && ingest "pinned tree: $p" "$tmp" "tree$ri-$(safe_name "$(basename "$p")")"
done < "$TMPD/r6f.newest"
{
  section "R7 Inputs" "Every --vulns source, incident_*/INCIDENTS.json and in-tree report; the full manifest is inputs.tsv."
  awk -F '\t' 'NR > 1 { printf "%s. %s [%s] -> %s: %s\n", $1, $2, $3, $5, $6 }' "$OUT/inputs.tsv" > "$TMPD/r7"
  emit_capped "$TMPD/r7" "no prior-vulnerability input"
  endsec
} >> "$H"

# ---- R8 audit-mem warm ------------------------------------------------------------------------------
# Only a store passed with --audit-mem-db is read. The collector never looks for one in the target tree:
# whether a store there can be trusted (OUTPUT-RULES.md Rule 11d) is the caller's check.
{
  section "R8 audit-mem warm" "Standing rulings for this program id from the findings store passed with --audit-mem-db."
  BIN="$SKILL_ROOT/tools/auditor-tools/target/release/audit-mem"
  DB=$AUDIT_MEM_DB
  if [ -z "$PROGRAM_ID" ]; then echo "NOT FOUND (no --program-id given)"
  elif [ -z "$DB" ]; then echo "NOT FOUND (no --audit-mem-db given; the collector never looks for a store on its own)"
  elif [ ! -x "$BIN" ]; then echo "NOT FOUND (tools/auditor-tools is not built)"
  elif [ ! -f "$DB" ]; then echo "NOT FOUND (no database at $(clean "$DB"))"
  elif "$BIN" --db "$DB" warm --program-id "$PROGRAM_ID" > "$OUT/audit-mem-warm.json" 2>/dev/null; then
    echo "saved: audit-mem-warm.json"
  else
    rm -f "$OUT/audit-mem-warm.json"; echo "NOT FOUND (audit-mem warm failed)"
  fi
  endsec
} >> "$H"

echo "collect.sh: wrote $H" >&2
exit 0
