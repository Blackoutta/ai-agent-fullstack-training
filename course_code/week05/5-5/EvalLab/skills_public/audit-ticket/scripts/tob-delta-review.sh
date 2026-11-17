#!/usr/bin/env bash
# tob-delta-review.sh — summarize what moving the vendor/trailofbits pin from OLD to NEW changes, for the
# review in CONTRIBUTING.md §5 ("Bumping vendor/trailofbits"). Prints markdown to stdout.
#
# Usage: bash scripts/tob-delta-review.sh [--fetch] <tob-clone> <old-sha> <new-sha>
#   <tob-clone>  a full (non-shallow) clone of https://github.com/trailofbits/skills
#   --fetch      run `git fetch origin` in <tob-clone> first — the only network access, off by default
#
# Read-only: it reads <tob-clone> with git and this repo's boundary-map / power-tools tables, and writes
# nothing but a temp dir it removes on exit. Git runs without a pager or signature display, and every diff,
# log and show without colour, external diff or textconv and with rename detection set on the command
# line, so those settings in the maintainer's ~/.gitconfig or the clone's config never reach the parsers
# below. Upstream's own .gitattributes cannot hide a changed file from the scans either: they diff with
# --text, and read attributes from the empty tree where git supports it (2.40+). The report informs a
# human reviewer; it is not a verdict. Works with bash 3.2.
set -uo pipefail

