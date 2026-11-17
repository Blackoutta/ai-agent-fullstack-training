#!/usr/bin/env bash
# test-dnr.sh — self-test for the detection & response recipes (scripts/dnr/).
#
# Runnable from the repo root with bash >= 3.2, using only jq / python3 / awk / sed.
# No network. Exits non-zero on the first failed assertion. CI (corpus-check.yml)
# runs every scripts/tests/*.sh.
#
# Each assertion pins a documented property against the committed adversarial
# fixtures, so "validated" claims in the docs point at a real check.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DNR="$HERE/../dnr"
FIX="$DNR/fixtures"
fails=0
ok()   { printf 'ok   %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1" >&2; fails=$((fails+1)); }
eq()   { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1: expected '$3', got '$2'"; fi; }

for tool in jq python3 awk sed; do
  command -v "$tool" >/dev/null 2>&1 || { echo "test-dnr: missing required tool: $tool" >&2; exit 3; }
done
# collect.sh takes only base58 addresses and signatures (32-44 / 32-88 characters).
A_ADDR="AddrA111111111111111111111111111111111111111"
B_ADDR="AddrB111111111111111111111111111111111111111"
CURSOR="SigStart111111111111111111111111111111111111111111111111111111111111111111111111111"

# ---------------------------------------------------------------------------
# 1. frames.py attributes program logs by frame and never splits on an embedded
#    newline. The newline-injection fixture carries a forged "invoke [1]" inside
#    a Program log: payload.
# ---------------------------------------------------------------------------
logs="$(python3 -I "$DNR/frames.py" "$FIX/log-newline-injection.jsonl")"
n_log="$(printf '%s\n' "$logs" | jq -c 'select(.kind=="log")' | grep -c . || true)"
eq "frames: exactly the 2 real Program-log lines survive" "$n_log" "2"
n_forged="$(printf '%s\n' "$logs" | jq -rc 'select(.program|test("Fake"))' | grep -c . || true)"
eq "frames: zero frames attributed to the forged (injected) program id" "$n_forged" "0"
# All surviving log frames belong to the one real invoker.
n_vote="$(printf '%s\n' "$logs" | jq -rc 'select(.kind=="log" and .program=="Vote111111111111111111111111111111111111111")' | grep -c . || true)"
eq "frames: both real logs attributed to the real invoker frame" "$n_vote" "2"
# Demonstrate the hazard the design avoids: a naive flatten over-counts invokes.
naive="$(jq -r '.meta.logMessages[]' "$FIX/log-newline-injection.jsonl" | grep -cE 'invoke \[1\]$' || true)"
eq "frames: naive flatten would forge an extra invoke (hazard present in fixture)" "$naive" "2"

# ---------------------------------------------------------------------------
# 2. deltas.py tokens is exact above 2^53, where jq doubles are not.
# ---------------------------------------------------------------------------
tok="$(python3 -I "$DNR/deltas.py" tokens "$FIX/token-amount-over-2-53.jsonl")"
d1="$(printf '%s\n' "$tok" | awk -F'\t' '$2 ~ /^OwnerOne/ {print $4}')"
d2="$(printf '%s\n' "$tok" | awk -F'\t' '$2 ~ /^OwnerTwo/ {print $4}')"
eq "deltas tokens: true delta 1 preserved (jq doubles drop it to 0)" "$d1" "1"
eq "deltas tokens: true delta 1 preserved (jq doubles inflate it to 2)" "$d2" "1"
# Confirm the fixture really breaks jq doubles, so the claim is grounded.
jq_bad="$(jq -r '
  (.meta.preTokenBalances | map({(.owner): (.uiTokenAmount.amount|tonumber)}) | add) as $pre
  | .meta.postTokenBalances[] | "\(.owner)=\(((.uiTokenAmount.amount|tonumber)) - ($pre[.owner]))"' \
  "$FIX/token-amount-over-2-53.jsonl" | tr '\n' ' ')"
case "$jq_bad" in
  *"OwnerOne"*"=0"*|*"=0 "*OwnerOne*) ok "deltas tokens: jq-double path is wrong on this fixture ($jq_bad)" ;;
  *) [[ "$jq_bad" == *"=1"*"=1"* ]] && bad "deltas tokens: fixture no longer exercises the jq hazard ($jq_bad)" || ok "deltas tokens: jq-double path differs from exact ($jq_bad)" ;;
esac

# ---------------------------------------------------------------------------
# 3. deltas.py skips failed transactions (atomic revert, FP-4).
# ---------------------------------------------------------------------------
lam="$(python3 -I "$DNR/deltas.py" lamports "$FIX/clean-mixed.jsonl")"
n_failrows="$(printf '%s\n' "$lam" | grep -c 'SigCleanFail' || true)"
eq "deltas lamports: no rows from the failed tx" "$n_failrows" "0"
n_okrows="$(printf '%s\n' "$lam" | grep -c 'SigCleanOkV0' || true)"
eq "deltas lamports: movement rows from the successful tx present" "$n_okrows" "2"

# ---------------------------------------------------------------------------
# 4. profile.sh baselines without touching logMessages.
# ---------------------------------------------------------------------------
prof="$(bash "$DNR/profile.sh" "$FIX/clean-mixed.jsonl")"
v1="$(printf '%s\n' "$prof" | awk '/^-- version/{f=1;next} /^--/{f=0} f && $2=="1"{print $1}')"
eq "profile: v1 transaction counted in the version histogram" "$v1" "1"

# ---------------------------------------------------------------------------
# 5. redact.sh strips keys wherever a provider puts them — query, path, userinfo,
#    subdomain, and curl's own error and verbose lines — and keeps the text around
#    the URL intact (a closing paren or quote is not eaten).
# ---------------------------------------------------------------------------
red() { printf '%s\n' "$1" | bash "$DNR/redact.sh"; }
r1="$(red 'error: failed POST https://rpc.example.com/?api-key=SECRET123456 after 1 try')"
case "$r1" in *SECRET123456*) bad "redact: query api-key leaked ($r1)" ;; *REDACTED*) ok "redact: query-string key removed" ;; *) bad "redact: unexpected ($r1)" ;; esac
r2="$(red 'see (https://solana-mainnet.g.alchemy.com/v2/ALCHEMYKEY123) now')"
eq "redact: path-segment key (/v2/<key>) removed, closing paren kept" "$r2" "see (https://REDACTED.alchemy.com/REDACTED) now"
r3="$(red 'url https://rpc.ankr.com/solana/ANKRKEY456 timed out')"
eq "redact: second-segment key (/solana/<key>) removed" "$r3" "url https://REDACTED.ankr.com/REDACTED timed out"
r4="$(red 'auth https://user:PASSW0RD@host.example.com/rpc failed')"
eq "redact: userinfo key removed" "$r4" "auth https://REDACTED@REDACTED.example.com/REDACTED failed"
r5="$(red 'header api-key=BAREKEY99&x=1 rejected')"
eq "redact: bare api-key=value removed" "$r5" "header api-key=REDACTED&x=1 rejected"
r6="$(red 'plain text, no url')"
eq "redact: text without a URL is unchanged" "$r6" "plain text, no url"
r7="$(red 'HTTPS://user:SECRETPW@Host.Example.com/v2/KEYUP done')"
eq "redact: upper-case scheme, userinfo and path key removed" "$r7" "HTTPS://REDACTED@REDACTED.Example.com/REDACTED done"
r8="$(red 'wss://rpc.example.com/ws?api-key=WSKEY1 closed')"
eq "redact: a websocket URL is redacted like https" "$r8" "wss://REDACTED.example.com/REDACTED closed"
r9="$(red 'Api-Key=UPPERKEY9 and ACCESS_TOKEN=T0K3N&x=1')"
eq "redact: key names in any letter case" "$r9" "Api-Key=REDACTED and ACCESS_TOKEN=REDACTED&x=1"
eq "redact: a subdomain token keeps only the last two labels" \
  "$(red 'via https://TOKSUB42.rpc.example.test then https://TOKSUB42.rpc.example.test/v2/K')" \
  "via https://REDACTED.example.test then https://REDACTED.example.test/REDACTED"
