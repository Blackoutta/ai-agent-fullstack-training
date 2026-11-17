---
id: 1
title: "Private Key Leak"
severity: 10
category: crypto
---

### 1 — Private Key Leak
**Severity: 10** | **Real: Ronin/Axie ($625M), Atomic Wallet ($35M), Wintermute ($160M)**

Attacker finds a private key in source code, git history, logs, CI output, or client bundle. Drains all funds instantly. No exploit needed — just a transfer.

#### Verification Procedure

**Step 1: Scan current codebase for raw secrets**
```
grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.rs" --include="*.toml" --include="*.yml" --include="*.yaml" -iE "(private.?key|secret.?key|mnemonic|seed.?phrase|BEGIN.*(RSA|EC|DSA|OPENSSH))" .
```
- ✅ PASS: Zero matches OR only references to env var names (e.g., `process.env.PRIVATE_KEY`)
- ❌ FAIL: Any actual key material (base58 string, hex string, JSON array, PEM block)

**Step 2: Scan for Solana keypair patterns**
```
grep -rn --include="*.ts" --include="*.json" -E "\[([0-9]{1,3},\s*){20,}" .
```
- ✅ PASS: Zero matches in source files (test fixtures allowed ONLY in `.gitignore`d dirs)
- ❌ FAIL: Any JSON integer array ≥32 elements that could be a keypair

**Step 3: Scan for base58 private key strings**
```
grep -rn --include="*.ts" --include="*.tsx" --include="*.env*" -E "[1-9A-HJ-NP-Za-km-z]{43,88}" . | grep -v node_modules | grep -v "Public" | head -30
```
- ✅ PASS: All matches are public keys (verified by context) or known constants
- ❌ FAIL: Any match that is a private key (44-char base58 for ed25519, 88-char for keypair)

**Step 4: Full git history scan for ever-committed secrets**
```
# Check if ANY secret-looking file was ever added to git (OUTPUT-RULES Rule 11c flags)
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  log --all --no-textconv --diff-filter=A --name-only --pretty=format:"%H %s" \
  -- "*.env" "*.env.*" "*.pem" "*-keypair.json" "*-delegate.json" "id.json" "*secret*" "*private*"
```
- ✅ PASS: Zero results
- ❌ FAIL: Any file listed → secret was committed. Even if later deleted, **it's still in history**

**Step 5: Deep git history search for key content**
```
# Search git history for actual secret values, not just filenames (OUTPUT-RULES Rule 11c flags). -S also finds
# files a committed .gitattributes marks -diff or binary, but the patch then shows only "Binary files differ":
# --text prints their content on the text-pathspec searches
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false -c core.bigFileThreshold=512m \
  log --all -p --text --no-textconv --no-ext-diff -S "BEGIN RSA PRIVATE" --oneline -- "*.ts" "*.json" "*.pem" | head -40
# whole repository, so no --text: a file marked binary shows no content here; re-run with --text limited to text pathspecs
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  log --all -p --no-textconv --no-ext-diff -S "BEGIN EC PRIVATE" --oneline | head -20
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false -c core.bigFileThreshold=512m \
  log --all -p --text --no-textconv --no-ext-diff -S "mnemonic" --oneline -- "*.ts" "*.json" "*.env" | head -20
```
- ✅ PASS: Zero matches across all three
- ❌ FAIL: Any match → key was in history. MUST rotate immediately, even if commit was reverted
- ⚠️ INCONCLUSIVE: any `fatal:` or `lazy fetching disabled` line in the output — the checkout is a partial clone with incomplete history (OUTPUT-RULES Rule 11c); record it as not checked, never as a PASS

**Step 6: Verify git-tracked files right now**
```
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  ls-files | grep -iE "\.(env|pem)$|keypair|delegate|secret|private"   # Rule 11c flags
```
- ✅ PASS: Zero results (no secret files are tracked by git)
- ❌ FAIL: Any file listed → currently tracked. Remove, add to .gitignore, rotate the secret

**Step 7: Check .gitignore completeness**
```
cat .gitignore | grep -E "\.env|\.pem|keypair|delegate|id\.json|node_modules|target"
```
- ✅ PASS: All of these patterns present: `.env`, `.env.*`, `*.pem`, `*-keypair.json`, `*-delegate.json`, `id.json`
- ❌ FAIL: Any pattern missing → secrets could be accidentally committed

**Step 8: Check NEXT_PUBLIC_ vars for secret leakage**
```
grep -rn "NEXT_PUBLIC_" --include="*.ts" --include="*.tsx" --include="*.env*" . | grep -v node_modules
```
- ✅ PASS: All NEXT_PUBLIC_ vars are truly public (RPC URL without key, program ID, network name)
- ❌ FAIL: Any NEXT_PUBLIC_ var containing a secret key, API secret, or private key

**Step 9: Check CI/CD for secret exposure**
```
grep -rn --include="*.yml" --include="*.yaml" -E "echo.*\\\$\{|echo.*secret|echo.*key|echo.*password" .github/
```
- ✅ PASS: No commands that echo secrets to logs
- ❌ FAIL: Any CI step that prints secret values

**Step 10: Pre-commit hook verification**
```
# Check for secret detection hooks
cat .pre-commit-config.yaml 2>/dev/null || echo "NO PRE-COMMIT CONFIG"
ls .husky/ 2>/dev/null || echo "NO HUSKY DIR"
cat .husky/pre-commit 2>/dev/null | grep -i "secret\|gitleaks\|detect" || echo "NO SECRET SCANNER IN HOOKS"
```
- ✅ PASS: Active pre-commit hook with gitleaks, detect-secrets, or equivalent
- ⚠️ PARTIAL: No automated scanner, but .gitignore is comprehensive
- ❌ FAIL: No pre-commit config AND .gitignore is incomplete

**Overall verdict:**
- ✅: ALL 10 steps pass
- ⚠️: Steps 1-6 pass, but 7-10 have gaps (defense-in-depth missing)
- ❌: ANY of steps 1-6 fails (active exposure exists)
