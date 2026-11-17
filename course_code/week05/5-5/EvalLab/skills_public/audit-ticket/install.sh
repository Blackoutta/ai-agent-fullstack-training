#!/usr/bin/env bash
# auditor-skill installer — clones the skill to a directory and fetches the pinned Trail of Bits tooling.
# Install it outside any repository you audit (OUTPUT-RULES.md Rule 11e).
#
# Usage:
#   ./install.sh ~/.claude/skills/auditor-skill    # user-level: every project, outside the repositories you audit
#   ./install.sh <target-dir>                      # any other location outside the repositories you audit
#   ./install.sh                                   # → ./.claude/skills/auditor-skill — only outside a repository you will audit
#   curl -fsSL https://raw.githubusercontent.com/solanabr/auditor-skill/main/install.sh | bash -s -- ~/.claude/skills/auditor-skill
#
# Re-running with the same explicit path installs a fresh clone there and moves the earlier install aside to
# <path>.old-<timestamp>. No git command ever runs inside an existing copy, and nothing from it is reused.
# A run without a path never replaces anything: it stops when ./.claude/skills/auditor-skill already exists.
set -euo pipefail

REPO="https://github.com/solanabr/auditor-skill.git"
DEST="${1:-.claude/skills/auditor-skill}"
while [ "$DEST" != "/" ] && [ "${DEST%/}" != "$DEST" ]; do DEST="${DEST%/}"; done
case "$DEST" in
  ''|/|.|..|*/.|*/..) echo "error: pass the install directory by name, not '$DEST'." >&2; exit 2 ;;
esac

# The default path can sit in a tree someone else shipped, .git/ included: a run without a path leaves an
# existing copy there alone.
if [ -z "${1:-}" ] && { [ -e "$DEST" ] || [ -L "$DEST" ]; }; then
  echo "error: $DEST already exists, and a run without a path never replaces it." >&2
  echo "  Pass the install path explicitly, e.g. ./install.sh ~/.claude/skills/auditor-skill" >&2
  exit 2
fi

# An existing copy is never opened with git, since its repo config can name filters and commands for git to
# run. An earlier install (a directory with .git/ and our SKILL.md) is moved aside once the fresh clone is
# ready; anything else is left alone.
old=""
if [ -L "$DEST" ]; then
  echo "error: $DEST is a symbolic link; pass the directory it points to." >&2
  exit 2
elif [ -d "$DEST" ] && [ -z "$(ls -A "$DEST")" ]; then
  rmdir "$DEST"
elif [ -e "$DEST" ]; then
  if ! { [ -d "$DEST/.git" ] && [ -f "$DEST/SKILL.md" ] && grep -qxE 'name: (auditor-skill|AUDITOR)' "$DEST/SKILL.md"; }; then
    echo "error: $DEST exists and is not an auditor-skill install; remove it or pass another path." >&2
    exit 2
  fi
  old="$DEST.old-$(date +%Y%m%d-%H%M%S)"
  if [ -e "$old" ] || [ -L "$old" ]; then
    echo "error: $old already exists; run the installer again in a second." >&2
    exit 2
  fi
fi

echo "→ Installing auditor-skill into: $DEST"
mkdir -p "$(dirname "$DEST")"

# A copy inside a repository you audit resolves its scripts, tools and corpus from a tree that
# repository controls. Warn, and leave the choice to the user.
if top=$(git --no-pager -c core.fsmonitor=false -C "$(dirname "$DEST")" rev-parse --show-toplevel 2>/dev/null); then
  {
    echo "warning: $DEST is inside the git work tree $top."
    echo "  If you will audit that repository, install outside it instead, e.g. ./install.sh ~/.claude/skills/auditor-skill"
    echo "  (OUTPUT-RULES.md Rule 11e)."
  } >&2
fi

# Clone into a private directory next to DEST, on the same filesystem, and move it into place when it is complete.
tmp=$(mktemp -d "$(dirname "$DEST")/.auditor-skill-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
git clone --depth 1 "$REPO" "$tmp/auditor-skill"

# Shallow, and only our own submodule: a fetch-by-SHA at depth 1 works when the pin is not upstream's tip,
# and not recursing keeps any submodule Trail of Bits might add from arriving at a commit nobody reviewed.
echo "→ Initializing Trail of Bits execution tooling (optional, shallow, at the pinned commit)"
git -C "$tmp/auditor-skill" submodule update --init --depth 1 -- vendor/trailofbits \
  || echo "  (skipped — the native corpus works without it)"

if [ -n "$old" ]; then
  mv "$DEST" "$old"
  echo "→ The earlier install is now $old; nothing from it is reused. Delete it when you no longer need it."
fi
mv "$tmp/auditor-skill" "$DEST"

cat <<EOF

✓ auditor-skill installed → $DEST

Next steps:
  • For the /auditor:* slash commands, install as a Claude Code plugin:
      /plugin marketplace add solanabr/auditor-skill
      /plugin install auditor
  • Or use it as a skill: ask your agent to "audit this repo using the auditor-skill".
  • Optional token-efficiency tools (Rust):
      cd "$DEST/tools/auditor-tools" && cargo build --release
    Build them only from an install outside any repository you audit, or under
    OUTPUT-RULES.md Rule 11a isolated mode: cargo reads config from every parent directory.
  • Review estimated costs before a full run: $DEST/COSTS.md
EOF
