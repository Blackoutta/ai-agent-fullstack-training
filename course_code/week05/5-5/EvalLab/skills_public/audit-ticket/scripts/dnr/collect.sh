#!/usr/bin/env bash
# collect.sh — the ONE gated collector for the detection & response track. Pages
# signature history for one or more addresses and fetches each transaction, into a
# local JSONL corpus. Besides snapshot-program.sh (one program account, via the
# solana CLI), it is the only recipe in the track that touches the network.
#
#   bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/collect.sh" --out <dir> --confirmed \
#        [--since <unix>] [--until <unix>] [--before <signature>] \
#        [--max-pages N] [--max-tx N] -- <address> [<address> ...]
#
# $RPC_URL must already be exported; never type the URL on the command line. Run it
# from the installation, never as a relative scripts/ path: the audited repo may
# ship a same-named file.
#
# GATING (do not relax — this is how "plans only, no actions" stays true for the
# corpus collection):
#   * REFUSES unless --confirmed is passed. `/auditor:hunt` and `/auditor:respond`
#     pass it only AFTER showing the human the addresses, the window, the caps and
#     the estimated call count, and getting a yes. Without it the script exits 2
#     before any network call.
#   * READ-ONLY RPC only: getSignaturesForAddress and getTransaction. Never a send,
#     a simulate, or a write method.
#   * CAPPED: --max-pages (default 20 → up to 20000 signatures per address) and
#     --max-tx (default 2000) bound the work and the spend. Raise them deliberately.
#     --max-tx counts getTransaction calls, failed ones included, so a run makes at
#     most addresses × max-pages + max-tx calls.
#   * STOPS ON A FAILING ENDPOINT: after 10 getTransaction calls in a row fail
#     (rate limit, outage, or history the endpoint does not serve), it fetches
#     nothing more and records the stop as a collection gap.
#
# WHAT IS KEPT: every signature in the window, FAILED ones included. A failed
# transaction moves no state, but it is evidence of an attempt — probing before a
# success, or a `suspected` incident whose attack has not landed yet. Filtering
# failures out would make those undetectable. Use `meta.err` downstream.
#
# RUN DIRECTORY: --out, and the nearest incident_* directory at or above it, must be
# a directory this run may write into. Either one that is a symbolic link, holds a
# symbolic link, is tracked by git, or that git or find cannot check is refused with
# exit 2 before anything is written or sent.
#
# --before <sig> starts paging just older than that signature (resume a capped run,
# or skip activity newer than the incident) — always into a new --out: an --out that
# already holds signatures.jsonl, transactions.jsonl or collection-gaps.tsv, even an
# empty one, is refused, and the script creates its files with noclobber (`set -C`),
# so a resume never erases the first pass. Every address and --before value must be
# base58, and every number a plain integer, before anything is written or sent.
#
# PAGING: an empty page is the end of the address's history, and so is a page that
# crosses --since. A page shorter than the 1000 signatures asked for is not, except
# on the last page --max-pages allows: a node can return a short page before the end
# (for example when its archive backend fails), so paging goes on. That costs one
# more call when the history did end there, never more calls than --max-pages. When
# the page cap stops paging on a full page before --since was crossed, whatever
# --since and --until are, the script says so ("older history may exist") with the
# --before to resume from: the corpus may then be incomplete for that address, a
# collection gap to record in the ledger. Signatures are fetched newest first (by
# slot, across all addresses; within a slot, in the order the RPC returned them), so
# --max-tx drops the oldest. The script runs under LC_ALL=C, so neither that order
# nor any character range depends on the caller's locale.
#
# COLLECTION GAPS: every gap is also a row of <dir>/collection-gaps.tsv,
# `<signature or address><TAB><reason>`: a getTransaction that failed (transport
# error, RPC error or null result), a signature page that failed, a page cap that
# stopped on a full page (older history may exist), the --max-tx cap, and the stop
# on a failing endpoint (the last two name the first signature not fetched). The
# run ends with "collection gaps: N (see <dir>/collection-gaps.tsv)". Gaps leave the
# exit status at 0; copy each row into LEDGER.md and INCIDENTS.json
# `collection_gaps`.
#
# SECRETS: the endpoint comes from $RPC_URL and is NEVER echoed. curl runs with -q
# (no ~/.curlrc) and reads the URL from a config on stdin (-K -), so the key stays
# out of its argv; an $RPC_URL holding a quote, a backslash, whitespace or a control
# character is refused. curl's stderr is captured to a temp file and passed through
# redact.sh. Output files carry no URL, and the "provider" line carries the host's
# last two DNS labels only, since some providers put an endpoint token in a
# subdomain.
#
# Transactions are fetched jsonParsed, commitment finalized, with
# maxSupportedTransactionVersion:1 — mandatory, since v1 transactions are live on
# mainnet and a v1 fetch without the opt-in returns RPC error -32015.
#
# EXACT INTEGERS: lamport balances and jsonParsed amounts pass 2^53, and jq < 1.7
# re-encodes every number as a double. jq writes transactions.jsonl only when it
# keeps a 2^64-1 literal exact; otherwise `python3 -I` does (its json module keeps
# integers exact), one compact JSON object per line either way. Signature pages
# carry only slots, block times and small error codes, and jq writes them.
#
# Exit: 0 done (collection gaps included) · 2 usage, a refused input, $RPC_URL, run
# directory or --out · 3 named blocker (no curl or jq; a jq that rounds large
# integers and no working python3).
# bash >= 3.2, curl, jq (and python3 with jq < 1.7). Output: <dir>/signatures.jsonl,
# <dir>/transactions.jsonl, <dir>/collection-gaps.tsv.

