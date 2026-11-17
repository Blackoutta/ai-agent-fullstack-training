#!/usr/bin/env bash
# test-bundled-paths.sh — bundled executables run from the auditor-skill root, never by a path relative to
# the working directory, which during an audit is usually the target repository (OUTPUT-RULES.md Rule 11e).
#   1. commands/ and agents/, where Claude Code fills in ${CLAUDE_PLUGIN_ROOT}, name no bundled tool,
#      Trail of Bits plugin, PoC template or script by a relative path, and never use ${CLAUDE_SKILL_DIR};
#   2. the skill body, references/, discovery/, docs/, templates/ and README.md never *run* one by a
#      relative path: an interpreter, `source` / `.`, `uv run`, `env …` or `cd` in front of it, a `test -d/-x`
#      on it, a copy of templates/poc, or a code span / code line that starts with a relative script and
#      passes it arguments. Prose that merely names a path ("a minimized templates/poc crate", a
#      markdown link) is allowed there;
#   3. every site fixed so far keeps its rooted form, and the corpus-read and .audit-memory rules stay
#      stated (the PINS list);
#   4. every rooted path those files name exists in this checkout (binaries: declared in the crate);
#   5. Rule 11e and its pointers in SKILL.md / AGENTS.md / FULL-AUDIT.md are in place; 11a–11e keep their
#      headings;
#   6. the .audit-memory store check runs case-insensitively everywhere: no line pairs `ls-files` with
#      `.audit-memory` without --icase-pathspecs (the canonical form is pinned in OUTPUT-RULES.md and
#      pre-scan.md), since on a case-insensitive filesystem a tracked .AUDIT-MEMORY/ is the same directory;
#   7. /auditor:hunt, /auditor:respond and incident-responder name every corpus file they read (references/,
#      templates/, checklists/, discovery/, OUTPUT-RULES.md, …) from ${CLAUDE_PLUGIN_ROOT}: no relative corpus
#      directory and no bare corpus file name. Run-directory outputs (audit_<n>/threat-model.md,
#      INCIDENT_REPORT.md) are not corpus files.
# Each detector is first run against known-good and known-bad lines, so a broken pattern fails the test.
# Usage (from the repo root): bash scripts/tests/test-bundled-paths.sh   (VERBOSE=1 lists every check)
# Needs bash >= 3.2, grep, sed, awk, find. No network.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
export LC_ALL=C
pass=0; failn=0
ok()  { pass=$((pass + 1)); if [ -n "${VERBOSE:-}" ]; then echo "ok   $*"; fi; }
bad() { failn=$((failn + 1)); echo "FAIL $*"; }

