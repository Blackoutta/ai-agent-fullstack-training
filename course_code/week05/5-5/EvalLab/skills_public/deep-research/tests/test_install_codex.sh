#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT

assert_contains() {
  local path="$1"
  local expected="$2"
  if ! rg -F "$expected" "$path" >/dev/null 2>&1; then
    echo "expected '$expected' in $path" >&2
    exit 1
  fi
}

HOME="$TMP_HOME" bash "$ROOT_DIR/scripts/install-codex.sh"
HOME="$TMP_HOME" bash "$ROOT_DIR/scripts/install-codex.sh"

if [[ ! -f "$TMP_HOME/.codex/config.toml" ]]; then
  echo "expected config.toml to exist" >&2
  exit 1
fi

if [[ -d "$TMP_HOME/.codex/skills" ]]; then
  echo "did not expect skills directory to be created" >&2
  exit 1
fi

if [[ -d "$TMP_HOME/.codex/agents" ]]; then
  echo "did not expect agents directory to be created" >&2
  exit 1
fi

assert_contains "$TMP_HOME/.codex/config.toml" "multi_agent = true"
assert_contains "$TMP_HOME/.codex/config.toml" "default_mode_request_user_input = true"
assert_contains "$TMP_HOME/.codex/config.toml" "suppress_unstable_features_warning = true"
assert_contains "$TMP_HOME/.codex/config.toml" "[agents.web_researcher]"
assert_contains "$TMP_HOME/.codex/config.toml" 'config_file = "agents/web-researcher.toml"'

if [[ "$(rg -c '^\[features\]$' "$TMP_HOME/.codex/config.toml")" != "1" ]]; then
  echo "expected exactly one [features] section" >&2
  exit 1
fi

if [[ "$(rg -c '^\[agents\.web_researcher\]$' "$TMP_HOME/.codex/config.toml")" != "1" ]]; then
  echo "expected exactly one [agents.web_researcher] section" >&2
  exit 1
fi

if awk '
  /^\[features\]$/ { in_features=1; next }
  /^\[/ { in_features=0 }
  in_features && /suppress_unstable_features_warning/
' "$TMP_HOME/.codex/config.toml" | grep -q .; then
  echo "did not expect suppress_unstable_features_warning inside [features]" >&2
  exit 1
fi

echo "install-codex test passed"
