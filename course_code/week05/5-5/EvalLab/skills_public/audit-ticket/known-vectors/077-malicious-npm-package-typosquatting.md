---
id: 77
title: "Malicious npm Package (Typosquatting)"
severity: 8
category: devops
---

### 77 — Malicious npm Package (Typosquatting)
**Severity: 8** | **Real: event-stream ($3.9M crypto theft, 2018), ua-parser-js (2021), colors.js (2022), `@solana/web3.js` 1.95.6 / 1.95.7 (hijacked release, Dec 2024)**

Developer installs `@solana/web3js` (typo, missing dot) instead of `@solana/web3.js` — malicious package steals private keys.

The same theft also arrives under the *correct* name. When a maintainer's publish credentials are hijacked, the attacker ships a backdoored release of the legitimate package: `@solana/web3.js` 1.95.6 and 1.95.7 (Dec 2024) were published with phished npm credentials and sent private keys from the keypair functions to the attacker (Anza RCA: https://www.anza.xyz/blog/web3-js-exploit-root-cause-analysis). Step 2 checks the known-bad releases; reviewing what a release's code actually changed before merging the bump is checklist 11 §11.11 (SC-059..062).

#### Verification Procedure

**Step 1: Audit all direct dependencies**
```
cat package.json apps/backend/package.json apps/web/package.json | grep -E "\"@|\"[a-z]" | grep -v version | sort -u
```
- Record: Complete dependency list

**Step 2: Check for known compromised packages**
```
# Check against known-bad list:
grep -iE "axios@1\.14\.1|axios@0\.30\.4" package.json apps/*/package.json package-lock.json
# Hijacked @solana/web3.js releases — exact pins and resolved versions in package-lock /
# pnpm / yarn v1 + berry / bun; ranges such as "^1.95.7" do not match on their own:
W3='web3\.js@(npm:)?1\.95\.(6|7)([^0-9]|$)|/web3\.js/-/web3\.js-1\.95\.(6|7)\.tgz|"@solana/web3\.js"[[:space:]]*:[[:space:]]*"=?1\.95\.(6|7)"'
grep -rnE "$W3" --exclude-dir=node_modules --include='package.json' --include='package-lock.json' \
  --include='pnpm-lock.yaml' --include='yarn.lock' --include='bun.lock' .
# ...and anywhere in history (OUTPUT-RULES Rule 11c flags; --text because a committed .gitattributes can mark
# lockfiles binary, which hides them from -G):
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false -c core.bigFileThreshold=512m \
  log --all --oneline --text --no-textconv --no-ext-diff -G"$W3" -- '*lock*' '*package.json'
```
- ✅ PASS: Zero matches in the tree, and either zero matches in history or evidence that every key a build from that window loaded was rotated
- ❌ FAIL: Compromised package version in the tree — CRITICAL; or a `@solana/web3.js` 1.95.6 / 1.95.7 hit in history with no evidence of rotation — every key a build containing it loaded is exposed: rotate it
- ⚠️ INCONCLUSIVE (history part): a `fatal:` or `lazy fetching disabled` line means the checkout is a partial clone with incomplete history (OUTPUT-RULES Rule 11c); the history search did not run, so it is never a PASS

**Step 3: Run npm audit**
```
# from a scratch dir OUTSIDE the target tree holding copies of package.json + the lockfile (OUTPUT-RULES Rule 11a)
npm audit --omit=dev 2>/dev/null | tail -20
```
- ✅ PASS: Zero vulnerabilities, or only low/informational
- ⚠️ PARTIAL: Moderate vulnerabilities
- ❌ FAIL: High/critical vulnerabilities

**Step 4: Check package publish dates (14-day quarantine)**
```
# For recently added packages, verify they're not brand-new (run outside the target tree, Rule 11a):
npm info @anchor-lang/core time --json 2>/dev/null | tail -5
```
- ✅ PASS: All packages' installed versions are >14 days old
- ❌ FAIL: Package version published <14 days ago

**Step 5: Check for unusual package names (typosquatting indicators)**
```
# Look for packages that look similar to popular ones:
cat package.json | grep -iE "solana|anchor|token|wallet" | head -10
```
- ✅ PASS: All packages are from official scopes (`@solana/`, `@anchor-lang/`, etc.)
- ❌ FAIL: Unscoped packages claiming to be from known projects

**Step 6: Check package sizes for anomalies**
```
du -sh node_modules/*/ 2>/dev/null | sort -rh | head -15
```
- ✅ PASS: Package sizes reasonable for their purpose
- ⚠️ PARTIAL: Unusually large package (investigate contents)

**Overall verdict:**
- ✅: No compromised packages, audit clean, all official scopes, 14-day quarantine followed
- ⚠️: Audit shows moderate issues, or some packages not yet 14 days old
- ❌: Compromised package found, or critical audit vulnerabilities