# -C (noclobber): no redirection in this script replaces an existing file.
set -Cuo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REDACT="$HERE/redact.sh"

out=""; confirmed=0; since=0; until=0; before_start=""; max_pages=20; max_tx=2000
addrs=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --confirmed) confirmed=1; shift ;;
    --since) since="$2"; shift 2 ;;
    --until) until="$2"; shift 2 ;;
    --before) before_start="$2"; shift 2 ;;
    --max-pages) max_pages="$2"; shift 2 ;;
    --max-tx) max_tx="$2"; shift 2 ;;
    --) shift; addrs=("$@"); break ;;
    *) echo "collect.sh: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

if [ "$confirmed" -ne 1 ]; then
  echo "collect.sh: refusing — pass --confirmed (the command confirms addresses, window and caps with the human first)." >&2
  exit 2
fi
if [ -z "$out" ] || [ ${#addrs[@]} -eq 0 ]; then
  echo "usage: collect.sh --out <dir> --confirmed [--since U] [--until U] [--before SIG] [--max-pages N] [--max-tx N] -- <address>..." >&2
  exit 2
fi
if [ -z "${RPC_URL:-}" ]; then
  echo "collect.sh: set \$RPC_URL in the environment (never on the command line, so it stays out of history and ledgers)." >&2
  exit 2
fi
# The URL goes into a quoted curl config line: refuse what could end or escape it.
case "$RPC_URL" in
  *[[:space:][:cntrl:]\"\\]*)
    echo "collect.sh: \$RPC_URL holds a quote, a backslash, whitespace or a control character; refusing it." >&2
    exit 2 ;;
esac
# Addresses and --before are spliced into JSON request bodies and usually come from
# target content (declare_id!, Anchor.toml): accept base58 only.
for addr in "${addrs[@]}"; do
  if ! [[ "$addr" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
    echo "collect.sh: '$addr' is not a base58 address (32-44 characters of [1-9A-HJ-NP-Za-km-z])." >&2
    exit 2
  fi
done
if [ -n "$before_start" ] && ! [[ "$before_start" =~ ^[1-9A-HJ-NP-Za-km-z]{32,88}$ ]]; then
  echo "collect.sh: --before '$before_start' is not a base58 signature." >&2
  exit 2
fi
for n in "$since" "$until" "$max_pages" "$max_tx"; do
  if ! [[ "$n" =~ ^[0-9]+$ ]]; then
    echo "collect.sh: '$n' is not a non-negative integer (--since, --until, --max-pages, --max-tx)." >&2
    exit 2
  fi
done
case "$out" in */) out="${out%"${out##*[!/]}"}"; [ -n "$out" ] || out=/ ;; esac

# refuse_planted <dir>: exit 2 unless <dir> is safe to write into — not a symbolic
# link, holding none, and not tracked by git. The git calls carry the Rule 11c flags,
# because the tree is usually the audited one. Outside a work tree nothing is tracked;
# inside one, a path git cannot classify is refused, and so is a directory find
# cannot read: a check that cannot run never counts as a pass.
refuse_planted() {
  local listed top
  if [ -L "$1" ]; then
    echo "${0##*/}: refusing $1: it is a symbolic link — use a new run directory." >&2; exit 2
  fi
  if [ -d "$1" ] && { listed="$(find "$1" -type l -print -quit 2>/dev/null)"; [ $? -ne 0 ] || [ -n "$listed" ]; }; then
    echo "${0##*/}: refusing $1: it contains a symbolic link, or a directory find cannot read — use a new run directory." >&2; exit 2
  fi
  [ -d "$(dirname "$1")" ] || return 0
  # A .git at or above the directory means git must answer; with none, nothing is tracked.
  if ! top="$(cd "$(dirname "$1")" && pwd -P)"; then
    echo "${0##*/}: refusing $1: its parent directory cannot be resolved." >&2; exit 2
  fi
  while [ ! -e "$top/.git" ]; do [ "$top" = / ] && return 0; top="$(dirname "$top")"; done
  if ! listed="$(GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false -C "$(dirname "$1")" --icase-pathspecs \
        ls-files -- ":(literal,icase)$(basename "$1")" 2>/dev/null)"; then
    echo "${0##*/}: refusing $1: it is inside a git work tree and git cannot tell whether it is tracked (git missing, or it does not trust this repository)." >&2; exit 2
  fi
  if [ -n "$listed" ]; then
    echo "${0##*/}: refusing $1: git tracks it, so it is not a run directory to write into." >&2; exit 2
  fi
  return 0
}
# --out, and the nearest incident_* directory above it, checked as a whole.
refuse_planted "$out"
run_dir="$out"
while :; do
  case "$(basename "$run_dir")" in incident_*) [ "$run_dir" = "$out" ] || refuse_planted "$run_dir"; break ;; esac
  case "$run_dir" in .|/) break ;; esac
  run_dir="$(dirname "$run_dir")"
done
# A second pass into the same --out would mix into, or truncate, the first one's corpus.
for f in signatures.jsonl transactions.jsonl collection-gaps.tsv; do
  if [ -e "$out/$f" ] || [ -L "$out/$f" ]; then
    echo "collect.sh: $out already holds a collected corpus ($f) — use a new --out (resume there with --before)." >&2
    exit 2
  fi
done

for tool in curl jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[blocker] $tool is not on PATH; collect.sh needs curl and jq." >&2
    exit 3
  fi
done
# result_line: the JSON-RPC response on stdin -> its .result object as one compact
# line, every integer exact (EXACT INTEGERS above).
probe='{"result":{"n":[18446744073709551615,-9007199254740993]}}'
want='{"n":[18446744073709551615,-9007199254740993]}'
if [ "$(printf '%s' "$probe" | jq -c '.result' 2>/dev/null)" = "$want" ]; then
  result_line() { jq -c '.result'; }
else
  result_line() {
    python3 -I -c 'import json, sys
r = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))["result"]
if not isinstance(r, dict):
    sys.exit(1)
out = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
sys.stdout.buffer.write(out.encode("utf-8", "backslashreplace") + b"\n")' 2>/dev/null
  }
  if [ "$(printf '%s' "$probe" | result_line)" != "$want" ]; then
    echo "[blocker] this jq rounds integers above 2^53 (jq < 1.7) and python3 -I is not available to write the corpus instead; install jq >= 1.7 or python3." >&2
    exit 3
  fi
fi

mkdir -p "$out" || exit 2
# Rule 11d: an incident_<n>/ directory (the --out itself or its parent) ignores itself
# when it has no .gitignore of its own, so the corpus never shows in git status.
for d in "$out" "$(dirname "$out")"; do
  case "$(basename "$d")" in
    incident_*) [ -e "$d/.gitignore" ] || printf '*\n' > "$d/.gitignore" ;;
  esac
