#!/usr/bin/env bash

set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CONFIG_PATH="$CODEX_HOME/config.toml"

mkdir -p "$CODEX_HOME"

python3 - "$CONFIG_PATH" <<'PY'
import re
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
text = config_path.read_text(encoding="utf-8") if config_path.exists() else ""

blocks = {
    "features": """[features]
multi_agent = true
default_mode_request_user_input = true
""",
    "agents.web_researcher": """[agents.web_researcher]
description = "Use this agent when you need to research information on the internet, particularly for debugging issues, finding solutions to technical problems, or gathering comprehensive information from multiple sources. This agent excels at finding relevant discussions. Use when you need creative search strategies, thorough investigation, or compilation of findings from multiple sources."
config_file = "agents/web-researcher.toml"
""",
}

for section, block in blocks.items():
    pattern = rf"(?ms)^\[{re.escape(section)}\]\n.*?(?=^\[|\Z)"
    if re.search(pattern, text):
        text = re.sub(pattern, block, text)
    else:
        text = text.rstrip() + ("\n\n" if text.strip() else "") + block

text = re.sub(r"(?m)^suppress_unstable_features_warning\s*=.*\n?", "", text).strip()
text = 'suppress_unstable_features_warning = true\n\n' + text

config_path.write_text(text.rstrip() + "\n", encoding="utf-8")
PY

echo "Updated Codex config at $CONFIG_PATH"
