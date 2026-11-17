#!/usr/bin/env bash
# test-gha-recipes.sh — run the GitHub Actions recipes exactly as written against the fixture workflows in
# scripts/tests/fixtures/gha/, and check that each recipe flags exactly the expected fixtures:
#   R1–R8    discovery/grep-commands.md, section "GitHub Actions (CI trigger trust)";
#   K116-1   KV-116 Step 1 (AI-agent steps);
#   K139-1   KV-139 Step 1 (externally triggerable workflows);
#   K140-6   KV-140 Step 6 (Actions cache writers and restorers).
# It also checks that every known-vector step that repeats an R recipe carries it byte for byte.
#
# Usage (from the repo root): bash scripts/tests/test-gha-recipes.sh
# Needs bash >= 3.2, grep, awk, xargs. No network. The fixtures are copied into a temp dir as
# .github/workflows/ for the run; nothing is written under the repository's own .github/.
set -uo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
doc="$root/discovery/grep-commands.md"
kv="$root/known-vectors"
fixtures="$root/scripts/tests/fixtures/gha"

work=$(mktemp -d "${TMPDIR:-/tmp}/gha-recipes.XXXXXX") || exit 1
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/.github/workflows"
cp "$fixtures"/*.yml "$work/.github/workflows/" || exit 1

# The command line that follows the "# Rn — …" comment inside the GitHub Actions section of the doc.
recipe() {
  awk -v id="$1" '
    /^## GitHub Actions \(CI trigger trust\)/ { sec = 1; next }
    sec && /^## / { exit }
    sec && index($0, "# " id " ") == 1 { grab = 1; next }
    sec && grab && /^grep / { print; exit }
  ' "$doc"
}

# The `grep` lines inside a known vector's "**Step <n>:" block, in order.
kv_step() { # kv_step <vector file> <step>
  awk -v n="$2" '
    index($0, "**Step " n ":") == 1 { s = 1; next }
    s && /^\*\*Step / { exit }
    s && /^grep / { print }
  ' "$kv/$1"
}

KV080=080-ci-cd-pipeline-injection.md
KV116=116-ai-coding-agent-ci-deploy-key.md
KV139=139-comment-triggered-workflow-author-gating.md
KV140=140-workflow-run-pwn-request-artifact-cache-poisoning.md

# Recipes that live only in a known vector (<id> <vector file> <step>): the step's first grep line.
KV_RECIPES="K116-1 $KV116 1
K139-1 $KV139 1
K140-6 $KV140 6"

# Known-vector steps that repeat an R recipe (<id> <vector file> <step>).
COPIES="R1 $KV080 7
R2 $KV139 3
R3 $KV139 4
R4 $KV140 4
R5 $KV140 5
R7 $KV080 2
R7 $KV140 2"

# Fixtures each recipe must flag (two-digit prefixes, ascending). Anything else is a mismatch.
expected() {
  case "$1" in
    R1) echo "01 08 10 16 40" ;;
    R2) echo "02 04" ;;
    R3) echo "03 12 13 17 25 26 27 28" ;;
    R4) echo "05 06 21 29 30 41" ;;
    R5) echo "06 07 15" ;;
    R6) echo "05 07 08 14 15 16 20 31 32" ;;
    R7) echo "05 07 11 12 15 18 19 20 21 22 23 24" ;;
    R8) echo "01 08 11 14 33 34" ;;
    K116-1) echo "01 08 11 14 33 34" ;;
    K139-1) echo "01 02 03 04 08 10 11 14 16 17 22 23 25 26 33 40" ;;
    K140-6) echo "35 36 37 38 39 42 43 44 45" ;;
  esac
}

fail=0; nrec=0
check() { # check <id> <command line>
  nrec=$((nrec + 1))
  if [ -z "$2" ]; then
    echo "FAIL $1: no recipe line found"
    fail=1
    return
  fi
  got=$(cd "$work" && eval "$2" </dev/null 2>/dev/null \
    | sed -E 's#^\.github/workflows/##; s#^([0-9][0-9])-.*#\1#' | sort -u | tr '\n' ' ' | sed 's/ $//')
  want=$(expected "$1")
  if [ "$got" = "$want" ]; then
    echo "ok   $1: $got"
  else
    echo "FAIL $1: got [$got] want [$want]"
    fail=1
  fi
}

for id in R1 R2 R3 R4 R5 R6 R7 R8; do
  check "$id" "$(recipe "$id")"
done
while read -r id file step; do
  check "$id" "$(kv_step "$file" "$step" | sed -n 1p)"
done <<< "$KV_RECIPES"

ncopy=0
while read -r id file step; do
  ncopy=$((ncopy + 1))
  line=$(recipe "$id")
  if [ -n "$line" ] && kv_step "$file" "$step" | grep -qxF -- "$line"; then
    echo "ok   copy of $id in $file step $step"
  else
    echo "FAIL copy of $id in $file step $step differs from discovery/grep-commands.md"
    fail=1
  fi
done <<< "$COPIES"

# The negative control must stay silent for every recipe.
for id in R1 R2 R3 R4 R5 R6 R7 R8 K116-1 K139-1 K140-6; do
  case " $(expected "$id") " in *" 09 "*) echo "FAIL $id: negative control 09 is expected"; fail=1 ;; esac
done

if [ "$fail" -ne 0 ]; then echo "gha recipe test FAILED" >&2; exit 1; fi
echo "gha recipe test passed: $nrec recipes, $(ls "$fixtures"/*.yml | wc -l | tr -d ' ') fixtures, $ncopy copies"