done
# mktemp -d creates the directory with mode 0700; curl's stderr and the fetch list live there.
tmp="$(mktemp -d "${TMPDIR:-/tmp}/dnr_collect.XXXXXX")" || {
  echo "[blocker] cannot create a private temp directory." >&2; exit 3; }
trap 'rm -rf "$tmp"' EXIT
errf="$tmp/stderr"; todo="$tmp/signatures.todo"
sig_file="$out/signatures.jsonl"; tx_file="$out/transactions.jsonl"; gaps="$out/collection-gaps.tsv"
if ! { : > "$sig_file" && : > "$tx_file" && : > "$gaps"; } 2>/dev/null; then
  echo "collect.sh: $out already holds a collected corpus — use a new --out (resume there with --before)." >&2
  exit 2
fi
ngaps=0

# Provider domain, for disclosure under OUTPUT-RULES.md Rule 11b: strip the scheme,
# any userinfo, path, query and fragment, then keep the host's last two DNS labels (an
# IP address, or a host of one or two labels, is kept whole).
provider="$(printf '%s' "$RPC_URL" | sed -E -e 's|^[A-Za-z][A-Za-z0-9+.-]*://||' -e 's|^[^/?#]*@||' \
  -e 's|[/?#].*$||' -e 's|^.*\.([^.]+\.[A-Za-z][^.:]*)\.?(:[0-9]*)?$|\1\2|')"