STRICT_FILES=$(ls commands/*.md agents/*.md)
RUN_FILES=$(ls SKILL.md FULL-AUDIT.md AGENTS.md OUTPUT-RULES.md README.md; find references discovery docs templates -name '*.md' | sort)

# A bundled path preceded by start of line or a non-path character, after any ./ or ../ prefix.
PRE='(^|[^A-Za-z0-9_./}>-])(\.\.?/)*'
TOKENS="${PRE}(tools/auditor-tools|vendor/trailofbits|templates/poc)"
BIN_REL="${PRE}tools/auditor-tools/target/"
PLUGINS_REL="${PRE}vendor/trailofbits/plugins"
TEST_REL='(test|\[)[[:space:]]+-[a-z][[:space:]]+"?(\.\.?/)*(vendor/trailofbits|tools/auditor-tools|templates/poc|scripts/)'
CP_REL='(^|[^A-Za-z0-9_-])(cp|rsync)[[:space:]][^|;&]*[[:space:]]"?(\.\.?/)*templates/poc'
CD_REL='(^|[^A-Za-z0-9_-])cd[[:space:]]+"?(\.\.?/)*(tools/auditor-tools|vendor/trailofbits|templates/poc|scripts)([/"[:space:]&;|)]|$)'
# An interpreter (options and VAR=value allowed in between) handed a relative scripts/ path.
RUNNER='(bash|sh|zsh|source|\.|python3?|uv[[:space:]]+run|node|perl|env)'
OPTS='([[:space:]]+(-[^[:space:]`]*|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]`]*))*'
SCRIPT_RUN="(^|[^A-Za-z0-9_./-])${RUNNER}${OPTS}[[:space:]]+\"?(\\.\\.?/)*scripts/"
SCRIPT_SPAN='`(\.\.?/)*scripts/[^`[:space:]]*\.(sh|py)'
SPAN_ARGS='`(\.\.?/)*scripts/[^`[:space:]]+[[:space:]]+[^`]*`'
LINE_SCRIPT='^[[:space:]>]*"?(\.\.?/)*scripts/[^[:space:]"`]+\.(sh|py|js|mjs|ts|pl|rb)([[:space:]"]|$)'
DOT_SCRIPT='(^|[^A-Za-z0-9_./-])\.\.?/scripts/'
SKILL_DIR_VAR='[$][{]CLAUDE_SKILL_DIR[}]'

# Replace the rooted forms each kind of file may use, and markdown link targets (navigation, never a
# command), so only relative spellings are left to match.
strip_rooted() { # strip_rooted strict|run  (stdin -> stdout, same line count)
  if [ "$1" = strict ]; then
    sed -E -e 's#\]\([^)]*\)#]()#g' -e 's#[$][{]CLAUDE_PLUGIN_ROOT[}]/[A-Za-z0-9_./-]*#@ROOT@#g'
  else
    sed -E -e 's#\]\([^)]*\)#]()#g' \
      -e 's#([$][{]CLAUDE_(PLUGIN_ROOT|SKILL_DIR)[}]|<auditor-skill root>)/[A-Za-z0-9_./-]*#@ROOT@#g'
  fi
}
offending_lines() { # offending_lines strict|run  (stdin -> numbers of offending lines)
  if [ "$1" = strict ]; then
    strip_rooted strict | grep -nE -e "$TOKENS" -e "$SCRIPT_RUN" -e "$SCRIPT_SPAN" -e "$SPAN_ARGS" \
      -e "$LINE_SCRIPT" -e "$DOT_SCRIPT" -e "$CD_REL" -e "$SKILL_DIR_VAR" | cut -d: -f1
  else
    strip_rooted run | grep -nE -e "$TEST_REL" -e "$BIN_REL" -e "$PLUGINS_REL" -e "$CP_REL" -e "$CD_REL" \
      -e "$SCRIPT_RUN" -e "$SPAN_ARGS" -e "$LINE_SCRIPT" -e "$DOT_SCRIPT" | cut -d: -f1
  fi
}

# ---- 0. the detector itself -------------------------------------------------------------------------
expect_flag() { # expect_flag strict|run yes|no LINE
  local got=no
  [ -n "$(printf '%s\n' "$3" | offending_lines "$1")" ] && got=yes
  if [ "$got" = "$2" ]; then ok "detector ($1) flagged=$2: $3"; else bad "detector ($1) flagged=$got, want $2: $3"; fi
}
for line in \
  'If `tools/auditor-tools` is built, run it.' \
  'run `test -x tools/auditor-tools/target/release/audit-mem` first' \
  'run ./tools/auditor-tools/target/release/audit-scan src' \
  'When `vendor/trailofbits/plugins` is present' \
  'Copy the harness from `templates/poc/` and fill it' \
  '`bash scripts/dnr/profile.sh` corpus.jsonl' \
  'python3 -I scripts/dnr/frames.py corpus.jsonl' \
  'Then run `uv run scripts/threat-model/extra.py --repo .`.' \
  'First `source scripts/tob-env.sh`.' \
  'then `./scripts/report-to-pdf.sh audit_1/REPORT.md`' \
  'then `scripts/report-to-pdf.sh audit_1/REPORT.md`' \
  'allowed-tools: Read, Bash(bash scripts/threat-model/collect.sh *)' \
  'run `"${CLAUDE_SKILL_DIR}/scripts/report-to-pdf.sh"`' \
  'scripts/dnr/profile.sh incident_1/corpus/transactions.jsonl' \
  '   scripts/report-to-pdf.sh audit_1/REPORT.md' \
  'Then run `scripts/threat-model/extract --repo . --offline` first.'; do
  expect_flag strict yes "$line"
done
for line in \
  'run `"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" check`' \
  'present (`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`)' \
  'copy from `"${CLAUDE_PLUGIN_ROOT}/templates/poc/"` and fill it' \
  '`bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/profile.sh" corpus.jsonl`' \
  '`python3 -I "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/<name>.py"`' \
  'never a `scripts/…`, `tools/…` or `vendor/…` path relative to the working directory' \
  'never a relative `templates/` path' \
  'see [references/orchestration/poc-harness.md](../references/orchestration/poc-harness.md)'; do
  expect_flag strict no "$line"
done
for line in \
  'test -d vendor/trailofbits/plugins && echo present' \
  '[ -x tools/auditor-tools/target/release/audit-mem ] && echo built' \
  '"tools/auditor-tools/target/release/audit-scan" src --out prescan.json' \
  'bash scripts/threat-model/collect.sh --repo x --out y --detect' \
  'First `source scripts/tob-env.sh`.' \
  '. ./scripts/env.sh' \
  'uv run --no-project scripts/merge.py a b' \
  'env FOO=1 scripts/run.sh' \
  'node scripts/build.mjs' \
  'perl -w scripts/x.pl' \
  'Run `scripts/threat-model/collect.sh --repo . --offline` first.' \
  '  scripts/report-to-pdf.sh audit_1/REPORT.md   # writes REPORT.pdf' \
  'Run `cd tools/auditor-tools && cargo build --release` now.' \
  'cd templates/poc && ./run.sh' \
  'cp -R templates/poc audit_1/poc/F-001' \
  '| Capability | ToB plugin (`vendor/trailofbits/plugins/…`) |'; do
  expect_flag run yes "$line"
done
for line in \
  'test -d "<auditor-skill root>/vendor/trailofbits/plugins" && echo present' \
  '"<auditor-skill root>/tools/auditor-tools/target/release/audit-scan" src' \
  'cd "<auditor-skill root>/tools/auditor-tools" && cargo build --release' \
  'PDF via `"${CLAUDE_SKILL_DIR}/scripts/report-to-pdf.sh"`' \
  'Optional PDF via `scripts/report-to-pdf.sh` (pandoc-gated)' \
  'a minimized `templates/poc` crate builds from a scratch copy' \
  'The bundled `scripts/threat-model/collect.sh`, run from the installation' \
  'If `tools/auditor-tools/` is built' \
  '- **Recipes:** [`scripts/dnr/`](../scripts/dnr/) — profiling' \
  'git submodule update --init --depth 1 -- vendor/trailofbits' \
  'grep -rn "clippy" .github/ Makefile* scripts/ --include="*.yml"' \
  'the semgrep skill runs `{baseDir}/scripts/run-scans.sh`' \
  'each node in scripts/ is listed'; do
  expect_flag run no "$line"
done

# ---- 1 + 2. the corpus -------------------------------------------------------------------------------
scan() { # scan strict|run FILES...
  local mode=$1 f n why; shift
  why='bundled executable run by a path relative to the working directory'
  [ "$mode" = strict ] && why='bundled path not written from ${CLAUDE_PLUGIN_ROOT}'
  for f in "$@"; do
    [ -f "$f" ] || { bad "$f: listed for the $mode scan but missing"; continue; }
    n=$(offending_lines "$mode" < "$f")
    if [ -z "$n" ]; then ok "$f: no relative bundled path ($mode)"; continue; fi
    for n in $n; do bad "$f:$n: $why: $(sed -n "${n}p" "$f" | cut -c1-160)"; done
  done
}
scan strict $STRICT_FILES
scan run $RUN_FILES

# ---- 3. pinned sites ------------------------------------------------------------------------------------
# file <TAB> text that must stay in it: each site fixed so far in its rooted form, plus the rule text.
while IFS='	' read -r f want; do
  [ -n "$f" ] || continue
  if grep -qF -- "$want" "$f" 2>/dev/null; then ok "pin $f: $want"; else bad "pin $f lost its rooted form: $want"; fi
done <<'PINS'
SKILL.md	"${CLAUDE_SKILL_DIR}/scripts/report-to-pdf.sh"
FULL-AUDIT.md	`test -x "<auditor-skill root>/tools/auditor-tools/target/release/audit-scan"`
FULL-AUDIT.md	`"<auditor-skill root>/tools/auditor-tools/target/release/audit-scan" <program-path>
FULL-AUDIT.md	`"<auditor-skill root>/tools/auditor-tools/target/release/audit-mem" warm
commands/audit.md	`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`
commands/quick-scan.md	`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`
commands/audit-assist.md	`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`
commands/audit-cycle.md	`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`
commands/audit-cycle.md	`"${CLAUDE_PLUGIN_ROOT}/scripts/report-to-pdf.sh" audit_<n>/REPORT.md`
commands/triage.md	`test -x "${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem"`
commands/triage.md	`"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" check
commands/triage.md	`"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" regressions
commands/triage.md	`"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" put-finding
commands/intake.md	`"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" warm
commands/threat-model.md	`"${CLAUDE_PLUGIN_ROOT}/tools/auditor-tools/target/release/audit-mem" warm
commands/threat-model.md	bash "${CLAUDE_PLUGIN_ROOT}/scripts/threat-model/collect.sh" --repo <target> --out audit_<n>/bootstrap --pin <sha from intake> --offline
commands/poc.md	`"${CLAUDE_PLUGIN_ROOT}/templates/poc/"`
agents/poc-engineer.md	`"${CLAUDE_PLUGIN_ROOT}/templates/poc/"`
agents/poc-engineer.md	`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`
agents/peer-reviewer.md	`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`
agents/vuln-hunter.md	`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`
agents/patch-engineer.md	`test -d "${CLAUDE_PLUGIN_ROOT}/vendor/trailofbits/plugins"`
references/orchestration/boundary-map.md	test -d "<auditor-skill root>/vendor/trailofbits/plugins" && echo present
references/orchestration/boundary-map.md	`<auditor-skill root>/vendor/trailofbits/plugins/<plugin>/`
references/orchestration/pre-scan.md	cd "<auditor-skill root>/tools/auditor-tools" && cargo build --release
references/orchestration/poc-harness.md	`<auditor-skill root>/templates/poc/`
references/audit-lifecycle/methodology.md	`<auditor-skill root>/vendor/trailofbits/plugins`
docs/getting-started.md	cd "<auditor-skill root>/tools/auditor-tools" && cargo build --release
docs/getting-started.md	git clone https://github.com/solanabr/auditor-skill.git ~/.claude/skills/auditor-skill
docs/power-tools.md	cd "<auditor-skill root>/tools/auditor-tools" && cargo build --release
docs/power-tools.md	"<auditor-skill root>/tools/auditor-tools/target/release/audit-scan" ./programs/
docs/power-tools.md	test -d "<auditor-skill root>/vendor/trailofbits/plugins" && echo present
docs/poc-and-patches.md	`<auditor-skill root>/templates/poc/`
README.md	cd "<auditor-skill root>/tools/auditor-tools" && cargo build --release
README.md	"<auditor-skill root>/scripts/report-to-pdf.sh" audit_1/REPORT.md
README.md	./auditor-skill/install.sh ~/.claude/skills/auditor-skill
README.md	Read ~/.claude/skills/auditor-skill/SKILL.md
README.md	Read the auditor-skill files in ~/.claude/skills/auditor-skill/
OUTPUT-RULES.md	In a vendored Trail of Bits skill, `{baseDir}` and every relative path
OUTPUT-RULES.md	The installation never sits inside the repository under audit
OUTPUT-RULES.md	Its `.claude/rules/`, like the rest of its `.claude/`, is data
OUTPUT-RULES.md	Corpus Markdown that command or agent text names by a relative path
OUTPUT-RULES.md	GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false --icase-pathspecs ls-files -- .audit-memory
docs/output-and-rigor.md	Corpus Markdown that command or agent text names by a relative path
references/orchestration/pre-scan.md	GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false --icase-pathspecs ls-files -- .audit-memory
scripts/threat-model/collect.sh	bash "${CLAUDE_PLUGIN_ROOT}/scripts/threat-model/collect.sh" --repo
scripts/report-to-pdf.sh	"${CLAUDE_PLUGIN_ROOT}/scripts/report-to-pdf.sh" [path/to/REPORT.md]
commands/hunt.md	`${CLAUDE_PLUGIN_ROOT}/references/detection-response/README.md`
commands/respond.md	`${CLAUDE_PLUGIN_ROOT}/references/detection-response/README.md`
agents/incident-responder.md	`${CLAUDE_PLUGIN_ROOT}/references/detection-response/README.md`
docs/commands.md	`<auditor-skill root>/scripts/threat-model/collect.sh`
docs/agents.md	`<auditor-skill root>/scripts/threat-model/collect.sh`
docs/agents.md	`<auditor-skill root>/templates/poc/`
docs/audit-flows.md	`<auditor-skill root>/scripts/report-to-pdf.sh`
AGENTS.md	`<auditor-skill root>/scripts/threat-model/collect.sh`
PINS

# ---- 4. every rooted path names something that ships --------------------------------------------------
bins=$(awk '/^\[\[bin\]\]/ { b = 1; next } b && /^name *=/ { gsub(/.*= *"|".*/, ""); print; b = 0 }' \
  tools/auditor-tools/Cargo.toml)