eq "redact: an IP address and a two-label host are kept" \
  "$(red 'http://127.0.0.1:8899/v2/K and https://example.test/v2/K')" "http://127.0.0.1:8899/REDACTED and https://example.test/REDACTED"
eq "redact: curl verbose request line loses its path" "$(red '> POST /v2/LEAKME42 HTTP/2')" "> POST /REDACTED HTTP/2"
eq "redact: curl verbose Host header keeps the last two labels" "$(red '> Host: TOKSUB42.rpc.example.test')" "> Host: REDACTED.example.test"
eq "redact: curl HTTP/2 :path header loses its path" "$(red '* [HTTP/2] [1] [:path: /v2/LEAKME42]')" "* [HTTP/2] [1] [:path: /REDACTED]"
eq "redact: curl error naming a bare host keeps the last two labels" \
  "$(red 'curl: (6) Could not resolve host: TOKSUB42.rpc.example.test')" "curl: (6) Could not resolve host: REDACTED.example.test"
eq "redact: dotted names in other text are left alone" "$(red 'curl 8.7.1 calls os.path.join')" "curl 8.7.1 calls os.path.join"
# The documented recipe keeps the filtered command's failure: `set -o pipefail;`
# starts the line. Without it the filter's own 0 is the status (the control).
for sh in bash zsh; do
  command -v "$sh" >/dev/null 2>&1 || continue
  "$sh" -c '(exit 7) 2>&1 | bash "$1"' _ "$DNR/redact.sh" >/dev/null 2>&1
  eq "redact: control, $sh without pipefail loses the failure" "$?" "0"
  "$sh" -c 'set -o pipefail; (exit 7) 2>&1 | bash "$1"' _ "$DNR/redact.sh" >/dev/null 2>&1
  eq "redact: $sh 'set -o pipefail; <cmd> 2>&1 | redact.sh' keeps the failure" "$?" "7"
done

# ---------------------------------------------------------------------------
# 6. collect.sh is gated: it refuses without --confirmed, and without $RPC_URL,
#    before any network call. The --confirmed case runs with $RPC_URL set and a
#    curl on PATH that records every call, so only the gate can stop it.
# ---------------------------------------------------------------------------
GATE="$(mktemp -d "${TMPDIR:-/tmp}/dnr_gate.XXXXXX")"
printf '#!/bin/sh\necho "$*" >> "%s/calls"\n' "$GATE" > "$GATE/curl"; chmod +x "$GATE/curl"
( PATH="$GATE:$PATH" RPC_URL="https://rpc.example.test/" bash "$DNR/collect.sh" --out "$GATE/out" -- "$A_ADDR" ) >/dev/null 2>&1
code=$?
if [[ "$code" == 2 && ! -e "$GATE/calls" && ! -e "$GATE/out" ]]; then
  ok "collect: refuses without --confirmed, \$RPC_URL set (exit 2, no curl call, nothing written)"
else
  bad "collect: without --confirmed -> exit $code, curl calls: $(grep -c . "$GATE/calls" 2>/dev/null || echo 0)"
fi
rm -rf "$GATE"
if ( unset RPC_URL; bash "$DNR/collect.sh" --out "${TMPDIR:-/tmp}/dnr_ct.$$" --confirmed -- "$A_ADDR" ) >/dev/null 2>&1; then
  bad "collect: ran without \$RPC_URL (must refuse)"
else
  ok "collect: refuses without \$RPC_URL"
fi

# ---------------------------------------------------------------------------
# 7. deltas.py keys token movement by token account and mint, with the owner as a
#    label: an owner's net is the sum of its rows (Python ints), and two accounts
#    never share a bucket, even with no owner. Lamport math stays exact above 2^53.
# ---------------------------------------------------------------------------
owner_sum() {  # owner_sum <owner> < deltas tokens output: that owner's net, in Python ints
  python3 -I -c 'import sys
print(sum(int(r.split("\t")[3]) for r in sys.stdin if r.split("\t")[1] == sys.argv[1]))' "$1"
}
mvrows="$(python3 -I "$DNR/deltas.py" tokens "$FIX/same-owner-move.jsonl")"
eq "deltas tokens: an internal move shows both legs (two token accounts)" \
  "$(printf '%s\n' "$mvrows" | awk -F'\t' '{printf "%s:%s ", $5, $4}')" "TA1:-100 TA2:100 "
eq "deltas tokens: ... and nets to zero for the owner" "$(printf '%s\n' "$mvrows" | owner_sum VaultPDA)" "0"
dr="$(python3 -I "$DNR/deltas.py" tokens "$FIX/same-owner-drain.jsonl")"
eq "deltas tokens: a two-account drain sums to -140 for the owner" "$(printf '%s\n' "$dr" | owner_sum VaultPDA)" "-140"
eq "deltas tokens: attacker receives +140" "$(printf '%s\n' "$dr" | owner_sum Attacker)" "140"
nrows="$(python3 -I -c 'import json
bal = lambda i, a: {"accountIndex": i, "mint": "MintNoOwner", "uiTokenAmount": {"amount": str(a)}}
print(json.dumps({"meta": {"err": None, "preTokenBalances": [bal(1, 100), bal(2, 0)],
    "postTokenBalances": [bal(1, 60), bal(2, 40)]},
    "transaction": {"signatures": ["SigNoOwner"], "message": {"accountKeys": [
        {"pubkey": "Payer"}, {"pubkey": "TokAcctA"}, {"pubkey": "TokAcctB"}]}}}))' \
  | python3 -I "$DNR/deltas.py" tokens)"
eq "deltas tokens: two owner-less accounts that transfer to each other show both legs" \
  "$(printf '%s\n' "$nrows" | awk -F'\t' '{printf "%s %s %s; ", $2, $5, $4}')" "? TokAcctA -40; ? TokAcctB 40; "
bl="$(python3 -I "$DNR/deltas.py" lamports "$FIX/lamports-over-2-53.jsonl")"
eq "deltas lamports: +1 above 2^53 is exact (BigOne)" "$(printf '%s\n' "$bl" | awk -F'\t' '$2=="BigOne"{print $3}')" "1"
eq "deltas lamports: +1 above 2^53 is exact (BigTwo)" "$(printf '%s\n' "$bl" | awk -F'\t' '$2=="BigTwo"{print $3}')" "1"

# ---------------------------------------------------------------------------
# 8. frames.py: a tab-separated forged record plus a newline-forged invoke inside
#    Program log payloads yields valid JSONL, attributed to the real invoker only.
# ---------------------------------------------------------------------------
tabrows="$(python3 -I "$DNR/frames.py" "$FIX/log-tab-injection.jsonl")"
eq "frames: tab/newline payloads stay 2 records" "$(printf '%s\n' "$tabrows" | grep -c . || true)" "2"
bad_json="$(printf '%s\n' "$tabrows" | python3 -I -c 'import sys,json
n=0
for l in sys.stdin:
    try: json.loads(l)
    except Exception: n+=1
print(n)')"
eq "frames: every output line is valid JSON" "$bad_json" "0"
eq "frames: nothing attributed to the forged victim program" \
  "$(printf '%s\n' "$tabrows" | jq -rc 'select(.program|test("Vict1m"))' | grep -c . || true)" "0"

# ---------------------------------------------------------------------------
# 9. profile.sh resolves programIdIndex (encoding: json) as well as programId.
# ---------------------------------------------------------------------------
TT="$(mktemp -d "${TMPDIR:-/tmp}/dnr_test.XXXXXX")"
trap 'rm -rf "$TT"' EXIT
printf '%s\n' '{"slot":1,"version":0,"meta":{"err":null},"transaction":{"signatures":["S"],"message":{"accountKeys":["Payer1","ProgIdx111"],"instructions":[{"programIdIndex":1}]}}}' > "$TT/json-enc.jsonl"
pidx="$(bash "$DNR/profile.sh" "$TT/json-enc.jsonl" | awk '/^-- top-level programs/{f=1;next} f && $2=="ProgIdx111"{print $1}')"
eq "profile: programIdIndex resolved through accountKeys" "$pidx" "1"

