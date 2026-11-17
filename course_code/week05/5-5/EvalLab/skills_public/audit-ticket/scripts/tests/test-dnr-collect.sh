#!/usr/bin/env bash
# test-dnr-collect.sh — self-test for the two networked D&R steps, collect.sh and
# snapshot-program.sh, against stand-ins for curl, jq and the solana CLI.
#
# Runnable from the repo root with bash >= 3.2, using only jq / python3 / awk / sed.
# No network. CI (corpus-check.yml) runs every scripts/tests/*.sh. test-dnr.sh
# covers the offline recipes and the gating, redaction and run-directory checks;
# this suite covers what the two scripts collect and keep.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DNR="$HERE/../dnr"
FIX="$DNR/fixtures"
fails=0
ok()   { printf 'ok   %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1" >&2; fails=$((fails+1)); }
eq()   { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1: expected '$3', got '$2'"; fi; }

for tool in jq python3 awk sed; do
  command -v "$tool" >/dev/null 2>&1 || { echo "test-dnr-collect: missing required tool: $tool" >&2; exit 3; }
done
TT="$(mktemp -d "${TMPDIR:-/tmp}/dnr_collect_test.XXXXXX")" || exit 3
trap 'rm -rf "$TT"' EXIT
# The stand-ins run on the real interpreter by absolute path, so python3 can be
# left off PATH for the scripts under test.
PY="$(python3 -I -c 'import sys; print(sys.executable)')"
A_ADDR="AddrA111111111111111111111111111111111111111"
export RPC_URL="https://rpc.example.test/"

# ---------------------------------------------------------------------------
# Stand-in RPC behind a fake curl. $FAKE_BOOK is a JSON file:
#   {"sigs": {<address>: [<getSignaturesForAddress entries, newest first>]},
#    "tx":   {<signature>: <transaction JSON text, spliced verbatim>}}
# Pages honour "limit" and "before"; FAKE_SIG_FIRST_PAGE=<n> cuts the first page
# (the one without "before") to n entries, a short page before the end of the
# history. A transaction not in "tx" is a small one
# made from its signature entry. FAKE_TX_FAIL=<mode>[:<k>] fails every k-th
# getTransaction call (every call when k is left out): transport (curl exit 28),
# rpc429 (JSON-RPC error 429) or null (result null). Every request is appended
# to $FAKE_CURL_LOG.
# ---------------------------------------------------------------------------
mkdir -p "$TT/bin"
printf '#!/bin/sh\nexec "%s" -I "$0.py" "$@"\n' "$PY" > "$TT/bin/curl"
cat > "$TT/bin/curl.py" <<'PY'
import json, os, re, sys
args = sys.argv[1:]
url = ""
if args[args.index("-K") + 1] == "-":
    for line in sys.stdin:
        m = re.match(r'\s*url\s*=\s*"(.*)"\s*$', line)
        url = m.group(1) if m else url
if not url:
    sys.stderr.write("curl: no URL specified\n"); sys.exit(2)
req = json.loads(args[args.index("--data-raw") + 1])
m, p = req["method"], req["params"]
log = os.environ["FAKE_CURL_LOG"]
with open(log, "a") as f:
    f.write(json.dumps({"method": m, "params": p}) + "\n")
book = json.load(open(os.environ["FAKE_BOOK"]))
def reply(member):
    sys.stdout.write('{"jsonrpc":"2.0","id":1,' + member + '}'); sys.exit(0)
if m == "getSignaturesForAddress":
    entries = book["sigs"].get(p[0], [])
    names = [e["signature"] for e in entries]
    start = names.index(p[1]["before"]) + 1 if p[1].get("before") in names else 0
    limit = p[1]["limit"]
    if "before" not in p[1] and os.environ.get("FAKE_SIG_FIRST_PAGE"):
        limit = min(limit, int(os.environ["FAKE_SIG_FIRST_PAGE"]))
    reply('"result":' + json.dumps(entries[start:start + limit]))
if m == "getTransaction":
    calls = sum(1 for line in open(log) if '"getTransaction"' in line)
    mode, _, every = os.environ.get("FAKE_TX_FAIL", "").partition(":")
    if mode and calls % int(every or 1) == 0:
        if mode == "transport":
            sys.stderr.write("curl: (28) Operation timed out after 60000 milliseconds with 0 bytes received\n"); sys.exit(28)
        if mode == "rpc429":
            reply('"error":{"code":429,"message":"Too many requests for a specific RPC call"}')
        reply('"result":null')
    raw = book.get("tx", {}).get(p[0])
    if raw is None:
        slot = next(e["slot"] for es in book["sigs"].values() for e in es if e["signature"] == p[0])
        raw = json.dumps({"slot": slot, "meta": {"err": None}, "transaction": {"signatures": [p[0]]}})
    reply('"result":' + raw)
reply('"error":{"code":-32601,"message":"Method not found"}')
PY
chmod +x "$TT/bin/curl"
export FAKE_CURL_LOG="$TT/curl.log" FAKE_BOOK="$TT/book.json"
# book <python expression for the "sigs" map> [<"tx" map>]: write $FAKE_BOOK.
book() {
  "$PY" -I -c 'import json, sys
print(json.dumps({"sigs": eval(sys.argv[1]), "tx": eval(sys.argv[2] or "{}")}))' "$1" "${2:-}" > "$FAKE_BOOK"
}
# collect <out dir> <args...>: run collect.sh against the stand-in, output in <out>.out.
collect() {
  local out="$1"; shift
  ( PATH="$TT/bin:$PATH" bash "$DNR/collect.sh" --out "$out" --confirmed "$@" ) > "$out.out" 2>&1
}
calls() { if [[ -f "$FAKE_CURL_LOG" ]]; then grep -c "\"$1\"" "$FAKE_CURL_LOG"; else echo 0; fi; }
sigs_of() { jq -r '.transaction.signatures[0]' "$1" 2>/dev/null | tr '\n' ' '; }

# A jq 1.6 stand-in, first on PATH from $TT/jq16: it reads every input number as
# an IEEE-754 double and prints it the way jq 1.6 does (the shortest digits that
# round-trip, in exponent form for very large or very small magnitudes), then runs
# the filter in the real jq.
export REAL_JQ="$(command -v jq)"
mkdir -p "$TT/jq16"
printf '#!/bin/sh\nexec "%s" -I "$0.py" "$@"\n' "$PY" > "$TT/jq16/jq"
cat > "$TT/jq16/jq.py" <<'PY'
import json, os, subprocess, sys
from decimal import Decimal
args = sys.argv[1:]
if args == ["--version"]:
    print("jq-1.6"); sys.exit(0)
opts, rest, i = [], [], 0
while i < len(args):
    if args[i] in ("--arg", "--argjson"):
        opts += args[i:i + 3]; i += 3
    elif args[i].startswith("-") and len(args[i]) > 1:
        opts.append(args[i]); i += 1
    else:
        rest.append(args[i]); i += 1
text = "".join(open(f).read() for f in rest[1:]) if len(rest) > 1 else sys.stdin.read()
def num(x):
    if x != x:
        return "null"
    x = max(min(x, 1.7976931348623157e308), -1.7976931348623157e308)
    if x == 0:
        return "-0" if str(x).startswith("-") else "0"
    sign, digits, exp = Decimal(repr(x)).normalize().as_tuple()
    ds = "".join(map(str, digits)); nd = len(ds); dp = nd + exp
    s = "-" if sign else ""
    if dp <= -4 or dp > nd + 15:
        e = dp - 1
        return s + ds[0] + ("." + ds[1:] if nd > 1 else "") + "e" + ("-" if e < 0 else "+") + "%02d" % abs(e)
    if dp <= 0:
        return s + "0." + "0" * -dp + ds
    if dp >= nd:
        return s + ds + "0" * (dp - nd)
    return s + ds[:dp] + "." + ds[dp:]
def dump(v):
    if isinstance(v, float):
        return num(v)
    if isinstance(v, list):
        return "[" + ",".join(dump(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k) + ":" + dump(x) for k, x in v.items()) + "}"
    return json.dumps(v)
try:
    dec, outs, pos = json.JSONDecoder(parse_int=float, parse_float=float), [], 0
    while True:
        while pos < len(text) and text[pos] in " \t\r\n":
            pos += 1
        if pos >= len(text):
            break
        v, pos = dec.raw_decode(text, pos)
        outs.append(dump(v))
    text = "".join(o + "\n" for o in outs)
except ValueError:
    pass  # not JSON: the real jq reports it
sys.exit(subprocess.run([os.environ["REAL_JQ"]] + opts + rest[:1], input=text.encode()).returncode)
PY
chmod +x "$TT/jq16/jq"
# $TT/nopy: the tools the two scripts run, linked one by one, python3 left out.
mkdir -p "$TT/nopy"
for t in bash env dirname basename find git mkdir mktemp rm sed awk tr sort grep cat cut head od cmp cp mv ln ls chmod wc; do
  p="$(command -v "$t" 2>/dev/null)" && [[ "$p" == /* ]] && ln -s "$p" "$TT/nopy/$t"
done
if PATH="$TT/nopy" command -v python3 >/dev/null 2>&1; then
  bad "setup: python3 is still reachable through $TT/nopy"
fi

# ---------------------------------------------------------------------------
# 1. Fetch order is the same in every locale: newest slot first and, within a
#    slot, the RPC's own order, so --max-tx keeps the same transactions whatever
#    the caller's collation.
# ---------------------------------------------------------------------------
book '{"'"$A_ADDR"'": [
  {"signature": "SigTop", "slot": 60, "err": None, "blockTime": 1700000600},
  {"signature": "SigBeta", "slot": 50, "err": None, "blockTime": 1700000500},
  {"signature": "sigalpha", "slot": 50, "err": None, "blockTime": 1700000500},
  {"signature": "SigAlpha", "slot": 50, "err": None, "blockTime": 1700000500},
  {"signature": "Sig_x", "slot": 50, "err": None, "blockTime": 1700000500},
  {"signature": "SigLow", "slot": 40, "err": None, "blockTime": 1700000400}]}'
LC_ALL=C collect "$TT/loc-c" --max-tx 3 -- "$A_ADDR"
eq "order: --max-tx 3 keeps the newest slot, then the RPC's order within slot 50 (LC_ALL=C)" \
  "$(sigs_of "$TT/loc-c/transactions.jsonl")|$(cut -f1 "$TT/loc-c/collection-gaps.tsv")" "SigTop SigBeta sigalpha |SigAlpha"
utf8="$(locale -a 2>/dev/null | grep -i -m1 -E '^en_US\.utf-?8$' || true)"
if [[ -n "$utf8" ]]; then
  LC_ALL="$utf8" collect "$TT/loc-u" --max-tx 3 -- "$A_ADDR"
  if cmp -s "$TT/loc-c/transactions.jsonl" "$TT/loc-u/transactions.jsonl" \
     && cmp -s "$TT/loc-c/collection-gaps.tsv" "$TT/loc-u/collection-gaps.tsv"; then
    ok "order: identical corpus and gap rows under C and $utf8"
  else
    bad "order: $utf8 gave '$(sigs_of "$TT/loc-u/transactions.jsonl")', C gave '$(sigs_of "$TT/loc-c/transactions.jsonl")'"
  fi
else
  ok "order: en_US.UTF-8 is not installed here; the second-locale run is skipped"
fi

# ---------------------------------------------------------------------------
# 2. Integers above 2^53 reach transactions.jsonl exactly, on any jq. The
#    stand-in RPC splices the fixture's text verbatim, so the big literals reach
#    the collector as written. With a jq that rounds (the 1.6 stand-in), python3
#    -I writes the corpus; with no python3 either, the run stops before any call.
# ---------------------------------------------------------------------------
BIG="$FIX/lamports-over-2-53.jsonl"
eq "jq 1.6 stand-in: reports its version" "$(PATH="$TT/jq16:$PATH" jq --version)" "jq-1.6"
rounded="$(PATH="$TT/jq16:$PATH" jq -c . "$BIG")"
case "$rounded" in
  *'"preBalances":[100000,9007199254740992,12345678901234568]'*) ok "jq 1.6 stand-in: rounds the fixture's balances (control)" ;;
  *) bad "jq 1.6 stand-in: the fixture came back unrounded ($rounded)" ;;
esac
book '{"'"$A_ADDR"'": [{"signature": "SigBigLamports", "slot": 403, "err": None, "blockTime": 1700000700}]}' \
     '{"SigBigLamports": open("'"$BIG"'").read().strip()}'
collect "$TT/big-jq" -- "$A_ADDR"
if cmp -s "$TT/big-jq/transactions.jsonl" "$BIG"; then ok "exact: this jq writes the fixture byte for byte"; else bad "exact: this jq changed the fixture ($(cat "$TT/big-jq/transactions.jsonl"))"; fi
( PATH="$TT/jq16:$TT/bin:$PATH" bash "$DNR/collect.sh" --out "$TT/big-16" --confirmed -- "$A_ADDR" ) > "$TT/big-16.out" 2>&1
eq "exact: with jq 1.6 the run still exits 0" "$?" "0"
if cmp -s "$TT/big-16/transactions.jsonl" "$BIG"; then
  ok "exact: with jq 1.6, python3 -I writes the fixture byte for byte"
else
  bad "exact: the jq 1.6 path changed the fixture ($(cat "$TT/big-16/transactions.jsonl"))"
fi
eq "exact: deltas.py on that corpus sees +1 for BigOne and BigTwo" \
  "$(python3 -I "$DNR/deltas.py" lamports "$TT/big-16/transactions.jsonl" | awk -F'\t' '$2=="BigOne"||$2=="BigTwo"{print $2"="$3}' | tr '\n' ' ')" \
  "BigOne=1 BigTwo=1 "
# The python3 that writes the corpus runs isolated: a json.py planted in the
# working directory and on PYTHONPATH never loads.
mkdir -p "$TT/evil"; printf 'open(%s, "a").write("json\\n")\n' "'$TT/shadow.marker'" > "$TT/evil/json.py"
( cd "$TT/evil" && PATH="$TT/jq16:$TT/bin:$PATH" PYTHONPATH="$TT/evil" bash "$DNR/collect.sh" --out "$TT/big-iso" --confirmed -- "$A_ADDR" ) > "$TT/big-iso.out" 2>&1
if cmp -s "$TT/big-iso/transactions.jsonl" "$BIG" && [[ ! -e "$TT/shadow.marker" ]]; then
  ok "exact: the python3 -I path ignores a json.py in the working directory and on PYTHONPATH"
else
  bad "exact: hostile working directory changed the result or loaded json.py"
fi
before="$(calls getSignaturesForAddress)"
( PATH="$TT/jq16:$TT/bin:$TT/nopy" bash "$DNR/collect.sh" --out "$TT/big-nopy" --confirmed -- "$A_ADDR" ) > "$TT/big-nopy.out" 2>&1
code=$?
if [[ "$code" == 3 && ! -e "$TT/big-nopy" ]] && grep -q 'blocker.*rounds integers above 2^53.*python3' "$TT/big-nopy.out"; then
  ok "exact: jq 1.6 and no python3 -> named blocker (exit 3), nothing written"
else
  bad "exact: jq 1.6 without python3 -> exit $code ($(tr '\n' ' ' < "$TT/big-nopy.out"))"
fi
eq "exact: that blocker comes before any RPC call" "$(calls getSignaturesForAddress)" "$before"

# ---------------------------------------------------------------------------
# 3. collect.sh never truncates a corpus: an --out that holds any of its three
#    files, even an empty one, is refused before any call, and the file is left
#    as it was.
# ---------------------------------------------------------------------------
before="$(calls getSignaturesForAddress)"
for f in transactions.jsonl signatures.jsonl collection-gaps.tsv; do
  mkdir -p "$TT/keep-$f"; printf '{"kept":1}\n' > "$TT/keep-$f/$f"
  collect "$TT/keep-$f" -- "$A_ADDR"
  code=$?
  if [[ "$code" == 2 && "$(cat "$TT/keep-$f/$f")" == '{"kept":1}' && "$(ls "$TT/keep-$f")" == "$f" ]] \
     && grep -q "already holds a collected corpus ($f)" "$TT/keep-$f.out"; then
    ok "no clobber: an --out holding only $f is refused (exit 2), the file intact"
  else
    bad "no clobber: --out holding $f -> exit $code, now '$(cat "$TT/keep-$f/$f")', dir: $(ls "$TT/keep-$f" | tr '\n' ' ')"
  fi
done
mkdir -p "$TT/keep-empty"; : > "$TT/keep-empty/signatures.jsonl"
collect "$TT/keep-empty" -- "$A_ADDR"
eq "no clobber: an empty signatures.jsonl is refused too (exit 2)" "$?" "2"
eq "no clobber: refused runs made no RPC call" "$(calls getSignaturesForAddress)" "$before"

# ---------------------------------------------------------------------------
# 4. --max-tx counts getTransaction calls, failed ones included, and 10 failed
#    calls in a row stop the run, so a failing endpoint gets no more calls than
#    the estimate the human approved. Each run starts a fresh call log.
# ---------------------------------------------------------------------------
book '{"'"$A_ADDR"'": [{"signature": "S%02d" % k, "slot": 100 - k, "err": None, "blockTime": 1700000000 - k} for k in range(1, 26)]}'
rm -f "$FAKE_CURL_LOG"
FAKE_TX_FAIL=rpc429 collect "$TT/fail-cap" --max-tx 2 -- "$A_ADDR"
code=$?
eq "failing endpoint: --max-tx 2 makes exactly 2 getTransaction calls" "$(calls getTransaction)" "2"
eq "failing endpoint: exit 0; two error rows, then the cap row naming the third signature" \
  "$code|$(cut -f1 "$TT/fail-cap/collection-gaps.tsv" | tr '\n' ' ')|$(cut -f2 "$TT/fail-cap/collection-gaps.tsv" | sed -n 3p)" \
  "0|S01 S02 S03 |not fetched: --max-tx=2 calls reached; this and 22 older signatures in signatures.jsonl were not fetched"
rm -f "$FAKE_CURL_LOG"
FAKE_TX_FAIL=transport collect "$TT/fail-run" -- "$A_ADDR"
code=$?
eq "failing endpoint: 10 failed calls in a row stop the run (default --max-tx)" "$(calls getTransaction)/$code" "10/0"
eq "failing endpoint: the stop is a gap row naming the first signature not fetched" \
  "$(sed -n 11p "$TT/fail-run/collection-gaps.tsv")" \
  "S11$(printf '\t')not fetched: stopped after 10 getTransaction calls in a row failed (last: transport error (curl exit 28)); this and 14 older signatures in signatures.jsonl were not fetched"
if grep -q 'stopped: 10 getTransaction calls in a row failed .*the endpoint is failing (rate limit or outage.*collected 0, collection gaps 11' "$TT/fail-run.out" \
   && grep -q '^collection gaps: 11 ' "$TT/fail-run.out"; then
  ok "failing endpoint: the run says the endpoint is failing, with what it collected and the gap count"
else
  bad "failing endpoint: stop message missing ($(grep -m1 'stopped' "$TT/fail-run.out"))"
fi
rm -f "$FAKE_CURL_LOG"
FAKE_TX_FAIL=null:2 collect "$TT/fail-alt" -- "$A_ADDR"
eq "failing endpoint: failures that alternate with successes never stop the run (25 calls, 13 fetched, 12 gaps)" \
  "$(calls getTransaction)/$(grep -c . "$TT/fail-alt/transactions.jsonl")/$(grep -c . "$TT/fail-alt/collection-gaps.tsv")" "25/13/12"
rm -f "$FAKE_CURL_LOG"
FAKE_TX_FAIL=null:2 collect "$TT/fail-alt-cap" --max-tx 5 -- "$A_ADDR"
eq "failing endpoint: --max-tx 5 with every second call failing -> 5 calls, 3 fetched, cap row names S06" \
  "$(calls getTransaction)/$(grep -c . "$TT/fail-alt-cap/transactions.jsonl")/$(tail -1 "$TT/fail-alt-cap/collection-gaps.tsv" | cut -f1)" "5/3/S06"

# ---------------------------------------------------------------------------
# 5. An empty page ends an address's history. A page shorter than 1000 ends it
#    only on the cap's last page, since a node can return one before the end. A
#    page cap that stops on a full page, before --since was crossed, may have left
#    older history out, whatever --since and --until are: a notice with the
#    --before to resume from, and a gap row. These runs pass --max-tx 0 and look
#    only at the paging.
# ---------------------------------------------------------------------------
# hist <n>: <n> signatures P0001.. newest first, block times 1700005000 - k.
hist() { book '{"'"$A_ADDR"'": [{"signature": "P%04d" % k, "slot": 100000 - k, "err": None, "blockTime": 1700005000 - k} for k in range(1, '"$1"' + 1)]}'; }
trunc_row() { grep "^$A_ADDR$(printf '\t')" "$1/collection-gaps.tsv" | cut -f2; }
hist 1500; rm -f "$FAKE_CURL_LOG"
collect "$TT/pg-short" --since 1000 --max-pages 2 --max-tx 0 -- "$A_ADDR"
if [[ "$(calls getSignaturesForAddress)" == 2 && -z "$(trunc_row "$TT/pg-short")" ]] && ! grep -q 'page cap' "$TT/pg-short.out"; then
  ok "paging: a short last page at the cap (1000 + 500, --since never crossed) ends the history: no notice, no gap row"
else
  bad "paging: short last page at the cap -> $(grep -m1 'page cap' "$TT/pg-short.out")"
fi
hist 2000; rm -f "$FAKE_CURL_LOG"
collect "$TT/pg-exact" --max-pages 3 --max-tx 0 -- "$A_ADDR"
if [[ "$(calls getSignaturesForAddress)" == 3 && -z "$(trunc_row "$TT/pg-exact")" ]]; then
  ok "paging: an empty page under the cap ends the history (1000 + 1000 + 0): no gap row"
else
  bad "paging: history ending on a page boundary -> row '$(trunc_row "$TT/pg-exact")'"
fi
hist 1500; rm -f "$FAKE_CURL_LOG"
collect "$TT/pg-tail" --max-tx 0 -- "$A_ADDR"
eq "paging: a short page under the cap costs one more call, and the empty page ends the history (calls, paging notices, gap row)" \
  "$(calls getSignaturesForAddress)|$(grep -c 'older history may exist' "$TT/pg-tail.out")|$(trunc_row "$TT/pg-tail")" "3|0|"
rm -f "$FAKE_CURL_LOG"
FAKE_SIG_FIRST_PAGE=300 collect "$TT/pg-midshort" --max-tx 0 -- "$A_ADDR"
eq "paging: a short page followed by more history keeps paging (300 + 1000 + 200 + 0; calls, signatures, gap row)" \
  "$(calls getSignaturesForAddress)|$(grep -c . "$TT/pg-midshort/signatures.jsonl")|$(trunc_row "$TT/pg-midshort")" "4|1500|"
rm -f "$FAKE_CURL_LOG"
FAKE_SIG_FIRST_PAGE=300 collect "$TT/pg-capshort" --max-pages 1 --max-tx 0 -- "$A_ADDR"
eq "paging: a short page on the cap's last page ends the history quietly (calls, paging notices, gap row)" \
  "$(calls getSignaturesForAddress)|$(grep -c 'older history may exist' "$TT/pg-capshort.out")|$(trunc_row "$TT/pg-capshort")" "1|0|"
hist 2500
collect "$TT/pg-full" --max-pages 2 --max-tx 0 -- "$A_ADDR"
eq "paging: no window, the cap stops on a full page -> a gap row saying older history may exist, with the resume cursor" \
  "$(trunc_row "$TT/pg-full")" \
  "older history may exist: the page cap (--max-pages 2) stopped on a full page at blockTime 1700003000; resume into a new --out with --before P2000, or raise --max-pages"
if grep -q "older history may exist for $A_ADDR: the page cap (--max-pages 2) stopped on a full page at blockTime 1700003000 — resume into a new --out with --before P2000" "$TT/pg-full.out"; then
  ok "paging: no window, the run prints the notice"
else
  bad "paging: no notice without a window"
fi
collect "$TT/pg-until" --until 100 --max-pages 2 --max-tx 0 -- "$A_ADDR"
case "$(trunc_row "$TT/pg-until")" in
  *"blockTime 1700003000, still after --until 100, so nothing inside the window was collected; resume into a new --out with --before P2000"*)
    ok "paging: --until only, the cap stops on a full page above --until -> gap row says nothing inside the window was collected" ;;
  *) bad "paging: --until only, full page above --until -> row '$(trunc_row "$TT/pg-until")'" ;;
esac
collect "$TT/pg-until-in" --until 1700004500 --max-pages 2 --max-tx 0 -- "$A_ADDR"
case "$(trunc_row "$TT/pg-until-in")" in
  "older history may exist: the page cap (--max-pages 2) stopped on a full page at blockTime 1700003000; resume into a new --out with --before P2000, or raise --max-pages")
    ok "paging: --until only, the cap stops on a full page inside the window -> gap row" ;;
  *) bad "paging: --until only, full page inside the window -> row '$(trunc_row "$TT/pg-until-in")'" ;;
esac
hist 1500
collect "$TT/pg-until-short" --until 100 --max-pages 2 --max-tx 0 -- "$A_ADDR"
eq "paging: --until only, a short last page at the cap above --until -> no notice, no gap row" \
  "$(grep -c '^  ! ' "$TT/pg-until-short.out")|$(trunc_row "$TT/pg-until-short")" "0|"
hist 2500
collect "$TT/pg-since" --since 1700003500 --max-pages 2 --max-tx 0 -- "$A_ADDR"
eq "paging: the cap's last full page crossed --since -> no gap row" "$(trunc_row "$TT/pg-since")" ""
collect "$TT/pg-since-cap" --since 1700002000 --max-pages 2 --max-tx 0 -- "$A_ADDR"
case "$(trunc_row "$TT/pg-since-cap")" in
  *"at blockTime 1700003000, still after --since 1700002000; resume into a new --out with --before P2000"*) ok "paging: the cap stops on a full page still after --since -> gap row" ;;
  *) bad "paging: full page still after --since -> row '$(trunc_row "$TT/pg-since-cap")'" ;;
esac

# ---------------------------------------------------------------------------
# A solana CLI stand-in that answers like solana-cli 3.1.10 (Agave) did against a
# loopback RPC serving each kind of account: the same output lines and error text.
#   * a config without websocket_url is ignored (defaults: mainnet-beta, id.json);
#   * `program show` and `program-v4 show` resolve a default signer unless
#     --buffer-authority / --authority is given;
#   * `program show` / `program dump` reject a loader-v4 or non-program account
#     ("is not an SBF program"); `program-v4 show` / `download` reject anything
#     not owned by loader-v4 ("is not owned by loader-v4");
#   * an immutable loader (BPFLoader2, BPFLoader) shows no authority and no slot.
# FAKE_SOL_LOADER is v3 (upgradeable, default), v2, v1, v4 or none. FAKE_SOL_SLOTS
# is a comma list of last-deployed slots: each read of the program (show, dump,
# download) takes the next one and the last one repeats, so a deploy can land
# between two reads. The dumped ELF carries its slot, so each deploy hashes apart.
# Every call is appended to $FAKE_SOL_ARGV.
# ---------------------------------------------------------------------------
mkdir -p "$TT/sol"
printf '#!/bin/sh\nexec "%s" -I "$0.py" "$@"\n' "$PY" > "$TT/sol/solana"
cat > "$TT/sol/solana.py" <<'PY'
import json, os, re, sys
a = sys.argv[1:]
with open(os.environ["FAKE_SOL_ARGV"], "a") as log:
    log.write(json.dumps(a) + "\n")
cfg = {}
if "-C" in a:
    i = a.index("-C")
    for line in open(a[i + 1]):
        m = re.match(r'(\w+): "(.*)"$', line.rstrip("\n"))
        if m:
            cfg[m.group(1)] = m.group(2)
    del a[i:i + 2]
if "websocket_url" not in cfg:
    cfg = {"json_rpc_url": "https://api.mainnet-beta.solana.com", "keypair_path": "/home/fake/.config/solana/id.json"}
kp = cfg["keypair_path"]
if a[:3] == ["config", "get", "keypair"]:
    print(f"Key Path: {kp}"); sys.exit(0)
def fail(msg):
    sys.stderr.write(f"Error: {msg}\n"); sys.exit(1)
def opt(name):
    return a[a.index(name) + 1] if name in a else None
OWNERS = {"v3": "BPFLoaderUpgradeab1e11111111111111111111111", "v2": "BPFLoader2111111111111111111111111111111111",
          "v1": "BPFLoader1111111111111111111111111111111111", "v4": "LoaderV411111111111111111111111111111111111",
          "none": "11111111111111111111111111111111"}
loader = os.environ.get("FAKE_SOL_LOADER", "v3")
AUTH = "p2Yicb86aZig616Eav2VWG9vuXR5mEqhtzshZYBxzsV"
def read_slot():
    if loader in ("v1", "v2"):
        return 0
    slots = os.environ.get("FAKE_SOL_SLOTS", "12345").split(",")
    path = os.environ["FAKE_SOL_READS"]
    n = int(open(path).read()) if os.path.exists(path) else 0
    open(path, "w").write(str(n + 1))
    return int(slots[min(n, len(slots) - 1)])
def elf(slot):
    return b"\x7fELF" + slot.to_bytes(8, "little") + bytes(range(1, 40)) + b"\0" * 300
def length(data):
    return f"{len(data)} ({len(data):#x}) bytes"
def no_signer():
    fail(f'Dynamic program error: No default signer found, run "solana-keygen new -o {kp}" to create a new one')
cmd = a[:2]
if cmd == ["program", "show"] or cmd == ["program-v4", "show"]:
    if opt("--buffer-authority" if cmd[0] == "program" else "--authority") is None and not os.path.exists(kp):
        no_signer()
pid = a[2] if cmd[0] == "program" else opt("--program-id")
if cmd in (["program", "show"], ["program", "dump"]) and loader in ("v4", "none"):
    fail(f"{pid} is not an SBF program")
if cmd[0] == "program-v4" and loader != "v4":
    fail(f"{pid} is not owned by loader-v4")
if cmd == ["program", "show"] and loader == "v3":
    slot = read_slot()
    print(f"\nProgram Id: {pid}\nOwner: {OWNERS[loader]}\nProgramData Address: YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf\n"
          f"Authority: {AUTH}\nLast Deployed In Slot: {slot}\nData Length: {length(elf(slot))}\nBalance: 0.00114144 SOL\n")
elif cmd == ["program", "show"]:
    print(f"\nProgram Id: {pid}\nOwner: {OWNERS[loader]}\nData Length: {length(elf(0))}\n")
elif cmd == ["program-v4", "show"]:
    slot = read_slot()
    print(f"\nProgram Id: {pid}\nOwner: {OWNERS[loader]}\nAuthority: {AUTH}\nLast Deployed In Slot: {slot}\n"
          f"Status: deployed\nData Length: {length(elf(slot))}\n")
elif cmd in (["program", "dump"], ["program-v4", "download"]):
    path = a[3] if cmd[0] == "program" else [x for x in a[2:] if not x.startswith("--") and x != pid][-1]
    open(path, "wb").write(elf(read_slot()))
    print(f"Wrote program to {path}")
else:
    sys.stderr.write("fake solana: refusing an unexpected subcommand\n"); sys.exit(9)
PY
chmod +x "$TT/sol/solana"
export FAKE_SOL_ARGV="$TT/sol.argv" FAKE_SOL_READS="$TT/sol.reads"
PID="ProgTest11111111111111111111111111111111111"   # base58, 32 bytes
# snap <dir> [var=value ...]: run snapshot-program.sh on a fresh read counter,
# output in <dir>.out; extra variables go to the stand-in.
snap() {
  local dir="$1"; shift
  rm -f "$FAKE_SOL_READS"
  ( export "$@" PATH="$TT/sol:$TT/bin:$PATH"; bash "$DNR/snapshot-program.sh" "$PID" "$dir" ) > "$dir.out" 2>&1
}
cli_calls() { if [[ -f "$FAKE_SOL_ARGV" ]]; then grep -c . "$FAKE_SOL_ARGV"; else echo 0; fi; }
names() { ls "$1" | LC_ALL=C sort | tr '\n' ' '; }   # a directory's entries, in byte order

# ---------------------------------------------------------------------------
# 6. snapshot-program.sh needs python3 (the id check and the hash): with none on
#    PATH it stops with a named blocker (exit 3) before the CLI runs, and writes
#    nothing.
# ---------------------------------------------------------------------------
before="$(cli_calls)"
( PATH="$TT/sol:$TT/nopy" bash "$DNR/snapshot-program.sh" "$PID" "$TT/nopy-inc" ) > "$TT/nopy-inc.out" 2>&1
code=$?
if [[ "$code" == 3 && ! -e "$TT/nopy-inc" ]] && grep -q '^\[blocker\] python3 not on PATH' "$TT/nopy-inc.out"; then
  ok "snapshot: no python3 -> named blocker (exit 3), nothing written"
else
  bad "snapshot: no python3 -> exit $code ($(tr '\n' ' ' < "$TT/nopy-inc.out"))"
fi
eq "snapshot: no CLI call before the python3 check" "$(cli_calls)" "$before"

# ---------------------------------------------------------------------------
# 7. A snapshot is never overwritten. The first one is bin/<id>.so + .show.txt;
#    a later run at the same slot and hash prints "unchanged" and rewrites
#    nothing; a later run at another slot keeps bin/<id>@<slot>.so + .show.txt
#    beside the first and prints both lines; a name already taken is a blocker.
# ---------------------------------------------------------------------------
K="$TT/keep/incident_1"; mkdir -p "$TT/keep"
snap "$K" FAKE_SOL_SLOTS=100
code=$?
line1="$(cat "$K.out")"
if [[ "$code" == 0 && -s "$K/bin/$PID.so" && -s "$K/bin/$PID.show.txt" ]] \
   && [[ "$line1" == "program=$PID "*"last_deployed_slot=100 "*" file=bin/$PID.so" ]]; then
  ok "keep: the first snapshot is bin/<id>.so + bin/<id>.show.txt, one ledger line"
else
  bad "keep: first snapshot -> exit $code ($line1)"
fi
cp "$K/bin/$PID.so" "$TT/first.so"; cp "$K/bin/$PID.show.txt" "$TT/first.show"
touch -t 200001010000 "$K/bin/$PID.so" "$K/bin/$PID.show.txt"; touch -t 200101010000 "$TT/ref2001"
snap "$K" FAKE_SOL_SLOTS=100
code=$?
eq "keep: same slot and hash -> exit 0, 'unchanged', then the first snapshot's line" \
  "$code|$(sed -n 1p "$K.out")|$(sed -n 2p "$K.out")" \
  "0|unchanged: the program on-chain matches bin/$PID.so (same last-deployed slot and zero-trimmed sha256); nothing written|$line1"
eq "keep: an unchanged run rewrites nothing and adds nothing" \
  "$(find "$K/bin" -type f -newer "$TT/ref2001" | wc -l | tr -d ' ')|$(names "$K/bin")" "0|$PID.show.txt $PID.so "
snap "$K" FAKE_SOL_SLOTS=200
code=$?
if [[ "$code" == 0 ]] && cmp -s "$K/bin/$PID.so" "$TT/first.so" && cmp -s "$K/bin/$PID.show.txt" "$TT/first.show" \
   && [[ -s "$K/bin/$PID@200.so" && -s "$K/bin/$PID@200.show.txt" ]] && ! cmp -s "$K/bin/$PID@200.so" "$TT/first.so"; then
  ok "keep: a redeploy (slot 200) is kept as bin/<id>@200.so; bin/<id>.so and its .show.txt are untouched"
else
  bad "keep: redeploy -> exit $code, bin: $(ls "$K/bin" | tr '\n' ' ')"
fi
eq "keep: the redeploy run prints the first snapshot's line, then the new one" \
  "$(sed -n 2p "$K.out")|$(sed -n 3p "$K.out" | grep -o 'last_deployed_slot=200 .* file=bin/.*$' | sed 's/sha256_zero_trimmed=[0-9a-f]* //')" \
  "$line1|last_deployed_slot=200 authority=p2Yicb86aZig616Eav2VWG9vuXR5mEqhtzshZYBxzsV elf_bytes=51 padding_bytes=300 file=bin/$PID@200.so"
snap "$K" FAKE_SOL_SLOTS=200
eq "keep: a run at slot 200 again matches bin/<id>@200.so" "$?|$(sed -n 1p "$K.out" | cut -d' ' -f1-6)" "0|unchanged: the program on-chain matches bin/$PID@200.so"
printf 'other bytes\n' > "$K/bin/$PID@300.so"
snap "$K" FAKE_SOL_SLOTS=300
code=$?
if [[ "$code" == 3 && "$(cat "$K/bin/$PID@300.so")" == "other bytes" && ! -e "$K/bin/$PID@300.show.txt" ]] \
   && grep -q "blocker.*bin/$PID@300.so .*already exists.*never overwritten" "$K.out"; then
  ok "keep: a taken bin/<id>@<slot>.so is a blocker (exit 3) and stays as it was"
else
  bad "keep: taken @300 name -> exit $code ($(tr '\n' ' ' < "$K.out"))"
fi
K2="$TT/keep2/incident_1"; mkdir -p "$K2/bin"; printf 'partial\n' > "$K2/bin/$PID.show.txt"
snap "$K2" FAKE_SOL_SLOTS=100
code=$?
if [[ "$code" == 3 && "$(cat "$K2/bin/$PID.show.txt")" == partial && ! -e "$K2/bin/$PID.so" ]]; then
  ok "keep: a bin/<id>.show.txt without its .so is a blocker (exit 3), left as it was"
else
  bad "keep: lone show.txt -> exit $code, bin: $(ls "$K2/bin" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 8. Every loader the CLI knows: upgradeable (program show / dump), immutable
#    (no slot, no authority) and loader-v4 (program-v4 show / download, after
#    `program show` rejects it). An account under none of them is a blocker that
#    shows both CLI errors; an id that is not 32 bytes is refused before the CLI.
# ---------------------------------------------------------------------------
L="$TT/loaders"; mkdir -p "$L"; rm -f "$FAKE_SOL_ARGV"
snap "$L/v4" FAKE_SOL_LOADER=v4 FAKE_SOL_SLOTS=777
code=$?
case "$code|$(cat "$L/v4.out")" in
  "0|program=$PID owner=LoaderV411111111111111111111111111111111111 last_deployed_slot=777 authority=p2Yicb86aZig616Eav2VWG9vuXR5mEqhtzshZYBxzsV sha256_zero_trimmed="*" elf_bytes=51 padding_bytes=300 file=bin/$PID.so")
    ok "loader-v4: snapshotted (exit 0) with its owner, deploy slot and authority" ;;
  *) bad "loader-v4: exit $code ($(tr '\n' ' ' < "$L/v4.out"))" ;;
esac
eq "loader-v4: the CLI calls, in order" \
  "$(jq -r 'map(select(. != "-C" and (test("cli.yml$") | not) and (test("dump.so$") | not))) | join(" ")' "$FAKE_SOL_ARGV" | grep -v '^config ' | tr '\n' '|')" \
  "program show $PID --buffer-authority 11111111111111111111111111111111|program-v4 show --program-id $PID --authority 11111111111111111111111111111111|program-v4 download --program-id $PID|program-v4 show --program-id $PID --authority 11111111111111111111111111111111|"
snap "$L/v4" FAKE_SOL_LOADER=v4 FAKE_SOL_SLOTS=900
eq "loader-v4: a redeploy is kept beside the first snapshot" "$?|$(names "$L/v4/bin")" \
  "0|$PID.show.txt $PID.so $PID@900.show.txt $PID@900.so "
for ld in v2 v1; do
  snap "$L/$ld" FAKE_SOL_LOADER="$ld"
  code=$?
  case "$code|$(cat "$L/$ld.out")" in
    "0|program=$PID owner=BPFLoader"*" last_deployed_slot=n/a (immutable loader) authority=none sha256_zero_trimmed="*" file=bin/$PID.so")
      ok "immutable loader ($ld): last_deployed_slot=n/a (immutable loader), no authority" ;;
    *) bad "immutable loader ($ld): exit $code ($(tr '\n' ' ' < "$L/$ld.out"))" ;;
  esac
done
snap "$L/v2" FAKE_SOL_LOADER=v2
eq "immutable loader: a second run is 'unchanged'" "$?|$(sed -n 1p "$L/v2.out" | cut -d' ' -f1)" "0|unchanged:"
snap "$L/none" FAKE_SOL_LOADER=none
code=$?
if [[ "$code" == 3 && ! -e "$L/none/bin" ]] && grep -q 'neither solana program show nor program-v4 show reads' "$L/none.out" \
   && grep -q "Error: $PID is not an SBF program" "$L/none.out" && grep -q "Error: $PID is not owned by loader-v4" "$L/none.out"; then
  ok "no program: a blocker (exit 3) with both CLI errors, nothing written"
else
  bad "no program: exit $code ($(tr '\n' ' ' < "$L/none.out"))"
fi
before="$(cli_calls)"
( PATH="$TT/sol:$TT/bin:$PATH" bash "$DNR/snapshot-program.sh" "ProgTest1111111111111111111111111111111111" "$L/short" ) > "$L/short.out" 2>&1
code=$?
if [[ "$code" == 2 && ! -e "$L/short" ]] && grep -q 'does not decode to a 32-byte public key' "$L/short.out"; then
  ok "id check: a base58 id of 31 bytes is refused (exit 2), nothing written"
else
  bad "id check: 31-byte id -> exit $code ($(tr '\n' ' ' < "$L/short.out"))"
fi
eq "id check: no CLI call for that id" "$(cli_calls)" "$before"

# ---------------------------------------------------------------------------
# 9. The slot and the bytes agree. The slot is read again after the dump; a
#    deploy that lands in between means one more dump, and a slot that moves
#    again is a blocker. The stand-in's ELF carries its slot at bytes 4..12, so
#    the kept bytes can be checked against the reported slot.
# ---------------------------------------------------------------------------
elf_slot() { python3 -I -c 'import sys; print(int.from_bytes(open(sys.argv[1], "rb").read()[4:12], "little"))' "$1"; }
R="$TT/race"; mkdir -p "$R"; rm -f "$FAKE_SOL_ARGV"
snap "$R/still" FAKE_SOL_SLOTS=100
eq "slot check: a program that does not move is shown, dumped and shown again (3 program calls, no retry)" \
  "$?|$(grep -c '"program' "$FAKE_SOL_ARGV")|$(grep -c 'dumping again' "$R/still.out")" "0|3|0"
snap "$R/once" FAKE_SOL_SLOTS=100,200
code=$?
if [[ "$code" == 0 ]] && grep -q "the last-deployed slot of $PID moved during the dump (100 -> 200); dumping again" "$R/once.out" \
   && grep -q "^program=$PID .* last_deployed_slot=200 " "$R/once.out" && [[ "$(elf_slot "$R/once/bin/$PID.so")" == 200 ]]; then
  ok "slot check: a deploy during the dump -> one more dump; the kept bytes are slot 200's, and the line says 200"
else
  bad "slot check: one deploy during the dump -> exit $code ($(tr '\n' ' ' < "$R/once.out"))"
fi
snap "$R/twice" FAKE_SOL_SLOTS=100,200,300,400,500
code=$?
if [[ "$code" == 3 && ! -e "$R/twice/bin" ]] && grep -q "blocker.*moved during both dumps (100 -> 300 -> 500)" "$R/twice.out"; then
  ok "slot check: a slot that moves during both dumps is a blocker (exit 3), nothing written"
else
  bad "slot check: deploys during both dumps -> exit $code ($(tr '\n' ' ' < "$R/twice.out"))"
fi
snap "$R/v4" FAKE_SOL_LOADER=v4 FAKE_SOL_SLOTS=700,800
code=$?
if [[ "$code" == 0 ]] && grep -q "moved during the dump (700 -> 800); dumping again" "$R/v4.out" \
   && grep -q "^program=$PID owner=LoaderV4.* last_deployed_slot=800 " "$R/v4.out" && [[ "$(elf_slot "$R/v4/bin/$PID.so")" == 800 ]]; then
  ok "slot check: the loader-v4 path re-reads the slot and dumps again too"
else
  bad "slot check: loader-v4 deploy during the dump -> exit $code ($(tr '\n' ' ' < "$R/v4.out"))"
fi

if [[ "$fails" -ne 0 ]]; then
  echo "test-dnr-collect: $fails assertion(s) FAILED" >&2
  exit 1
fi
echo "test-dnr-collect: all assertions passed"