echo "provider: $provider   (Rule 11b: this provider received the queried addresses)"
echo "addresses: ${#addrs[@]}   window: since=$since until=$until before=${before_start:-<newest>}   caps: max_pages=$max_pages max_tx=$max_tx"

rpc() {  # rpc <method> <params-json> -> the whole JSON response on stdout; returns curl's status
  local rc
  rm -f "$errf"
  # -q comes first so no ~/.curlrc is read; the URL arrives on stdin, the body (no
  # secret in it) as --data-raw.
  printf 'url = "%s"\n' "$RPC_URL" | curl -q -K - -sS -m 60 -A auditor-skill-research -X POST \
    -H 'Content-Type: application/json' \
    --data-raw "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" 2>"$errf"
  rc=$?
  if [ -s "$errf" ]; then "$REDACT" <"$errf" >&2; fi
  return "$rc"
}
failure() {  # failure <curl status> <response> -> why the call returned no usable result
  local kind code
  if [ "$1" -ne 0 ]; then echo "transport error (curl exit $1)"; return; fi
  kind="$(printf '%s' "$2" | jq -r 'if type != "object" then "unreadable"
    elif has("error") then "error \(.error.code? // "")" elif .result == null then "null"
    else "unreadable" end' 2>/dev/null)"
  case "$kind" in
    error*) code="${kind#error}"; code="${code//[!0-9-]/}"; echo "RPC error${code:+ $code}" ;;
    null) echo "null result" ;;
    *) echo "unreadable response" ;;
  esac
}
gap() {  # gap <signature or address> <reason>: one row per thing the corpus lacks
  printf '%s\t%s\n' "$1" "$(printf '%s' "$2" | tr '\t\r\n' '   ')" >> "$gaps"
  ngaps=$((ngaps + 1))
}

# 1. signature history, newest -> oldest, bounded by --since and --max-pages. An
#    empty page ends the address's history. A page shorter than the 1000 asked for
#    ends it only on the cap's last page: a node can return a short page before the
#    end, so paging goes on. A cap that stops paging on a full page, before --since
#    was crossed, may have left older history out.
collected=0
for addr in "${addrs[@]}"; do
  before="$before_start"; page=0; oldest=0; ended=0
  while [ "$page" -lt "$max_pages" ]; do
    cfg="{\"limit\":1000,\"commitment\":\"finalized\"${before:+,\"before\":\"$before\"}}"
    resp="$(rpc getSignaturesForAddress "[\"$addr\",$cfg]")"; rc=$?
    if [ "$rc" -ne 0 ] || ! printf '%s' "$resp" | jq -e '.result | arrays' >/dev/null 2>&1; then
      reason="$(failure "$rc" "$resp")"
      echo "  ! paging $addr (page $page) failed: $reason — recorded as a collection gap" >&2
      gap "$addr" "getSignaturesForAddress page $page: $reason; older history not collected"
      ended=1; break
    fi
    n="$(printf '%s' "$resp" | jq '.result | length')"
    page=$((page + 1))
    if [ "$n" -gt 0 ]; then
      printf '%s' "$resp" | jq -c --arg a "$addr" '.result[] | . + {queried_address:$a}' >> "$sig_file"
      before="$(printf '%s' "$resp" | jq -r '.result[-1].signature')"
      oldest="$(printf '%s' "$resp" | jq -r '.result[-1].blockTime // 0')"
      collected=$((collected + n))
    fi
    if [ "$n" -eq 0 ]; then ended=1; break; fi
    if [ "$since" -gt 0 ] && [ "$oldest" -gt 0 ] && [ "$oldest" -lt "$since" ]; then ended=1; break; fi
    if [ "$n" -lt 1000 ] && [ "$page" -ge "$max_pages" ]; then ended=1; break; fi
  done
  if [ "$ended" -eq 0 ]; then
    if [ "$page" -eq 0 ]; then
      stop="--max-pages 0 fetched no page"
    else
      stop="the page cap (--max-pages $max_pages) stopped on a full page at blockTime $oldest"
      if [ "$since" -gt 0 ]; then
        stop="$stop, still after --since $since"
      elif [ "$until" -gt 0 ] && [ "$oldest" -gt "$until" ]; then
        stop="$stop, still after --until $until, so nothing inside the window was collected"
      fi
    fi
    resume="${before:+resume into a new --out with --before $before, or }raise --max-pages"
    echo "  ! older history may exist for $addr: $stop — $resume; recorded as a collection gap" >&2
    gap "$addr" "older history may exist: $stop; $resume"
  fi