# ---------------------------------------------------------------------------
# 10. collect.sh end to end against a fake `curl` (no network): runs under the
#     system bash, keeps FAILED transactions, takes a short page on the cap's last
#     page as the end of history, passes --before through, and never prints the key.
# ---------------------------------------------------------------------------
mkdir -p "$TT/bin"
cat > "$TT/bin/curl" <<'PY'
#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
with open(os.environ["FAKE_CURL_ARGV"], "a") as log:
    log.write(json.dumps(args) + "\n")
url = ""
if args[args.index("-K") + 1] == "-":
    for line in sys.stdin:
        m = re.match(r'\s*url\s*=\s*"(.*)"\s*$', line)
        url = m.group(1) if m else url
if not url:
    sys.stderr.write("curl: no URL specified\n"); sys.exit(2)
body = args[args.index("--data-raw") + 1]
sys.stderr.write(f"curl: note: talking to {url}\n")
req = json.loads(body)
with open(os.environ["FAKE_CURL_LOG"], "a") as log:
    log.write(json.dumps(req) + "\n")
m, p = req["method"], req["params"]
# FAKE_CURL_TX_FAIL=<sig>=transport|rpc|null fails that one getTransaction;
# FAKE_CURL_PAGE_FAIL=1 fails every getSignaturesForAddress with an RPC error.
fail_sig, _, fail_mode = os.environ.get("FAKE_CURL_TX_FAIL", "").partition("=")
if m == "getTransaction" and p[0] == fail_sig and fail_mode == "transport":
    sys.stderr.write(f"curl: (7) Failed to connect to {url.split('/')[2]} port 443 after 2 ms: Couldn't connect to server\n")
    sys.exit(7)
if m == "getTransaction" and p[0] == fail_sig and fail_mode in ("rpc", "null"):
    out = {"error": {"code": -32009, "message": "Transaction version (1) is not supported"}} if fail_mode == "rpc" else {"result": None}
    print(json.dumps(dict({"jsonrpc": "2.0", "id": 1}, **out))); sys.exit(0)
if m == "getSignaturesForAddress" and os.environ.get("FAKE_CURL_PAGE_FAIL"):
    print(json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"code": -32005, "message": "Node is behind"}})); sys.exit(0)
if m == "getSignaturesForAddress" and p[0].startswith("AddrB"):
    res = [
        {"signature": "SigZnewest", "slot": 9, "err": None, "blockTime": 1700000900},
        {"signature": "SigAoldest", "slot": 0, "err": None, "blockTime": 1700000100},
    ]
    print(json.dumps({"jsonrpc": "2.0", "id": 1, "result": res}))
elif m == "getSignaturesForAddress":
    res = [] if "before" in p[1] and p[1]["before"] == "SigFail" else [
        {"signature": "SigOK", "slot": 2, "err": None, "blockTime": 1700000500},
        {"signature": "SigFail", "slot": 1, "err": {"InstructionError": [0, {"Custom": 1}]}, "blockTime": 1700000400},
    ]
    print(json.dumps({"jsonrpc": "2.0", "id": 1, "result": res}))
elif m == "getTransaction":
    sig = p[0]
    err = None if sig == "SigOK" else {"InstructionError": [0, {"Custom": 1}]}
    print(json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"slot": 1, "meta": {"err": err}, "transaction": {"signatures": [sig]}}}))
else:
    print(json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"code": -32601, "message": "nope"}}))