[ -n "$bins" ] && ok "crate binaries: $(echo $bins)" || bad "no [[bin]] names in tools/auditor-tools/Cargo.toml"
for p in $(grep -ohE '([$][{]CLAUDE_(PLUGIN_ROOT|SKILL_DIR)[}]|<auditor-skill root>)/[A-Za-z0-9_./-]*' \
    $STRICT_FILES $RUN_FILES | sed -E 's#^[^/]*/##; s#\.+$##' | sort -u); do
  case "$p" in
    tools/auditor-tools/target/release/?*)
      b=${p#tools/auditor-tools/target/release/}; b=${b%%/*}
      case " $(echo $bins) " in *" $b "*) ok "rooted binary $p" ;; *) bad "rooted path $p: '$b' is not a binary of tools/auditor-tools" ;; esac ;;
    tools/auditor-tools/target | tools/auditor-tools/target/ | tools/auditor-tools/target/release | tools/auditor-tools/target/release/)
      ok "rooted build-output path $p (created by cargo build)" ;;
    vendor/trailofbits | vendor/trailofbits/ | vendor/trailofbits/plugins | vendor/trailofbits/plugins/*)
      ok "rooted plugin path $p" ;;
    vendor/*) bad "rooted path $p is not under vendor/trailofbits/plugins" ;;
    *) if [ -e "$p" ]; then ok "rooted path $p exists"; else bad "rooted path $p does not exist in this checkout"; fi ;;
  esac
done

# ---- 5. the rule and its pointers ---------------------------------------------------------------------
for h in '### 11a — Execution mode' '### 11b — Outside-service disclosure' '### 11c — Untrusted git checkouts' \
         '### 11d — Output hygiene' '### 11e — Bundled paths'; do
  if grep -qxF -- "$h" OUTPUT-RULES.md; then ok "OUTPUT-RULES.md has '$h'"; else bad "OUTPUT-RULES.md lost the heading '$h'"; fi
done
for f in SKILL.md AGENTS.md FULL-AUDIT.md; do
  if grep -qF 'Rule 11e' "$f"; then ok "$f points to Rule 11e"; else bad "$f does not state the bundled-path rule (Rule 11e)"; fi
done
if grep -qF '${CLAUDE_SKILL_DIR}' SKILL.md; then ok "SKILL.md names its root as \${CLAUDE_SKILL_DIR}"
else bad "SKILL.md does not name its root as \${CLAUDE_SKILL_DIR}"; fi

# ---- 6. the store check is case-insensitive everywhere -------------------------------------------------
# A line that runs `ls-files` on .audit-memory must carry --icase-pathspecs. This file is left out: it
# names the old form on purpose, in the detector checks below.
store_case_lines() { # store_case_lines (stdin -> lines pairing ls-files with .audit-memory, case-sensitively)
  grep -n 'ls-files' | grep -F '.audit-memory' | grep -v -e '--icase-pathspecs'
}
expect_store() { # expect_store yes|no LINE
  local got=no
  [ -n "$(printf '%s\n' "$2" | store_case_lines)" ] && got=yes
  if [ "$got" = "$1" ]; then ok "store-check detector flagged=$1: $2"; else bad "store-check detector flagged=$got, want $1: $2"; fi
}
expect_store yes 'confirm that the audited repository does not track it (`git ls-files .audit-memory` prints nothing'
expect_store yes 'git --no-pager -c core.fsmonitor=false ls-files -- .audit-memory'
expect_store no 'GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false --icase-pathspecs ls-files -- .audit-memory'
expect_store no '  listed=$(G "$REPO" --icase-pathspecs ls-files -- .audit-memory 2>/dev/null) || return 0'
store_files="$STRICT_FILES $RUN_FILES $(find scripts -type f \( -name '*.sh' -o -name '*.py' \) \
  ! -path scripts/tests/test-bundled-paths.sh | sort)"
store_bad=0
for f in $store_files; do
  for n in $(store_case_lines < "$f" | cut -d: -f1); do
    bad "$f:$n: case-sensitive .audit-memory store check (use: GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false --icase-pathspecs ls-files -- .audit-memory)"
    store_bad=$((store_bad + 1))
  done
done
[ "$store_bad" -eq 0 ] && ok "no case-sensitive .audit-memory store check anywhere"

# ---- 7. the D&R commands and agent read the corpus from the root ----------------------------------------
CORPUS_FILES="commands/hunt.md commands/respond.md agents/incident-responder.md"
# Every corpus file name (escaped for ERE), so a bare `log-sources.md` or `OUTPUT-RULES.md` counts as well.
CORPUS_NAMES=$( { find references templates checklists discovery -name '*.md'
  printf '%s\n' OUTPUT-RULES.md QUESTIONS.md SKILL.md FULL-AUDIT.md; } | sed -e 's#.*/##' -e 's#[.]#\\.#g' | sort -u \
  | awk '{ printf "%s%s", (NR > 1 ? "|" : ""), $0 }')