done
echo "signatures collected: $collected -> $sig_file"

# 2. unique signatures within [since, until] — failed ones included — newest first
#    across every address (slot, descending), so a --max-tx cap keeps the most recent
#    activity; a signature seen under two addresses is kept once, at its first place.
#    The sort is stable: within a slot the RPC's own newest-first order stands.
#    Read from a file (not a pipe) so the counter survives the loop.
jq -r --argjson s "$since" --argjson u "$until" '
  select(($s == 0) or ((.blockTime // 0) >= $s))
  | select(($u == 0) or ((.blockTime // 0) <= $u))
  | "\(.slot // 0) \(.signature)"' "$sig_file" | sort -s -k1,1nr | awk '!seen[$2]++ { print $2 }' > "$todo"

# 3. fetch. Every getTransaction call counts against --max-tx, and max_failed calls
#    failing in a row stop the run: the endpoint is failing, and the rest would too.
max_failed=10
fetched=0; calls=0; failed=0; total="$(grep -c . "$todo")"; i=0
while IFS= read -r sig; do
  [ -z "$sig" ] && continue
  i=$((i + 1))
  if [ "$failed" -ge "$max_failed" ]; then
    gap "$sig" "not fetched: stopped after $max_failed getTransaction calls in a row failed (last: $reason); this and $((total - i)) older signatures in signatures.jsonl were not fetched"
    echo "  ! stopped: $max_failed getTransaction calls in a row failed (last: $reason) — the endpoint is failing (rate limit or outage, or it does not serve this history); collected $fetched, collection gaps $ngaps; $((total - i + 1)) signatures not fetched — recorded as a collection gap" >&2
    break
  fi
  if [ "$calls" -ge "$max_tx" ]; then
    echo "  ! reached --max-tx=$max_tx getTransaction calls; $((total - i + 1)) signatures not fetched — recorded as a collection gap" >&2
    gap "$sig" "not fetched: --max-tx=$max_tx calls reached; this and $((total - i)) older signatures in signatures.jsonl were not fetched"
    break
  fi
  calls=$((calls + 1))
  resp="$(rpc getTransaction "[\"$sig\",{\"encoding\":\"jsonParsed\",\"maxSupportedTransactionVersion\":1,\"commitment\":\"finalized\"}]")"; rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$resp" | jq -e '.result | objects' >/dev/null 2>&1 \
     && line="$(printf '%s' "$resp" | result_line)" && [ -n "$line" ]; then
    printf '%s\n' "$line" >> "$tx_file"
    fetched=$((fetched + 1)); failed=0
  else
    reason="$(failure "$rc" "$resp")"
    echo "  ! getTransaction failed for a signature: $reason — recorded as a collection gap" >&2
    gap "$sig" "getTransaction: $reason"
    failed=$((failed + 1))
  fi
done < "$todo"
echo "transactions fetched: $fetched -> $tx_file"
echo "collection gaps: $ngaps (see $gaps)"
