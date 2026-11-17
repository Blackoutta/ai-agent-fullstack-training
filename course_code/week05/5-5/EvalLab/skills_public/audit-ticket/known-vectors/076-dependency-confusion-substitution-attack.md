---
id: 76
title: "Dependency Confusion (Substitution Attack)"
severity: 9
category: devops
---

### 76 — Dependency Confusion (Substitution Attack)
**Severity: 9** | **Real: Alex Birsan attack ($130K+ bounties) on Apple, Microsoft, PayPal (2021)**

Attacker publishes a public npm package with the same name as an internal/private package but higher version. `npm install` fetches the public (malicious) version.

#### Verification Procedure

**Step 1: Check for private/scoped packages**
```
grep -rn "\"name\":" packages/*/package.json apps/*/package.json
```
- Record: All package names — are they scoped (`@scope/pkg`) or unscoped?

**Step 2: Verify scoped registry config**
```
cat .npmrc 2>/dev/null; cat apps/backend/.npmrc 2>/dev/null; cat apps/web/.npmrc 2>/dev/null
```
- ✅ PASS: Private packages use scoped names (`@myorg/pkg`) AND `.npmrc` points scope to private registry
- ❌ FAIL: Unscoped private package names (anyone can publish same name publicly)

**Step 3: Check lockfile integrity**
```
# Verify lockfile is committed and resolved registries are expected
grep "resolved" package-lock.json | sort -u | head -20
```
- ✅ PASS: All resolved URLs point to expected registries (npmjs.org or private registry)
- ❌ FAIL: Unexpected registry URLs in lockfile

**Step 4: Check for install scripts in dependencies**
```
# Malicious packages often use postinstall scripts
npm ls --all 2>/dev/null | head -5
grep -r "postinstall\|preinstall" node_modules/*/package.json 2>/dev/null | grep -v "node_modules/.*node_modules" | head -20
```
- ✅ PASS: No suspicious install scripts, or `--ignore-scripts` used for untrusted packages
- ⚠️ PARTIAL: Some install scripts from well-known packages (expected)

**Step 5: Check for package-lock.json in repo**
```
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false ls-files package-lock.json   # Rule 11c flags
```
- ✅ PASS: Lockfile is committed (prevents resolution attacks)
- ❌ FAIL: Lockfile not committed — every install resolves fresh

**Overall verdict:**
- ✅: Scoped packages, private registry configured, lockfile committed, no suspicious scripts
- ⚠️: Lockfile committed, packages well-known, but not scoped
- ❌: Unscoped private packages, no lockfile, or unexpected registries
