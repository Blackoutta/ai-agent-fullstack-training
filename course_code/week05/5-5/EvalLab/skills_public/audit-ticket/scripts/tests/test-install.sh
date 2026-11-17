#!/usr/bin/env bash
# test-install.sh — install.sh:
#   - a run without a path never replaces an existing copy and runs no git;
#   - a run with a path installs a fresh clone and, over an earlier install, moves that copy aside without
#     running git in it, so nothing in its repo config (filters, hooks, transport commands) runs;
#   - a path that is a symbolic link, or that holds something other than an install, is refused;
#   - a warning goes to stderr when the install directory is inside a git work tree.
# Run from the repo root: `bash scripts/tests/test-install.sh`.
# Offline: a temp global config maps the canonical URL to local bare upstreams, and GIT_ALLOW_PROTOCOL=file
# refuses every other transport. Builds throwaway repos under ${TMPDIR:-/tmp}; bash >= 3.2.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_NAMESPACE GIT_TRACE
T=$(mktemp -d "${TMPDIR:-/tmp}/install-test.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT
export GIT_CEILING_DIRECTORIES="$T" GIT_ALLOW_PROTOCOL=file
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid \
  GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
pass=0; failn=0

# Fixture upstreams: up.git (a SKILL.md like ours), up2.git (also a vendor/trailofbits submodule).
mkup() { # mkup NAME [submodule]
  git init -q --bare "$T/$1.git" && git -C "$T/$1.git" symbolic-ref HEAD refs/heads/main \
    && git clone -q "$T/$1.git" "$T/$1.seed" 2>/dev/null && git -C "$T/$1.seed" checkout -q -b main \
    && printf -- '---\nname: auditor-skill\n---\n' > "$T/$1.seed/SKILL.md" && git -C "$T/$1.seed" add SKILL.md || return 1
  if [ -n "${2:-}" ]; then git -C "$T/$1.seed" submodule add -q "file://$T/tob" vendor/trailofbits || return 1; fi
  git -C "$T/$1.seed" commit -q -m base && git -C "$T/$1.seed" push -q origin main
}
advance() { # advance NAME FILE: a new upstream commit whose subject is FILE
  echo "$2" > "$T/$1.seed/$2" && git -C "$T/$1.seed" add "$2" && git -C "$T/$1.seed" commit -q -m "$2" \
    && git -C "$T/$1.seed" push -q origin main
}
git init -q "$T/tob" && echo p > "$T/tob/p" && git -C "$T/tob" add p && git -C "$T/tob" commit -q -m p \
  && mkup up && mkup up2 submodule || { echo "could not build the fixture upstreams" >&2; exit 1; }
for u in up up2; do # the user's global config for a run: the canonical URL comes from the local upstream
  printf '[url "file://%s/%s.git"]\n\tinsteadOf = https://github.com/solanabr/auditor-skill.git\n' "$T" "$u" > "$T/$u.gitconfig"
done
printf '#!/bin/sh\ntouch "%s/fired-$1"\nexit 0\n' "$T" > "$T/canary.sh" && chmod +x "$T/canary.sh"
printf '#!/bin/sh\ntouch "%s/fired-gitproxy"\nexit 1\n' "$T" > "$T/gitproxy.sh" && chmod +x "$T/gitproxy.sh"   # run without a shell

run() { # run UPSTREAM DIR ARGS...  (install.sh in DIR; sets rc, $T/out, $T/err)
  local u=$1 d=$2; shift 2
  ( cd "$d" && GIT_CONFIG_GLOBAL="$T/$u.gitconfig" bash "$ROOT/install.sh" "$@" ) > "$T/out" 2> "$T/err"; rc=$?
}
check() { # check NAME TEST...
  local name=$1; shift
  if "$@"; then pass=$((pass + 1)); echo "PASS $name"
  else failn=$((failn + 1)); echo "FAIL $name (rc=$rc)"; sed 's/^/  | /' "$T/err"; fi
}
head_is() { [ "$(git -C "$1" log -1 --format=%s)" = "$2" ]; }
warned() { grep -q 'is inside the git work tree' "$T/err"; }
none_fired() { [ -z "$(ls "$T" | grep '^fired-')" ]; }
installed() { [ "$rc" -eq 0 ] && grep -q 'auditor-skill installed' "$T/out" && [ -f "$1/SKILL.md" ]; }

# 1. explicit path inside a work tree: warns, then installs
git init -q "$T/audited"
run up "$T" "$T/audited/.claude/skills/auditor-skill"
ok1() { installed "$T/audited/.claude/skills/auditor-skill" && warned && head_is "$T/audited/.claude/skills/auditor-skill" base; }
check "explicit path inside a work tree warns and installs" ok1

# 2. explicit path outside any work tree: no warning; the submodule arrives too
mkdir -p "$T/outside"
run up2 "$T" "$T/outside/auditor-skill"
ok2() { installed "$T/outside/auditor-skill" && ! warned && [ -f "$T/outside/auditor-skill/vendor/trailofbits/p" ]; }
check "explicit path outside any work tree is quiet and installs the submodule" ok2

# 3. a run without a path over an existing copy whose repo config sets fsmonitor and a hook stops before any git
#    command
git init -q "$T/archive" && d3="$T/archive/.claude/skills/auditor-skill" && git clone -q "$T/up.git" "$d3" \
  && git -C "$d3" config core.fsmonitor "$T/canary.sh fsmonitor" \
  && printf '#!/bin/sh\ntouch "%s/fired-hook"\n' "$T" > "$d3/.git/hooks/post-merge" && chmod +x "$d3/.git/hooks/post-merge"
before=$(git -C "$d3" rev-parse HEAD)
GIT_TRACE="$T/trace3" run up "$T/archive"
ok3() { [ "$rc" -eq 2 ] && grep -q 'Pass the install path explicitly' "$T/err" && [ ! -s "$T/trace3" ] && none_fired \
  && [ "$(git -C "$d3" rev-parse HEAD)" = "$before" ]; }
check "a run without a path refuses an existing copy and runs no git" ok3

# 4. a run without a path and no existing copy: warns inside a work tree, then installs
git init -q "$T/audited2"
run up "$T/audited2"
ok4() { installed "$T/audited2/.claude/skills/auditor-skill" && warned; }
check "a run without a path warns inside a work tree and installs" ok4

# 5. re-running over an earlier install whose repo config names filters, transport commands and hooks: a fresh
#    clone replaces it, the old copy is moved aside untouched, and nothing from its config runs. Its origin
#    stays the local upstream, so any git run in the copy would fetch, check out and set off the canaries.
d5="$T/again/auditor-skill"
mkdir -p "$T/again" && git clone -q "$T/up.git" "$d5" && echo old > "$d5/old-marker" \
  && printf '* filter=sm\nSKILL.md filter=pr\n' > "$d5/.git/info/attributes" \
  && git -C "$d5" config filter.sm.smudge "$T/canary.sh smudge" \
  && git -C "$d5" config filter.pr.process "$T/canary.sh process" \
  && git -C "$d5" config core.sshCommand "$T/canary.sh ssh" \
  && git -C "$d5" config core.gitProxy "$T/gitproxy.sh" \
  && git -C "$d5" config core.alternateRefsCommand "$T/canary.sh altrefs" \
  && echo "$T/up.git/objects" > "$d5/.git/objects/info/alternates" \
  && git -C "$d5" config core.fsmonitor "$T/canary.sh fsmonitor" \
  && git -C "$d5" config core.worktree "$T/elsewhere" \
  && git -C "$d5" config submodule.vendor/trailofbits.update "!$T/canary.sh subupdate" \
  && for h in post-merge post-checkout post-rewrite reference-transaction; do
       printf '#!/bin/sh\ntouch "%s/fired-hook"\n' "$T" > "$d5/.git/hooks/$h" && chmod +x "$d5/.git/hooks/$h"; done \
  && advance up six
run up "$T/again" "$d5"
ok5() { installed "$d5" && none_fired && head_is "$d5" six && [ ! -e "$d5/old-marker" ] && [ ! -e "$T/elsewhere" ] \
  && [ "$(ls -d "$d5".old-* 2>/dev/null | wc -l | tr -d ' ')" = 1 ] && [ -f "$(ls -d "$d5".old-*)/old-marker" ]; }
check "re-running replaces an earlier install with a fresh clone and runs nothing from its config" ok5

# 6. a path that holds something other than an install is left alone
mkdir -p "$T/notours/auditor-skill" && echo mine > "$T/notours/auditor-skill/notes.txt"
run up "$T/notours" "$T/notours/auditor-skill"
ok6() { [ "$rc" -eq 2 ] && grep -q 'is not an auditor-skill install' "$T/err" && [ -f "$T/notours/auditor-skill/notes.txt" ] \
  && [ -z "$(ls -d "$T/notours/auditor-skill".old-* 2>/dev/null)" ] && [ ! -e "$T/notours/auditor-skill/SKILL.md" ]; }
check "a path that is not an install is refused and left alone" ok6

# 7. a path that is a symbolic link is refused
mkdir -p "$T/linked" && git clone -q "$T/up.git" "$T/linked/real" && ln -s "$T/linked/real" "$T/linked/auditor-skill"
run up "$T/linked" "$T/linked/auditor-skill"
ok7() { [ "$rc" -eq 2 ] && [ -L "$T/linked/auditor-skill" ] && head_is "$T/linked/real" "$(git -C "$T/up.seed" log -1 --format=%s)"; }
check "a path that is a symbolic link is refused" ok7

# 8. an empty directory at the path is installed into
mkdir -p "$T/empty/auditor-skill"
run up "$T/empty" "$T/empty/auditor-skill"
ok8() { installed "$T/empty/auditor-skill" && [ -z "$(ls -d "$T/empty/auditor-skill".old-* 2>/dev/null)" ]; }
check "an empty directory at the path is installed into" ok8

echo "---- $pass passed, $failn failed"
[ "$failn" -eq 0 ]