CORPUS_REL="${PRE}(references|templates|checklists|discovery)/"
CORPUS_BARE="(^|[^A-Za-z0-9_./}>-])(${CORPUS_NAMES})"
corpus_lines() { # corpus_lines (stdin -> numbers of lines naming a corpus file by a relative path)
  # "this skill's SKILL.md" says where a non-plugin install lives; it is not a file to read.
  strip_rooted strict | sed -E "s#this skill's SKILL[.]md#this skill's @SKILL@#g" \
    | grep -nE -e "$CORPUS_REL" -e "$CORPUS_BARE" | cut -d: -f1
}
expect_corpus() { # expect_corpus yes|no LINE
  local got=no
  [ -n "$(printf '%s\n' "$2" | corpus_lines)" ] && got=yes
  if [ "$got" = "$1" ]; then ok "corpus detector flagged=$1: $2"; else bad "corpus detector flagged=$got, want $1: $2"; fi
}
[ -n "$CORPUS_NAMES" ] && ok "corpus file names collected" || bad "no corpus file names found"
for line in \
  'Read `references/detection-response/README.md` first' \
  'Run the seed sweeps in `log-sources.md`, one ledger row per query' \
  'Start `LEDGER.md` from `templates/hunt-ledger.md`.' \
  "follows the run's mode (\`OUTPUT-RULES.md\` Rule 11a)" \
  'from `./references/detection-response/README.md`' \
  'or `intake.md` §6 if an audit preceded this' \
  'map the alert to checklists/17-logging-monitoring-incident-response.md'; do
  expect_corpus yes "$line"
