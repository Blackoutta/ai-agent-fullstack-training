#!/bin/sh
# report-to-pdf.sh — best-effort Markdown -> PDF for audit reports.
#
# The Markdown report is ALWAYS the primary deliverable. PDF is a convenience.
# This script is NEVER a hard dependency: if pandoc is not installed it prints a
# clear message and exits 0 (success), so it can be wired into any pipeline
# without ever breaking a build.
#
# Usage (by the installation's absolute path, never one relative to the audited repo):
#   "${CLAUDE_PLUGIN_ROOT}/scripts/report-to-pdf.sh" [path/to/REPORT.md]
#
# If no argument is given, it defaults to the newest audit_*/REPORT.md.
# Output PDF is written next to the input, with the .md extension swapped for .pdf.

set -eu

# ---- Resolve input ----------------------------------------------------------
INPUT="${1:-}"

if [ -z "$INPUT" ]; then
  # Default: newest audit_*/REPORT.md in the current directory.
  INPUT="$(ls -1dt audit_*/REPORT.md 2>/dev/null | head -n 1 || true)"
  if [ -z "$INPUT" ]; then
    echo "report-to-pdf: no input given and no audit_*/REPORT.md found." >&2
    echo "               usage: $0 [path/to/REPORT.md]" >&2
    exit 0
  fi
  echo "report-to-pdf: no input given; using newest report: $INPUT"
fi

if [ ! -f "$INPUT" ]; then
  echo "report-to-pdf: input file not found: $INPUT" >&2
  exit 0
fi

# ---- Check for pandoc (soft dependency) ------------------------------------
if ! command -v pandoc >/dev/null 2>&1; then
  echo "report-to-pdf: pandoc not found — skipping PDF generation (non-fatal)."
  echo "               The Markdown report is the primary deliverable: $INPUT"
  echo "               To enable PDF export, install pandoc:"
  echo "                 macOS:         brew install pandoc"
  echo "                 Debian/Ubuntu: sudo apt-get install pandoc"
  echo "                 (a LaTeX engine such as 'basictex' or 'texlive' may also be required)"
  exit 0
fi

# ---- Render -----------------------------------------------------------------
OUTPUT="${INPUT%.md}.pdf"

echo "report-to-pdf: rendering $INPUT -> $OUTPUT"
if pandoc "$INPUT" -o "$OUTPUT"; then
  echo "report-to-pdf: wrote $OUTPUT"
else
  echo "report-to-pdf: pandoc failed to render PDF (non-fatal)." >&2
  echo "               The Markdown report remains the deliverable: $INPUT" >&2
  echo "               A missing PDF engine (LaTeX) is the usual cause; try:" >&2
  echo "                 macOS: brew install basictex   (or a full texlive)" >&2
  exit 0
fi