PY
chmod +x "$TT/bin/curl"
export FAKE_CURL_LOG="$TT/curl.log" FAKE_CURL_ARGV="$TT/curl.argv"
( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/?api-key=LEAKME42" \
    bash "$DNR/collect.sh" --out "$TT/c" --confirmed --since 1 --max-pages 1 --before "$CURSOR" -- "$A_ADDR" ) > "$TT/c.out" 2>&1
code=$?
eq "collect: exits 0 against the fake RPC (system bash)" "$code" "0"
eq "collect: fetched both the successful AND the failed transaction" \
  "$(grep -c . "$TT/c/transactions.jsonl" 2>/dev/null || true)" "2"
eq "collect: a short last page at the page cap is the end of history (no notice, no gap row)" \
  "$(grep -c '^  ! ' "$TT/c.out")/$(grep -c . "$TT/c/collection-gaps.tsv")" "0/0"
if grep -q "\"before\": \"$CURSOR\"" "$FAKE_CURL_LOG"; then ok "collect: --before passed through to the first page"; else bad "collect: --before not passed through"; fi
if grep -q 'LEAKME42' "$TT/c.out" "$TT/c/signatures.jsonl" "$TT/c/transactions.jsonl"; then
  bad "collect: the key leaked into output"
else
  ok "collect: key absent from stdout/stderr and corpus files"
fi
if grep -q 'provider: example.test ' "$TT/c.out"; then ok "collect: provider disclosed as its last two DNS labels"; else bad "collect: provider line wrong"; fi
if grep -q LEAKME42 "$FAKE_CURL_ARGV"; then bad "collect: the key reached curl's argv"; else ok "collect: the key never reaches curl's argv (URL via -K - on stdin)"; fi
eq "collect: every curl call starts with -q (no ~/.curlrc)" "$(grep -vc '^\["-q", "-K", "-",' "$FAKE_CURL_ARGV")" "0"
( PATH="$TT/bin:$PATH" RPC_URL="https://TOKSUB42.rpc.example.test/v2/LEAKME42" \
    bash "$DNR/collect.sh" --out "$TT/c-sub" --confirmed --max-pages 1 -- "$A_ADDR" ) > "$TT/c-sub.out" 2>&1
if grep -q 'provider: example.test ' "$TT/c-sub.out" && ! grep -q 'TOKSUB42\|LEAKME42' "$TT/c-sub.out"; then
  ok "collect: a subdomain token never reaches the output"
else
  bad "collect: subdomain token or key in the output ($(grep -m1 'TOKSUB42\|LEAKME42\|provider' "$TT/c-sub.out"))"
fi
# Collection gaps: every getTransaction that fails (transport error, RPC error,
# null result), a failed signature page, a page cap on a full page and the --max-tx cap
# each become a <subject>TAB<reason> row of collection-gaps.tsv, and the run says how
# many. curl's own exit status reaches the row.
eq "collect: a clean run reports no collection gaps" \
  "$(grep -c '^collection gaps: 0 (see .*collection-gaps.tsv)$' "$TT/c-sub.out")/$(grep -c . "$TT/c-sub/collection-gaps.tsv")" "1/0"
for mode in "transport:transport error (curl exit 7)" "rpc:RPC error -32009" "null:null result"; do
  ( PATH="$TT/bin:$PATH" FAKE_CURL_TX_FAIL="SigOK=${mode%%:*}" RPC_URL="https://TOKSUB42.rpc.example.test/v2/LEAKME42" \
      bash "$DNR/collect.sh" --out "$TT/g-${mode%%:*}" --confirmed --max-pages 1 -- "$A_ADDR" ) > "$TT/g.out" 2>&1
  code=$?
  row="$(cat "$TT/g-${mode%%:*}/collection-gaps.tsv" 2>/dev/null)"
  if [[ "$code" == 0 && "$row" == "SigOK$(printf '\t')getTransaction: ${mode#*:}" ]] \
     && grep -q '^collection gaps: 1 (see .*collection-gaps.tsv)$' "$TT/g.out" \
     && [[ "$(grep -c . "$TT/g-${mode%%:*}/transactions.jsonl")" == 1 ]]; then
    ok "collect: a failed getTransaction (${mode%%:*}) is a gap row with its reason; the rest is still fetched"
  else
    bad "collect: failed getTransaction (${mode%%:*}) -> exit $code, row '$row'"
  fi
done
if grep -q 'TOKSUB42\|LEAKME42' "$TT/g.out"; then bad "collect: curl's error leaked the endpoint"; else ok "collect: curl's own error is redacted (no subdomain token, no key)"; fi
( PATH="$TT/bin:$PATH" FAKE_CURL_PAGE_FAIL=1 RPC_URL="https://rpc.example.test/" \
    bash "$DNR/collect.sh" --out "$TT/g-page" --confirmed --max-pages 1 -- "$A_ADDR" ) > "$TT/g.out" 2>&1
eq "collect: a failed signature page is a gap row" "$(cat "$TT/g-page/collection-gaps.tsv")" \
  "$A_ADDR$(printf '\t')getSignaturesForAddress page 0: RPC error -32005; older history not collected"
calls_before="$(grep -c . "$FAKE_CURL_LOG" 2>/dev/null || true)"
for url in 'a space:https://rpc.example.test/?k=a b' 'a quote:https://rpc.example.test/"x' 'a backslash:https://rpc.example.test/\x'; do
  ( PATH="$TT/bin:$PATH" RPC_URL="${url#*:}" bash "$DNR/collect.sh" --out "$TT/c-bad" --confirmed -- "$A_ADDR" ) > /dev/null 2>&1
  code=$?
  if [[ "$code" == 2 && ! -e "$TT/c-bad" ]]; then ok "collect: refuses an \$RPC_URL holding ${url%%:*} (exit 2)"; else bad "collect: \$RPC_URL holding ${url%%:*} -> exit $code"; fi
done
eq "collect: a refused \$RPC_URL made no RPC call" "$(grep -c . "$FAKE_CURL_LOG" 2>/dev/null || true)" "$calls_before"
# --max-tx keeps the newest signatures across addresses (by slot), not the first
# address's or the alphabetically first ones.
( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
    bash "$DNR/collect.sh" --out "$TT/c2" --confirmed --max-pages 1 --max-tx 2 -- "$A_ADDR" "$B_ADDR" ) > "$TT/c2.out" 2>&1
got="$(jq -r '.transaction.signatures[0]' "$TT/c2/transactions.jsonl" 2>/dev/null | tr '\n' ' ')"
eq "collect: --max-tx 2 fetches the two newest signatures across both addresses" "$got" "SigZnewest SigOK "
# With only --until set, a short page on the cap's last page still ends the history,
# so there is no notice and no gap row.
( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
    bash "$DNR/collect.sh" --out "$TT/c3" --confirmed --until 100 --max-pages 1 -- "$A_ADDR" ) > "$TT/c3.out" 2>&1
eq "collect: --until only, a short last page at the cap is the end of history (no notice, no gap row)" \
  "$(grep -c '^  ! ' "$TT/c3.out")/$(grep -c . "$TT/c3/collection-gaps.tsv")" "0/0"
eq "collect: the --max-tx cap is one gap row naming the first signature not fetched" \
  "$(cut -f1 "$TT/c2/collection-gaps.tsv")|$(grep -c 'collection gaps: 1 ' "$TT/c2.out")" "SigFail|1"
# A second pass into an --out that already holds a corpus is refused, so the first
# pass survives.
cp "$TT/c/signatures.jsonl" "$TT/c.sig.before"
( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
    bash "$DNR/collect.sh" --out "$TT/c" --confirmed --max-pages 1 -- "$A_ADDR" ) > "$TT/c4.out" 2>&1
code=$?
if [[ "$code" == 2 ]] && grep -q 'use a new --out' "$TT/c4.out" && cmp -s "$TT/c/signatures.jsonl" "$TT/c.sig.before"; then
  ok "collect: refuses to reuse an --out that holds a corpus (exit 2, corpus intact)"
else
  bad "collect: reuse of a filled --out -> exit $code"
fi
# Inputs are checked before any write or RPC call: an address that is not base58,
# a --before that is not a signature, a cap that is not a number.
calls_before="$(grep -c . "$FAKE_CURL_LOG" 2>/dev/null || true)"
for args in "-- AddrA" "-- ../../x" "--before not/a/sig -- $A_ADDR" "--max-tx 2x -- $A_ADDR"; do
  # shellcheck disable=SC2086
  ( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
      bash "$DNR/collect.sh" --out "$TT/c5" --confirmed $args ) > /dev/null 2>&1
  code=$?
  if [[ "$code" == 2 && ! -e "$TT/c5" ]]; then ok "collect: refuses '$args' (exit 2, nothing written)"; else bad "collect: '$args' -> exit $code"; fi
done
eq "collect: refused inputs made no RPC call" "$(grep -c . "$FAKE_CURL_LOG" 2>/dev/null || true)" "$calls_before"
# Rule 11d: an incident_<n>/ that the corpus lands in ignores itself; an existing
# .gitignore is left alone.
( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
    bash "$DNR/collect.sh" --out "$TT/incident_7/corpus" --confirmed --max-pages 1 -- "$A_ADDR" ) > /dev/null 2>&1
eq "collect: incident_<n>/.gitignore holds '*'" "$(cat "$TT/incident_7/.gitignore" 2>/dev/null)" "*"
mkdir -p "$TT/incident_9"; printf 'keep-me\n' > "$TT/incident_9/.gitignore"
( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
    bash "$DNR/collect.sh" --out "$TT/incident_9/corpus" --confirmed --max-pages 1 -- "$A_ADDR" ) > /dev/null 2>&1
eq "collect: an existing incident_<n>/.gitignore is not overwritten" "$(cat "$TT/incident_9/.gitignore")" "keep-me"

# ---------------------------------------------------------------------------
# 11. snapshot-program.sh against a fake `solana`: writes bin/<id>.so, prints the
#     ledger line (owner, last-deployed slot, zero-trimmed hash, padding), redacts a
#     CLI error, and reads a loader-v4 program through program-v4 show / download.
#     The CLI runs from a throwaway -C config: no URL in argv, a keypair path that
#     does not exist, a 0700 directory removed on exit, and a blocker if the CLI
#     ignores the config. Like solana-cli 3.1, the fake reads a config only when it
#     holds websocket_url, `program show` / `program-v4 show` need a signer unless
#     --buffer-authority / --authority is given, `program show` / `dump` reject a
#     loader-v4 program ("is not an SBF program"), and `program-v4` commands reject
#     anything else ("is not owned by loader-v4").
# ---------------------------------------------------------------------------
printf '#!/bin/sh\nexec python3 -I "$0.py" "$@"\n' > "$TT/bin/solana"
cat > "$TT/bin/solana.py" <<'PY'
import json, os, re, sys
a = sys.argv[1:]
with open(os.environ["FAKE_SOLANA_ARGV"], "a") as log:
    log.write(json.dumps(a) + "\n")
cfg = {}
if "-C" in a:
    i = a.index("-C")
    for line in open(a[i + 1]):
        m = re.match(r'(\w+): "(.*)"$', line.rstrip("\n"))
        if m:
            cfg[m.group(1)] = m.group(2)
    del a[i:i + 2]
if "websocket_url" not in cfg or os.environ.get("FAKE_SOLANA_IGNORE_CONFIG"):
    cfg = {"json_rpc_url": "https://api.mainnet-beta.solana.com", "keypair_path": "/home/fake/.config/solana/id.json"}
url, kp = cfg.get("json_rpc_url", ""), cfg.get("keypair_path", "")
if a[:3] == ["config", "get", "keypair"]:
    print(f"Key Path: {kp} "); sys.exit(0)
try:
    mode = oct(os.stat(os.path.dirname(kp)).st_mode & 0o777)
except OSError:
    mode = "none"
with open(os.environ["FAKE_SOLANA_SEEN"], "a") as log:
    log.write(f"{kp}\t{os.path.exists(kp)}\t{mode}\n")
if os.environ.get("FAKE_SOLANA_FAIL"):
    sys.stderr.write(f"Error: RPC request error: cluster version query failed: {url}\n"); sys.exit(1)
v4 = bool(os.environ.get("FAKE_SOLANA_V4"))
owner = "LoaderV411111111111111111111111111111111111" if v4 else "BPFLoaderUpgradeab1e11111111111111111111111"
if (a[:2] == ["program", "show"] and "--buffer-authority" not in a or a[:2] == ["program-v4", "show"] and "--authority" not in a) \
        and not os.path.exists(kp):
    sys.stderr.write(f'Error: Dynamic program error: No default signer found, run "solana-keygen new -o {kp}" to create a new one\n'); sys.exit(1)
pid = a[2] if a[0] == "program" else a[a.index("--program-id") + 1]
if a[:2] in (["program", "show"], ["program", "dump"]) and v4:
    sys.stderr.write(f"Error: {pid} is not an SBF program\n"); sys.exit(1)
if a[0] == "program-v4" and not v4:
    sys.stderr.write(f"Error: {pid} is not owned by loader-v4\n"); sys.exit(1)
if a[:2] == ["program", "show"]:
    print(f"\nProgram Id: {pid}\nOwner: {owner}\nProgramData Address: PdA111\nAuthority: Auth111\nLast Deployed In Slot: 12345\nData Length: 100 (0x64) bytes\nBalance: 1 SOL\n")
elif a[:2] == ["program-v4", "show"]:
    print(f"\nProgram Id: {pid}\nOwner: {owner}\nAuthority: Auth111\nLast Deployed In Slot: 12345\nStatus: deployed\nData Length: 100 (0x64) bytes\n")
elif a[:2] in (["program", "dump"], ["program-v4", "download"]):
    open(a[-1], "wb").write(b"\x7fELF" + bytes(range(1, 30)) + b"\x00" * 500)
    print(f"Wrote program to {a[-1]}")
else:
    sys.stderr.write("fake solana: refusing unexpected subcommand\n"); sys.exit(9)
PY
chmod +x "$TT/bin/solana"
export FAKE_SOLANA_ARGV="$TT/solana.argv" FAKE_SOLANA_SEEN="$TT/solana.seen"
PID="ProgTest11111111111111111111111111111111111"   # base58, decodes to 32 bytes
snap="$(PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/v2/LEAKME42" bash "$DNR/snapshot-program.sh" "$PID" "$TT/inc" 2>&1)"
code=$?
eq "snapshot: exits 0 with the fake CLI" "$code" "0"
want="$(python3 -I -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read().rstrip(b"\x00")).hexdigest())' "$TT/inc/bin/$PID.so" 2>/dev/null)"
case "$snap" in
  *"last_deployed_slot=12345"*"sha256_zero_trimmed=$want"*"padding_bytes=500"*) ok "snapshot: ledger line carries slot, zero-trimmed hash and padding" ;;
  *) bad "snapshot: unexpected ledger line ($snap)" ;;