fetch=0
if [ "${1:-}" = "--fetch" ]; then fetch=1; shift; fi
if [ $# -ne 3 ]; then
  echo "usage: bash scripts/tob-delta-review.sh [--fetch] <tob-clone> <old-sha> <new-sha>" >&2
  exit 2
fi
repo=$(cd "$1" 2>/dev/null && pwd) || { echo "no such directory: $1" >&2; exit 2; }
old=$2; new=$3
cd "$(dirname "$0")/.."

ATTR=()
g() { git --no-pager -c log.showSignature=false -C "$repo" ${ATTR[@]+"${ATTR[@]}"} "$@"; }
# on every diff, log and show: plain text with fixed a/ b/ prefixes and no rename or copy detection
DIFFSAFE=(--no-color --no-ext-diff --no-textconv --no-renames --src-prefix=a/ --dst-prefix=b/)
SCAN=("${DIFFSAFE[@]}" --text)   # on every call whose output a scan reads: no file counts as binary
if [ "$fetch" -eq 1 ]; then g fetch --quiet origin || { echo "fetch failed" >&2; exit 2; }; fi
for c in "$old" "$new"; do
  g cat-file -e "$c^{commit}" 2>/dev/null \
    || { echo "commit $c not found in $repo (shallow or stale clone? try --fetch)" >&2; exit 2; }
done
[ "$(g rev-parse --is-shallow-repository)" = "true" ] && echo "warning: $repo is shallow; counts may be incomplete" >&2
empty=$(g hash-object -t tree --no-filters /dev/null)
if g --attr-source="$empty" check-attr diff -- probe.sh >/dev/null 2>&1; then ATTR=(--attr-source="$empty"); fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/tob-delta.XXXXXX") || exit 2
trap 'rm -rf "$tmp"' EXIT

section() { printf '\n### %s\n' "$1"; }
show() { if [ -s "$1" ]; then cat "$1"; else echo "(none)"; fi; }
# "<mode> <path>" for every tree entry, path kept whole (tab-separated in ls-tree output)
entries() { g ls-tree -r --full-tree "$1" | awk -F'\t' '{ split($1, a, " "); print a[1] "\t" $2 }'; }

entries "$old" > "$tmp/old"
entries "$new" > "$tmp/new"
g diff "${SCAN[@]}" --name-status -M "$old" "$new" > "$tmp/ns"

echo "## trailofbits/skills $(g log "${DIFFSAFE[@]}" -1 --format='%h %cs' "$old") -> $(g log "${DIFFSAFE[@]}" -1 --format='%h %cs' "$new")"
echo
echo "$(g rev-list --count "$old..$new") commits;$(g diff "${DIFFSAFE[@]}" --shortstat "$old" "$new")."
if g merge-base --is-ancestor "$old" "$new"; then echo "NEW descends from OLD."; else echo "**NEW does not descend from OLD.**"; fi

section "Plugins added (+) / removed (-)"
g ls-tree --name-only "$old:plugins" | sort > "$tmp/p_old"
g ls-tree --name-only "$new:plugins" | sort > "$tmp/p_new"
comm -3 "$tmp/p_old" "$tmp/p_new" | awk -F'\t' '{ if ($1 == "") print "+ " $2; else print "- " $1 }' > "$tmp/p"
show "$tmp/p"

section "Load surfaces: nested .claude/, hooks, MCP/LSP, settings, CLAUDE.md/AGENTS.md, Workflow scripts"
grep -E '(^|/|[[:space:]])\.claude/|(^|/|[[:space:]])hooks(/|\.json)|\.mcp\.json|\.lsp\.json|settings[^/]*\.json|(^|/|[[:space:]])(CLAUDE|AGENTS)\.md|workflows/[^/]*\.js' \
  "$tmp/ns" > "$tmp/ls" || true
show "$tmp/ls"

section "Plugin manifests (.claude-plugin/) added or removed"
grep -E '\.claude-plugin/' "$tmp/ns" | grep -vE '^M' > "$tmp/man" || true
show "$tmp/man"
echo "($(grep -cE '^M.*\.claude-plugin/' "$tmp/ns") modified — version and description bumps; inline declarations below)"

section "Manifests (plugin.json, marketplace.json) that declare hooks, MCP or LSP servers inline (at NEW)"
awk -F'\t' '$2 ~ /(^|\/)\.claude-plugin\/(plugin|marketplace)\.json$/ {print $2}' "$tmp/new" | while IFS= read -r f; do
  if g show "${SCAN[@]}" "$new:$f" | grep -E '"(hooks|mcpServers|lspServers)"' >/dev/null; then echo "$f"; fi
done > "$tmp/inline"
show "$tmp/inline"

section "Skills and commands per plugin, OLD -> NEW (changed only)"
# "<plugin>\t<SKILL.md count>\t<command count>" for plugins/<p>/skills/<s>/SKILL.md and plugins/<p>/commands/*.md
counts() { awk -F'\t' '{ n = split($2, p, "/") }
  p[1] == "plugins" && n >= 2 { seen[p[2]] = 1 }
  p[1] == "plugins" && n == 5 && p[3] == "skills" && p[5] == "SKILL.md" { s[p[2]]++ }
  p[1] == "plugins" && n == 4 && p[3] == "commands" && p[4] ~ /\.md$/ { c[p[2]]++ }
  END { for (k in seen) printf "%s\t%d\t%d\n", k, s[k], c[k] }' "$1" | sort; }
counts "$tmp/old" > "$tmp/c_old"
counts "$tmp/new" > "$tmp/c_new"
awk -F'\t' 'FILENAME == ARGV[1] { os[$1] = $2; oc[$1] = $3; seen[$1] = 1; next }
  { ns[$1] = $2; nc[$1] = $3; seen[$1] = 1 }
  END { for (k in seen) if (os[k] + 0 != ns[k] + 0 || oc[k] + 0 != nc[k] + 0)
          printf "- %s: skills %d -> %d, commands %d -> %d\n", k, os[k], ns[k], oc[k], nc[k] }' \
  "$tmp/c_old" "$tmp/c_new" | sort > "$tmp/sc"
show "$tmp/sc"
cnt() { awk -F'\t' -v p="$2" -v f="$3" '$1 == p { print $f }' "$1"; } # cnt FILE PLUGIN FIELD

section "New executables (mode 100755)"
awk -F'\t' '$1 == "100755" {print $2}' "$tmp/old" | sort > "$tmp/x_old"
awk -F'\t' '$1 == "100755" {print $2}' "$tmp/new" | sort > "$tmp/x_new"
comm -13 "$tmp/x_old" "$tmp/x_new" > "$tmp/x"
show "$tmp/x"

section "Symlinks (120000) and gitlinks (160000) at NEW"
awk -F'\t' '$1 == "120000" || $1 == "160000" {print $1 " " $2}' "$tmp/new" > "$tmp/links"
show "$tmp/links"

hosts() { grep -E '^\+' | grep -oE 'https?://[A-Za-z0-9.-]+' | sort | uniq -c | sort -rn; }
NOTESTS=(':(exclude)*/tests/*' ':(exclude)*/evals/*' ':(exclude)*/evals-extra/*' ':(exclude)*/fixtures/*')

section "Hosts in added lines of scripts and config (excluding tests, evals, fixtures and lockfiles)"
g diff "${SCAN[@]}" -U0 "$old" "$new" -- '*.sh' '*.bash' '*.py' '*.js' '*.mjs' '*.cjs' '*.ts' '*.json' '*.toml' '*.yml' '*.yaml' \
  "${NOTESTS[@]}" ':(exclude)*.lock' ':(exclude)*package-lock.json' | hosts > "$tmp/hosts" || true
show "$tmp/hosts"

section "Hosts in added Markdown lines: skill and command text an agent may follow (excluding tests, evals and fixtures)"
g diff "${SCAN[@]}" -U0 "$old" "$new" -- '*.md' "${NOTESTS[@]}" | hosts > "$tmp/mdhosts" || true
show "$tmp/mdhosts"

section "Remote-exec patterns in added lines, continuation lines joined (pipe to a shell or interpreter, sh -c \"\$(curl …)\", <(curl …), npx --yes, pip / uvx from a URL)"
# "<path>: <added line>". An added line ending in a backslash, or in a pipe outside a Markdown table row, is
# joined with the next added line, so a multi-line installer is scanned as one command.
joined() { awk '
  function flush() { if (buf != "") print file ": " buf; buf = "" }
  /^\+\+\+ / { flush(); file = substr($0, 5); sub(/^b\//, "", file); next }
  /^\+/ { s = substr($0, 2); if (buf != "") sub(/^[ \t]+/, "", s); buf = (buf == "") ? s : buf " " s
          if (buf ~ /\\[ \t]*$/) { sub(/[ \t]*\\[ \t]*$/, "", buf); next }
          if (buf ~ /[|][ \t]*$/ && s !~ /^[ \t]*[|]/) next
          flush(); next }
  { flush() }
  END { flush() }'; }
SHELLS='((ba|z|da|k)?sh|python[0-9.]*|node|perl|ruby)([[:space:];&|)]|$)'
RX_PIPE="(curl|wget)[[:space:]].*[|][[:space:]]*(sudo([[:space:]]+-[A-Za-z]+([[:space:]]+[A-Za-z0-9_]+)?)*[[:space:]]+)?((/[^[:space:]|]*/)?env([[:space:]]+[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)*[[:space:]]+)?(/[^[:space:]|]*/)?$SHELLS"
RX_SUBST="((ba|z|da|k)?sh[[:space:]]+-c|eval)[[:space:]]+[\"']?[\$][(][[:space:]]*(curl|wget)[[:space:]]"
RX_PROC='(source|[.]|(ba|z|da|k)?sh)[[:space:]]+<[(][[:space:]]*(curl|wget)[[:space:]]'
RX_PKG='npx[[:space:]]+(-y|--yes)([[:space:]]|$)|pip[0-9.]*[[:space:]]+install[[:space:]]+([^|;&]*[[:space:]])?(git[+]|https?://)|uvx[[:space:]]+--from[[:space:]]+git[+]'
g diff "${SCAN[@]}" -U0 "$old" "$new" -- . ':(exclude)*.lock' | joined \
  | grep -E "$RX_PIPE|$RX_SUBST|$RX_PROC|$RX_PKG" > "$tmp/rx" || true
show "$tmp/rx"

section "LICENSE"
if g diff "${DIFFSAFE[@]}" --quiet "$old" "$new" -- LICENSE; then echo "unchanged"; else echo "**CHANGED** — re-check ATTRIBUTION.md"; fi
awk -F'\t' '{print $NF}' "$tmp/ns" | grep -iE '(^|/)(LICEN[CS]E|COPYING|NOTICE)[^/]*$' | grep -vx 'LICENSE' > "$tmp/lic" || true
if [ -s "$tmp/lic" ]; then echo "Other licence files added or changed:"; cat "$tmp/lic"; fi

section "Plugins this repo names (boundary-map.md, power-tools.md): present at NEW?"
{
  awk -F'|' '/^\|/ && NF > 4 {print $3}' references/orchestration/boundary-map.md
  awk -F'|' '/^## Trail of Bits plugins/ {on = 1; next} /^## / {on = 0} on && /^\|/ && NF > 4 {print $3}' docs/power-tools.md
} | grep -oE '`[a-z0-9][a-z0-9-]*`' | tr -d '`' | sort -u > "$tmp/named"
while IFS= read -r p; do
  if g cat-file -e "$new:plugins/$p" 2>/dev/null; then
    st=$(g diff "${DIFFSAFE[@]}" --shortstat "$old" "$new" -- "plugins/$p" | sed 's/^ //')
    so=$(cnt "$tmp/c_old" "$p" 2); sn=$(cnt "$tmp/c_new" "$p" 2)
    co=$(cnt "$tmp/c_old" "$p" 3); cn=$(cnt "$tmp/c_new" "$p" 3)
    note=""; [ "${so:-0}" -gt 0 ] && [ "${sn:-0}" -eq 0 ] && note=" — **no SKILL.md at NEW**"
    printf -- '- %s: present (skills %s -> %s, commands %s -> %s; %s)%s\n' \
      "$p" "${so:-0}" "${sn:-0}" "${co:-0}" "${cn:-0}" "${st:-unchanged}" "$note"
  else
    printf -- '- %s: **MISSING at NEW** — update the rows that name it\n' "$p"
  fi
done < "$tmp/named"