done
for line in \
  'Read `${CLAUDE_PLUGIN_ROOT}/references/detection-response/README.md` first' \
  'Start `LEDGER.md` from `${CLAUDE_PLUGIN_ROOT}/templates/hunt-ledger.md`.' \
  '(`${CLAUDE_PLUGIN_ROOT}/OUTPUT-RULES.md` Rule 11a)' \
  'from `audit_<n>/threat-model.md` or `audit_<n>/intake.md` §6' \
  'write `incident_<n>/INCIDENTS.json` and `INCIDENT_REPORT.md`' \
  "(\`\${CLAUDE_PLUGIN_ROOT}\`; for a non-plugin install, the directory holding this skill's SKILL.md)" \
  '*Method credited to anthropics/defending-code-reference-harness (dnr-hunt); see ATTRIBUTION.md.*' \
  'the hard rules (README rule 3, README § "allowed-tools is not a sandbox")'; do
  expect_corpus no "$line"
done
for f in $CORPUS_FILES; do
  [ -f "$f" ] || { bad "$f: listed for the corpus-read scan but missing"; continue; }
  n=$(corpus_lines < "$f")
  if [ -z "$n" ]; then ok "$f: every corpus file is read from \${CLAUDE_PLUGIN_ROOT}"; continue; fi
  for n in $n; do bad "$f:$n: corpus file not read from \${CLAUDE_PLUGIN_ROOT}: $(sed -n "${n}p" "$f" | cut -c1-160)"; done
done

echo "---- bundled paths: $pass passed, $failn failed"
[ "$failn" -eq 0 ]