esac
snapfail="$(PATH="$TT/bin:$PATH" FAKE_SOLANA_FAIL=1 RPC_URL="https://rpc.example.test/v2/LEAKME42" bash "$DNR/snapshot-program.sh" "$PID" "$TT/inc2" 2>&1)"
code=$?
eq "snapshot: CLI failure -> exit 3" "$code" "3"
case "$snapfail" in *LEAKME42*) bad "snapshot: key leaked from the CLI error" ;; *REDACTED*) ok "snapshot: CLI error redacted" ;; *) bad "snapshot: error text not shown ($snapfail)" ;; esac
if grep -q LEAKME42 "$FAKE_SOLANA_ARGV"; then bad "snapshot: the key reached the CLI's argv"; else ok "snapshot: the key never reaches the CLI's argv"; fi
eq "snapshot: every CLI call names a -C config and none passes --url" \
  "$(grep -c . "$FAKE_SOLANA_ARGV")/$(grep -c '"-C"' "$FAKE_SOLANA_ARGV")/$(grep -c '"--url"' "$FAKE_SOLANA_ARGV")" \
  "$(grep -c . "$FAKE_SOLANA_ARGV")/$(grep -c . "$FAKE_SOLANA_ARGV")/0"
eq "snapshot: the CLI is given a keypair path that does not exist, in a 0700 directory" \
  "$(awk -F'\t' '{print $2, $3}' "$FAKE_SOLANA_SEEN" | sort -u)" "False 0o700"
gone=1; while IFS="$(printf '\t')" read -r kp _ _; do [[ -e "$(dirname "$kp")" ]] && gone=0; done < "$FAKE_SOLANA_SEEN"
if [[ "$gone" == 1 ]]; then ok "snapshot: the temp config directory is removed on exit"; else bad "snapshot: a temp config directory was left behind"; fi
calls_before="$(grep -c '"program"' "$FAKE_SOLANA_ARGV")"
PATH="$TT/bin:$PATH" FAKE_SOLANA_IGNORE_CONFIG=1 RPC_URL="https://rpc.example.test/" bash "$DNR/snapshot-program.sh" "$PID" "$TT/inc6" > "$TT/inc6.out" 2>&1
code=$?
if [[ "$code" == 3 && ! -e "$TT/inc6/bin" ]] && grep -q 'did not load the keyless config' "$TT/inc6.out"; then
  ok "snapshot: a CLI that ignores the config stops with a blocker before show or dump (exit 3)"
else
  bad "snapshot: CLI ignoring the config -> exit $code"
fi
eq "snapshot: no program call after the config check failed" "$(grep -c '"program"' "$FAKE_SOLANA_ARGV")" "$calls_before"
PATH="$TT/bin:$PATH" RPC_URL='https://rpc.example.test/"x' bash "$DNR/snapshot-program.sh" "$PID" "$TT/inc7" >/dev/null 2>&1
code=$?
if [[ "$code" == 2 && ! -e "$TT/inc7" ]]; then ok "snapshot: refuses an \$RPC_URL holding a quote (exit 2, nothing written)"; else bad "snapshot: quoted \$RPC_URL -> exit $code"; fi
v4snap="$(PATH="$TT/bin:$PATH" FAKE_SOLANA_V4=1 RPC_URL="https://rpc.example.test/" bash "$DNR/snapshot-program.sh" "$PID" "$TT/inc3" 2>&1)"
code=$?
case "$code|$v4snap" in
  "0|program=$PID owner=LoaderV411111111111111111111111111111111111 last_deployed_slot=12345 authority=Auth111 "*" file=bin/$PID.so")
    ok "snapshot: a loader-v4 program is read with program-v4 show / download (exit 0)" ;;
  *) bad "snapshot: loader-v4 program -> exit $code ($v4snap)" ;;
esac
# The id is used in file names: anything but a base58 key is refused before any write.
for badid in '../../escape' 'Prog111' 'ProgTest111111111111111111111111111111111/x' 'Prog0OIl1111111111111111111111111111111111'; do
  PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" bash "$DNR/snapshot-program.sh" "$badid" "$TT/inc5" >/dev/null 2>&1
  code=$?
  if [[ "$code" == 2 && ! -e "$TT/inc5" ]]; then ok "snapshot: refuses the id '$badid' (exit 2, nothing written)"; else bad "snapshot: id '$badid' -> exit $code"; fi
done
# Rule 11d: snapshotting into incident_<n>/ makes it ignore itself; a directory with
# another name gets no .gitignore from the script.
PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" bash "$DNR/snapshot-program.sh" "$PID" "$TT/incident_8" >/dev/null 2>&1
eq "snapshot: incident_<n>/.gitignore holds '*'" "$(cat "$TT/incident_8/.gitignore" 2>/dev/null)" "*"
if [[ ! -e "$TT/inc/.gitignore" ]]; then ok "snapshot: no .gitignore written into a directory not named incident_*"; else bad "snapshot: wrote a .gitignore outside an incident_* directory"; fi

# ---------------------------------------------------------------------------
# 12. Bundled python runs isolated (`python3 -I`). A json.py / re.py / hashlib.py
#     that an audited repo ships in the working directory, or puts on PYTHONPATH,
#     must never load — not in frames.py / deltas.py, and not in the hash that
#     snapshot-program.sh computes with `python3 -I -`. The two controls show the
#     planted modules DO load once -I is left out, so the checks are not vacuous.
# ---------------------------------------------------------------------------
EVIL="$TT/evil"; MARK="$TT/shadow.marker"; mkdir -p "$EVIL"
for m in json re hashlib; do
  printf 'open(%s, "a").write("%s\\n")\n' "'$MARK'" "$m" > "$EVIL/$m.py"
