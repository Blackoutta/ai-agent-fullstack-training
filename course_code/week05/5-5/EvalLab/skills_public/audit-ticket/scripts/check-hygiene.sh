#!/usr/bin/env bash
# check-hygiene.sh — fail if the repository tracks files that must never be committed:
# environment files with secrets, Terraform state / plans, per-user assistant settings, OS junk.
# Usage: bash scripts/check-hygiene.sh
set -uo pipefail
cd "$(dirname "$0")/.."

bad=0
flag() { echo "::error::tracked file must not be committed: $1" >&2; bad=1; }

while read -r f; do
  case "$f" in
    vendor/*) continue ;;
  esac
  base=$(basename "$f")
  case "$base" in
    .env|.env.*)            [[ "$base" == *.example ]] || flag "$f" ;;
    *.tfstate|*.tfstate.*)  flag "$f" ;;
    tfplan*|*.tfplan)       flag "$f" ;;
    settings.local.json)    flag "$f" ;;
    .DS_Store|Thumbs.db)    flag "$f" ;;
    id.json)                flag "$f (looks like a Solana keypair)" ;;
  esac
  case "$f" in
    .claude/*|.cursor/*|.agents/*) flag "$f (per-user assistant configuration)" ;;
  esac
done < <(git ls-files)

if [[ $bad -ne 0 ]]; then exit 1; fi
echo "hygiene check passed"
