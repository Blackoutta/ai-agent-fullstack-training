#!/usr/bin/env bash
# check-attribution.sh — fail if any commit in RANGE carries an AI-attribution trailer.
# Usage: bash scripts/check-attribution.sh "origin/main..HEAD"
# Same pattern as scripts/hooks/commit-msg, applied to a commit range (used by CI on pull requests).
set -uo pipefail
range=${1:-"origin/main..HEAD"}
pattern='^(Co-Authored-By: .*(Claude|Anthropic|noreply@anthropic\.com))|(Generated with .*Claude)|(🤖 Generated)'

bad=0
while read -r sha; do
  [[ -z "$sha" ]] && continue
  if git log -1 --format=%B "$sha" | grep -qiE "$pattern"; then
    echo "::error::commit $sha carries an AI-attribution trailer — remove it (see CONTRIBUTING.md §1)" >&2
    bad=1
  fi
done < <(git rev-list "$range" 2>/dev/null)

if [[ $bad -ne 0 ]]; then exit 1; fi
echo "attribution check passed for $range"