done
( cd "$EVIL" && printf 'import json\n' | python3 - >/dev/null 2>&1 )
if grep -q json "$MARK" 2>/dev/null; then ok "isolation control: without -I, a json.py in the working directory replaces the stdlib (python3 -)"; else bad "isolation control: the planted json.py did not load, so the checks below prove nothing"; fi
rm -f "$MARK"
( cd "$EVIL" && PYTHONPATH="$EVIL" python3 "$DNR/deltas.py" tokens "$FIX/same-owner-drain.jsonl" >/dev/null 2>&1 )
if grep -q json "$MARK" 2>/dev/null; then ok "isolation control: without -I, PYTHONPATH loads a planted json.py even for a script file"; else bad "isolation control: PYTHONPATH did not load the planted json.py"; fi
rm -f "$MARK"
iso="$(cd "$EVIL" && PYTHONPATH="$EVIL" python3 -I "$DNR/frames.py" "$FIX/log-newline-injection.jsonl" 2>&1)"
if [[ "$iso" == "$logs" ]]; then ok "isolation: frames.py output unchanged from a hostile cwd + PYTHONPATH"; else bad "isolation: frames.py output changed under a hostile cwd + PYTHONPATH"; fi
iso="$(cd "$EVIL" && PYTHONPATH="$EVIL" python3 -I "$DNR/deltas.py" tokens "$FIX/same-owner-drain.jsonl" 2>&1)"
if [[ "$iso" == "$dr" ]]; then ok "isolation: deltas.py output unchanged from a hostile cwd + PYTHONPATH"; else bad "isolation: deltas.py output changed under a hostile cwd + PYTHONPATH"; fi
iso="$(cd "$EVIL" && PATH="$TT/bin:$PATH" PYTHONPATH="$EVIL" RPC_URL="https://rpc.example.test/" bash "$DNR/snapshot-program.sh" "$PID" "$TT/inc4" 2>&1)"
case "$iso" in
  *"sha256_zero_trimmed=$want "*) ok "isolation: snapshot-program.sh hashes correctly from a hostile cwd + PYTHONPATH" ;;
  *) bad "isolation: snapshot hash wrong or missing ($iso)" ;;
esac
if [[ -e "$MARK" ]]; then bad "isolation: a planted module ran ($(tr '\n' ' ' < "$MARK"))"; else ok "isolation: no planted json.py / re.py / hashlib.py ran"; fi

# ---------------------------------------------------------------------------
# 13. profile.sh on a large corpus: 5,000 transactions with distinct fee payers,
#     signers and programs, so every top-20 list is well past the pipe buffer. It
#     must finish (exit 0) and print the last section, not die of SIGPIPE (141).
# ---------------------------------------------------------------------------
python3 -I -c 'import json, sys
for i in range(5000):
    payer = "Payer%039d" % i
    prog = "Prog%040d" % i
    print(json.dumps({"slot": i, "version": 0, "meta": {"err": None},
        "transaction": {"signatures": ["S%d" % i], "message": {
            "accountKeys": [{"pubkey": payer, "signer": True}, {"pubkey": prog, "signer": False}],
            "instructions": [{"programId": prog}]}}}))' > "$TT/big.jsonl"
bash "$DNR/profile.sh" "$TT/big.jsonl" > "$TT/big.out" 2>&1
eq "profile: a 5,000-payer corpus completes (no SIGPIPE exit)" "$?" "0"
eq "profile: the last section still prints its 20 rows" \
  "$(awk '/^-- top-level programs/{f=1;next} f' "$TT/big.out" | grep -c .)" "20"

# ---------------------------------------------------------------------------
# 14. deltas.py streams its corpus and checks every input before the first row:
#     a missing or unreadable later file exits 1 with no output, and a 20,000-
#     transaction corpus split over two files sums exactly.
# ---------------------------------------------------------------------------
for later in "a missing file:$TT/no-such-corpus.jsonl" "a directory:$TT"; do
  python3 -I "$DNR/deltas.py" tokens "$FIX/same-owner-drain.jsonl" "${later#*:}" > "$TT/d.out" 2> "$TT/d.err"
  code=$?
  if [[ "$code" == 1 && ! -s "$TT/d.out" ]] && grep -q 'cannot read' "$TT/d.err"; then
    ok "deltas: ${later%%:*} as a later input exits 1 before any row"
  else
    bad "deltas: ${later%%:*} as a later input -> exit $code, $(grep -c . "$TT/d.out") row(s)"
  fi
done
python3 -I -c 'import json, sys
amt = 2**60 + 1
for part, rng in ((sys.argv[1], range(0, 10000)), (sys.argv[2], range(10000, 20000))):
    with open(part, "w") as f:
        for i in rng:
            bal = lambda o, a: {"owner": o, "mint": "MintBig", "uiTokenAmount": {"amount": str(a)}}
            f.write(json.dumps({"meta": {"err": None,
                "preTokenBalances": [bal("Vault", 2**64), bal("Attacker", 0)],
                "postTokenBalances": [bal("Vault", 2**64 - amt), bal("Attacker", amt)]},
                "transaction": {"signatures": ["S%d" % i]}}) + "\n")' "$TT/big-a.jsonl" "$TT/big-b.jsonl"
python3 -I "$DNR/deltas.py" tokens "$TT/big-a.jsonl" "$TT/big-b.jsonl" > "$TT/big-d.tsv"
eq "deltas: a 20,000-transaction corpus over two files completes" "$?" "0"
eq "deltas: two rows per transaction" "$(grep -c . "$TT/big-d.tsv")" "40000"
eq "deltas: the attacker total is exact (Python ints)" \
  "$(python3 -I -c 'import sys
print(sum(int(l.split("\t")[3]) for l in open(sys.argv[1]) if l.split("\t")[1] == "Attacker"))' "$TT/big-d.tsv")" \
  "$(python3 -I -c 'print(20000 * (2**60 + 1))')"

# ---------------------------------------------------------------------------
# 15. collect.sh and snapshot-program.sh refuse a run directory that holds a
#     symbolic link, is one, or is tracked by git (in any letter case): exit 2,
#     nothing written inside it or outside it, no RPC call. An untracked,
#     link-free incident_<n>/ in the same repository is still accepted.
# ---------------------------------------------------------------------------
X="$TT/outside"; mkdir -p "$X/bin" "$X/corpus" "$X/b3"; printf 'canary\n' > "$X/canary"
mkdir -p "$TT/pl-a/incident_2" "$TT/pl-b"
ln -s "$X/canary" "$TT/pl-a/incident_2/LEDGER.md"
ln -s "$X/gitignore" "$TT/pl-a/incident_2/.gitignore"   # dangling: a write would create it outside
ln -s "$X/bin" "$TT/pl-a/incident_2/bin"
ln -s "$X/corpus" "$TT/pl-a/incident_2/corpus"
ln -s "$X/b3" "$TT/pl-b/incident_3"
REPO="$TT/repo"; mkdir -p "$REPO/incident_4" "$REPO/INCIDENT_6" "$REPO/incident_5"
for f in incident_4/LEDGER.md INCIDENT_6/LEDGER.md incident_5/LEDGER.md; do printf 'prior\n' > "$REPO/$f"; done
if git -C "$REPO" init -q >/dev/null 2>&1 && git -C "$REPO" add incident_4/LEDGER.md INCIDENT_6/LEDGER.md; then
  ok "run dir: test repository tracks incident_4/ and INCIDENT_6/"
else
  bad "run dir: could not set up the test repository"
