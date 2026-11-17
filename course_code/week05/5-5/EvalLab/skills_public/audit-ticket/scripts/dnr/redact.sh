#!/usr/bin/env bash
# redact.sh — a filter that strips provider credentials from text before it reaches
# the transcript, a ledger, or a report.
#
# Why this exists: a read-only RPC call can still leak its key. The solana CLI echoes
# the full URL (key included) in its own error text, and providers put the key in
# the query (`?api-key=`), in a path segment (`/v2/<key>`, `/solana/<key>`), in
# userinfo (`user:key@host`), or in a subdomain (`<token>.provider.example`).
#
# Usage: capture the output to a file first, then filter it. Process substitution
# (`2> >(...)`) is not used anywhere in this track: it needs /dev/fd, which some
# sandboxes deny.
#
#     err="$(mktemp "${TMPDIR:-/tmp}/dnr_err.XXXXXX")"; some-cmd 2>"$err"; s=$?; bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/redact.sh" <"$err" >&2; rm -f "$err"; (exit $s)
#     set -o pipefail; some-cmd 2>&1 | bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/redact.sh"
#
# Both keep some-cmd's exit status, in bash and in zsh: the first saves it before
# filtering, and `set -o pipefail` at the start of the second line makes the
# pipeline fail when some-cmd does — without it, the filter's own 0 is the status.
# Give mktemp a template: without one, macOS ignores $TMPDIR.
#
# Always the installation's copy, never a relative scripts/ path: the audited repo
# may ship a same-named file.
#
# What it does to a URL, whatever its scheme (https, HTTPS, wss, ...): keeps the
# scheme, replaces userinfo with REDACTED@, keeps only the host's last two DNS labels
# (`REDACTED.provider.example`; an IP address or a two-label host is kept whole), and
# replaces everything after the host (path and query) with /REDACTED. A trailing ')'
# or quote that merely ends the URL in prose is kept. A bare `api-key=VALUE` (or
# token / secret / auth, in any letter case) outside a URL is also redacted.
#
# curl's own lines name the endpoint without a scheme, so on `curl: (N) …` errors and
# on verbose `* `, `> `, `< ` lines every host keeps its last two labels too, and a
# request line (`> POST /v2/<key> HTTP/2`) or an HTTP/2 `[:path: …]` header loses
# its path.
#
# It is a convenience, not a guarantee (a novel key format can slip through), so the
# rule still holds: never put an RPC URL in INCIDENTS.json, LEDGER.md, or any
# output. Record the provider domain (the host's last two labels) and the literal
# string "$RPC_URL".
#
# Portability: POSIX ERE via `sed -E` only — bracket classes, `?`/`+`/`*`, groups and
# `\1` backreferences, the `g` flag. No GNU-only extensions and no case-insensitive
# flag (letter case is spelled out in bracket classes instead), so BSD and GNU sed
# read these expressions the same way. bash >= 3.2.

set -uo pipefail

q="'"
# Characters that end a URL or a key in surrounding text: whitespace, quotes,
# backtick, closing paren.
end="[:space:]\"${q}\`)"

# Any URL scheme (RFC 3986: a letter, then letters, digits, + . -).
scheme='[A-Za-z][A-Za-z0-9+.-]*://'
# api-key / apikey / api_key, access-token, token, secret, auth — any letter case.
key='[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]|[Aa][Cc][Cc][Ee][Ss][Ss][-_]?[Tt][Oo][Kk][Ee][Nn]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Aa][Uu][Tt][Hh]'

# A DNS name of three or more labels whose last label starts with a letter (so an
# IPv4 address never matches): \1 is what precedes it, \3 its last two labels.
host='(^|[^A-Za-z0-9_.-])([A-Za-z0-9_-]+\.)+([A-Za-z0-9_-]+\.[A-Za-z][A-Za-z0-9_-]*)'

sed -E \
  -e "s#(${scheme})[^@/?${end}]*@#\\1REDACTED@#g" \
  -e "s#(${scheme}[^/?${end}]+)[/?][^${end}]*#\\1/REDACTED#g" \
  -e "s#(${scheme}(REDACTED@)?)[^/?@${end}]*\.([^./?@${end}]+\.[A-Za-z][^./?@${end}]*)#\\1REDACTED.\\3#g" \
  -e "s#^(> [A-Z]+ )[^ ]+( HTTP/[0-9.]+)#\\1/REDACTED\\2#" \
  -e "s#(\\[:path: )[^]]*#\\1/REDACTED#g" \
  -e "/^(curl: |[*<>] )/s#${host}#\\1REDACTED.\\3#g" \
  -e "s/((${key})=)[^&${end}]+/\\1REDACTED/g"