fi
tree_state() { find "$X" "$TT/pl-a" "$TT/pl-b" "$REPO" -path "$REPO/.git" -prune -o -print | LC_ALL=C sort; cat "$X/canary"; }
state_before="$(tree_state)"
calls_before="$(grep -c . "$FAKE_CURL_LOG" 2>/dev/null || true)"
for case in \
  "a symbolic link inside the run dir:$TT/pl-a/incident_2:$TT/pl-a/incident_2/corpus2" \
  "a run dir that is a symbolic link:$TT/pl-b/incident_3:$TT/pl-b/incident_3/corpus" \
  "the same link with a trailing slash:$TT/pl-b/incident_3/:$TT/pl-b/incident_3/" \
  "a run dir git tracks:$REPO/incident_4:$REPO/incident_4/corpus" \
  "a run dir git tracks in another letter case:$REPO/incident_6:$REPO/incident_6/corpus"; do
  label="${case%%:*}"; rest="${case#*:}"; snapdir="${rest%%:*}"; outdir="${rest#*:}"
  ( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
      bash "$DNR/collect.sh" --out "$outdir" --confirmed --max-pages 1 -- "$A_ADDR" ) > "$TT/rd.out" 2>&1
  c1=$?
  PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" bash "$DNR/snapshot-program.sh" "$PID" "$snapdir" >> "$TT/rd.out" 2>&1
  c2=$?
  if [[ "$c1" == 2 && "$c2" == 2 ]] && [[ "$(grep -c 'refusing' "$TT/rd.out")" == 2 ]]; then
    ok "run dir: $label -> collect and snapshot refuse (exit 2)"
  else
    bad "run dir: $label -> collect exit $c1, snapshot exit $c2 ($(tr '\n' ' ' < "$TT/rd.out"))"
  fi
done
if [[ "$(tree_state)" == "$state_before" ]]; then ok "run dir: refused runs wrote nothing, inside or outside"; else bad "run dir: a refused run changed the tree"; fi
eq "run dir: refused runs made no RPC call" "$(grep -c . "$FAKE_CURL_LOG" 2>/dev/null || true)" "$calls_before"
( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
    bash "$DNR/collect.sh" --out "$REPO/incident_5/corpus" --confirmed --max-pages 1 -- "$A_ADDR" ) > /dev/null 2>&1
c1=$?
PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" bash "$DNR/snapshot-program.sh" "$PID" "$REPO/incident_5" > /dev/null 2>&1
c2=$?
if [[ "$c1" == 0 && "$c2" == 0 && -s "$REPO/incident_5/corpus/transactions.jsonl" && -s "$REPO/incident_5/bin/$PID.so" ]]; then
  ok "run dir: an untracked, link-free incident_<n>/ in a repository is accepted (control)"
else
  bad "run dir: the untracked control dir -> collect exit $c1, snapshot exit $c2"
fi
# A check that cannot run refuses instead of passing. Git refusing the repository
# (owned by another user, as with a checkout mounted into a container), git missing
# or failing, and a run directory find cannot read (here hiding a link to the
# outside) each mean exit 2, nothing written and no RPC call. The ownership cases run
# with no global or system git config: a machine-wide safe.directory (CI runners set
# one) would otherwise make git trust the repository.
mkdir -p "$TT/gitfail" "$TT/pl-c/incident_9"
printf '#!/bin/sh\nexit 127\n' > "$TT/gitfail/git"; chmod +x "$TT/gitfail/git"
ln -s "$X/bin" "$TT/pl-c/incident_9/bin"; chmod 0300 "$TT/pl-c/incident_9"
state_before="$(tree_state)"
calls_before="$(grep -c . "$FAKE_CURL_LOG" 2>/dev/null || true)"
for case in \
  "git does not trust the repository|GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TEST_ASSUME_DIFFERENT_OWNER=1 PATH=$TT/bin:$PATH|$REPO/incident_4|$REPO/incident_4/corpus" \
  "git does not trust the repository, untracked dir|GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TEST_ASSUME_DIFFERENT_OWNER=1 PATH=$TT/bin:$PATH|$REPO/incident_5|$REPO/incident_5/corpus-2" \
  "git missing or failing|PATH=$TT/gitfail:$TT/bin:$PATH|$REPO/incident_4|$REPO/incident_4/corpus" \
  "a run dir find cannot read|PATH=$TT/bin:$PATH|$TT/pl-c/incident_9|$TT/pl-c/incident_9/corpus"; do
  label="${case%%|*}"; rest="${case#*|}"; envs="${rest%%|*}"; rest="${rest#*|}"; snapdir="${rest%%|*}"; outdir="${rest#*|}"
  ( export RPC_URL="https://rpc.example.test/" ${envs%% PATH=*} PATH="${envs##*PATH=}"
    bash "$DNR/collect.sh" --out "$outdir" --confirmed --max-pages 1 -- "$A_ADDR" ) > "$TT/rd.out" 2>&1
  c1=$?
  ( export RPC_URL="https://rpc.example.test/" ${envs%% PATH=*} PATH="${envs##*PATH=}"
    bash "$DNR/snapshot-program.sh" "$PID" "$snapdir" ) >> "$TT/rd.out" 2>&1
  c2=$?
  if [[ "$c1" == 2 && "$c2" == 2 ]] && [[ "$(grep -c 'refusing' "$TT/rd.out")" == 2 ]]; then
    ok "run dir: $label -> collect and snapshot refuse (exit 2)"
  else
    bad "run dir: $label -> collect exit $c1, snapshot exit $c2 ($(tr '\n' ' ' < "$TT/rd.out"))"
  fi
done
chmod 0700 "$TT/pl-c/incident_9"
if [[ "$(tree_state)" == "$state_before" && -z "$(ls -A "$X/bin")" ]]; then
  ok "run dir: unverifiable runs wrote nothing, inside or outside"
else
  bad "run dir: an unverifiable run changed the tree"
fi
eq "run dir: unverifiable runs made no RPC call" "$(grep -c . "$FAKE_CURL_LOG" 2>/dev/null || true)" "$calls_before"

# ---------------------------------------------------------------------------
# 16. A second collection into an incident goes to corpus-2/, next to corpus/, and
#     is accepted; the recipes then read corpus*/ and count a transaction held by
#     both corpora once (first occurrence wins), so damage figures are not doubled.
# ---------------------------------------------------------------------------
mkdir "$TT/incident_21"
for c in corpus corpus-2; do
  ( PATH="$TT/bin:$PATH" RPC_URL="https://rpc.example.test/" \
      bash "$DNR/collect.sh" --out "$TT/incident_21/$c" --confirmed --max-pages 1 -- "$A_ADDR" ) > "$TT/incident_21.$c.out" 2>&1
  eq "two corpora: collecting into incident_21/$c succeeds" "$?" "0"
done
python3 -I "$DNR/deltas.py" lamports "$TT"/incident_21/corpus*/transactions.jsonl > /dev/null 2> "$TT/both.err"
if grep -q '^deltas.py: skipped 2 transaction(s) already read under the same signature$' "$TT/both.err"; then
  ok "two corpora: what both collections fetched is read once (2 copies skipped)"
else
  bad "two corpora: no skipped-copy note ($(tr '\n' ' ' < "$TT/both.err"))"
fi
mkdir -p "$TT/incident_22/corpus" "$TT/incident_22/corpus-2"
for c in corpus corpus-2; do cp "$FIX/same-owner-drain.jsonl" "$TT/incident_22/$c/transactions.jsonl"; done
both="$(python3 -I "$DNR/deltas.py" tokens "$TT"/incident_22/corpus*/transactions.jsonl 2>/dev/null)"
eq "two corpora: a drain held by both is counted once (3 rows, VaultPDA -140)" \
  "$(printf '%s\n' "$both" | grep -c .)/$(printf '%s\n' "$both" | owner_sum VaultPDA)" "3/-140"
for mode in tokens lamports; do
  eq "dedupe: deltas $mode over two fixtures given twice equals them once" \
    "$(python3 -I "$DNR/deltas.py" $mode "$FIX/same-owner-drain.jsonl" "$FIX/lamports-over-2-53.jsonl" "$FIX/same-owner-drain.jsonl" "$FIX/lamports-over-2-53.jsonl" 2>/dev/null)" \
    "$(python3 -I "$DNR/deltas.py" $mode "$FIX/same-owner-drain.jsonl" "$FIX/lamports-over-2-53.jsonl")"
done
eq "dedupe: frames over a fixture given twice equals the fixture once" \
  "$(python3 -I "$DNR/frames.py" "$FIX/log-newline-injection.jsonl" "$FIX/log-newline-injection.jsonl" 2>/dev/null)" "$logs"
prof2="$(bash "$DNR/profile.sh" "$FIX/clean-mixed.jsonl" "$FIX/clean-mixed.jsonl")"
eq "dedupe: profile over a corpus given twice counts each transaction once" \
  "$(printf '%s\n' "$prof2" | sed -n '/^-- transactions/,/^-- version/p' | tr -s ' ' | tr '\n' '|')" \
  "$(bash "$DNR/profile.sh" "$FIX/clean-mixed.jsonl" | sed -n '/^-- transactions/,/^-- version/p' | tr -s ' ' | tr '\n' '|')"
if printf '%s\n' "$prof2" | grep -q '^-- skipped: 3 transaction(s) already read under the same signature$'; then
  ok "dedupe: profile reports the copies it skipped"
else
  bad "dedupe: profile did not report skipped copies"
fi

# ---------------------------------------------------------------------------
# 17. profile.sh skips and counts malformed lines instead of stopping: a corpus
#     with invalid JSON and a wrongly shaped object in the middle still profiles
#     its three good transactions, exits 0, and reports the two lines it skipped.
#     A missing python3 is a named blocker.
# ---------------------------------------------------------------------------
{ sed -n 1p "$FIX/clean-mixed.jsonl"; echo 'not json {'; echo '{"transaction": "not an object"}'; sed -n '2,$p' "$FIX/clean-mixed.jsonl"; } > "$TT/malformed.jsonl"
bash "$DNR/profile.sh" "$TT/malformed.jsonl" > "$TT/malformed.out" 2>&1
eq "profile: a corpus with malformed lines still completes" "$?" "0"
eq "profile: the good transactions are all counted" \
  "$(sed -n '/^-- transactions/,/^-- version/p' "$TT/malformed.out" | tr -s ' ' | tr '\n' '|')" \
  "$(bash "$DNR/profile.sh" "$FIX/clean-mixed.jsonl" | sed -n '/^-- transactions/,/^-- version/p' | tr -s ' ' | tr '\n' '|')"
if grep -q '^-- skipped: 2 malformed line(s)' "$TT/malformed.out" && grep -q '^-- top-level programs' "$TT/malformed.out"; then
  ok "profile: the two malformed lines are counted at the end, and every section printed"
else
  bad "profile: malformed lines not reported ($(tail -n 2 "$TT/malformed.out" | tr '\n' ' '))"
fi
# The first pass runs as python3 -I: on a PATH without python3, a named blocker
# (exit 3) and no profile.
mkdir -p "$TT/prof-nopy"
for t in jq sed sort uniq awk tr cut mktemp rm cat; do
  p="$(command -v "$t" 2>/dev/null)" && [[ "$p" == /* ]] && ln -s "$p" "$TT/prof-nopy/$t"
done
if PATH="$TT/prof-nopy" "$(command -v bash)" -c 'command -v python3' >/dev/null 2>&1; then
  bad "profile: setup, python3 is still reachable through $TT/prof-nopy"
fi
PATH="$TT/prof-nopy" "$(command -v bash)" "$DNR/profile.sh" "$FIX/clean-mixed.jsonl" > "$TT/prof-nopy.out" 2> "$TT/prof-nopy.err"
code=$?
if [[ "$code" == 3 && ! -s "$TT/prof-nopy.out" ]] && grep -q '^\[blocker\] python3 is not on PATH' "$TT/prof-nopy.err"; then
  ok "profile: without python3 on PATH, a named blocker (exit 3) and no profile"
else
  bad "profile: no python3 -> exit $code ($(tr '\n' ' ' < "$TT/prof-nopy.err"))"
fi

# ---------------------------------------------------------------------------
# 18. frames.py --instructions: which instruction ran comes from the transaction's
#     runtime-recorded instruction lists, never from a log. The default mode finds
#     nothing for a program that logs nothing or one reached by CPI, and cannot tell
#     an Anchor program's "Instruction: X" from a lying program's; the ix records
#     can: their data is decoded here against the Anchor discriminator.
# ---------------------------------------------------------------------------
ixr() { python3 -I "$DNR/frames.py" --instructions "$FIX/$1.jsonl"; }
# disc8 <ix-record query>: the first 8 bytes (hex) of the selected record's base58 data
disc8() { python3 -I -c 'import json, sys
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
recs = [json.loads(l) for l in sys.stdin]
r = [x for x in recs if x["kind"] == "ix" and x["seq"] == int(sys.argv[1])][0]
n = 0
for c in r["data"]:
    n = n * 58 + B58.index(c)
raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
print(raw[:8].hex())' "$1"; }
anchor_disc() { python3 -I -c 'import hashlib, sys; print(hashlib.sha256(("global:" + sys.argv[1]).encode()).digest()[:8].hex())' "$1"; }
eq "instructions: control, the default mode yields no record for a program that logs nothing or one reached by CPI" \
  "$(python3 -I "$DNR/frames.py" "$FIX/ix-native-no-logs.jsonl" "$FIX/ix-cpi-victim.jsonl" | grep -c . || true)" "0"
eq "instructions: control, a lying program's log line equals the Anchor victim's" \
  "$(python3 -I "$DNR/frames.py" "$FIX/ix-lying-log.jsonl" | jq -r .text)" "$(python3 -I "$DNR/frames.py" "$FIX/ix-anchor-victim.jsonl" | jq -r .text)"
nat="$(ixr ix-native-no-logs)"
eq "instructions: a program that logs nothing still has its ix record, data exactly as given" \
  "$(printf '%s\n' "$nat" | jq -r 'select(.kind=="ix" and .seq==0) | "\(.program) \(.data)"')" \
  "$(jq -r '.transaction.message.instructions[0] | "\(.programId) \(.data)"' "$FIX/ix-native-no-logs.jsonl")"
eq "instructions: ... joined to its runtime invoke line (ix_seq 0, depth 1, success)" \
  "$(printf '%s\n' "$nat" | jq -r 'select(.kind=="invoke" and .seq==0) | "\(.ix_seq) \(.depth) \(.outcome)"')" "0 1 success"
eq "instructions: an RPC-parsed instruction is marked parsed-only, with what the RPC gave" \
  "$(printf '%s\n' "$nat" | jq -r 'select(.kind=="ix" and .seq==1) | "\(.data_status) \(.data) \(.program_name) \(.parsed.type)"')" "parsed-only null system transfer"
cpi="$(ixr ix-cpi-victim)"
eq "instructions: a CPI-reached victim (encoding json) is an inner ix record: program, top 0, inner 0, stack height 2" \
  "$(printf '%s\n' "$cpi" | jq -r 'select(.kind=="ix" and .seq==1) | "\(.program) \(.top) \(.inner) \(.stack_height)"')" "CpiVictim1111111111111111111111111111111111 0 0 2"
eq "instructions: ... whose data carries set_authority's discriminator" "$(printf '%s\n' "$cpi" | disc8 1)" "$(anchor_disc set_authority)"
eq "instructions: ... and whose depth-2 invoke line joins it (ix_seq 1, success)" \
  "$(printf '%s\n' "$cpi" | jq -r 'select(.kind=="invoke" and .depth==2) | "\(.ix_seq) \(.outcome)"')" "1 success"
eq "instructions: the Anchor victim's data carries set_authority's discriminator" "$(ixr ix-anchor-victim | disc8 0)" "$(anchor_disc set_authority)"
eq "instructions: the lying program's data carries deposit's discriminator, whatever its log says" "$(ixr ix-lying-log | disc8 0)" "$(anchor_disc deposit)"
eq "instructions: no ix record carries a log-derived field" \
  "$(for f in ix-native-no-logs ix-cpi-victim ix-anchor-victim ix-lying-log; do ixr "$f"; done | jq -r 'select(.kind=="ix") | keys - ["sig","ok","kind","seq","top","inner","stack_height","program","data","data_status","accounts","program_name","parsed"] | length' | sort -u)" "0"

if [[ "$fails" -ne 0 ]]; then
  echo "test-dnr: $fails assertion(s) FAILED" >&2
  exit 1
fi
echo "test-dnr: all assertions passed"
