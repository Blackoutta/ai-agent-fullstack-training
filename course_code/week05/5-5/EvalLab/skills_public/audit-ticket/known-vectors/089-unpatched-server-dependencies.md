---
id: 89
title: "Unpatched Server Dependencies"
severity: 7
category: devops
---

### 89 — Unpatched Server Dependencies
**Severity: 7** | **Real: Log4Shell (2021), Left-Pad, any known CVE in deployed deps**

Known vulnerability in production dependency → attacker uses public exploit to compromise server.

#### Verification Procedure

**Step 1: Run npm audit**
```
# Audits and registry queries run from a scratch dir OUTSIDE the target tree, on copies of
# the manifest + lockfile, so the target's .npmrc cannot steer them (OUTPUT-RULES Rule 11a)
SCRATCH=$(mktemp -d)   # outside the target tree
mkdir -p "$SCRATCH/backend" "$SCRATCH/web"
cp apps/backend/package.json apps/backend/package-lock.json "$SCRATCH/backend/"
cp apps/web/package.json apps/web/package-lock.json "$SCRATCH/web/"
(cd "$SCRATCH/backend" && npm audit --omit=dev)
(cd "$SCRATCH/web" && npm audit --omit=dev)
```
- ✅ PASS: Zero high/critical vulnerabilities
- ⚠️ PARTIAL: Only moderate or low vulnerabilities
- ❌ FAIL: High/critical vulnerabilities in production dependencies

**Step 2: Check for outdated packages**
```
# On the Step 1 copies. They have no node_modules, so Current reads MISSING:
# compare Wanted / Latest with the version the lockfile pins
(cd "$SCRATCH/backend" && npm outdated)
(cd "$SCRATCH/web" && npm outdated)
```
- ✅ PASS: All packages within 1-2 minor versions of latest
- ⚠️ PARTIAL: Some packages several versions behind
- ❌ FAIL: Major version behind with known security fixes in newer versions

**Step 3: Check Node.js version**
```
node --version
```
- ✅ PASS: Active LTS or Current release (18.x, 20.x, 22.x as of 2025)
- ❌ FAIL: End-of-life Node.js version (16.x, 14.x, etc.)

**Step 4: Check for pinned versions**
```
grep -E "\"[~^]" apps/backend/package.json apps/web/package.json | head -20
```
- ✅ PASS: Critical dependencies pinned to exact versions (no ^/~)
- ⚠️ PARTIAL: Most use ^ (caret) — gets minor updates automatically

**Step 5: Check Cargo audit (Solana program)**
```
# A copy of Cargo.lock in the Step 1 scratch dir, toolchain pinned (OUTPUT-RULES Rule 11a), stderr
# kept. cargo-audit exits 1 both for advisories and for an advisory database it cannot fetch or
# load, so the OUTCOME line decides (the FULL-AUDIT Step 3.2 recipe)
mkdir -p "$SCRATCH/rust" && cp Cargo.lock "$SCRATCH/rust/"
TC=$(cd "$SCRATCH" && rustup default | cut -d' ' -f1)   # your own toolchain, never the target's
if (cd "$SCRATCH/rust" && RUSTUP_TOOLCHAIN="$TC" cargo audit --version) >/dev/null 2>&1; then
  (cd "$SCRATCH/rust" && RUSTUP_TOOLCHAIN="$TC" cargo audit --color never) 2>&1 | tee "$SCRATCH/cargo-audit.txt"
  grep -qE '^error: [0-9]+ vulnerabilit(y|ies) found' "$SCRATCH/cargo-audit.txt" && echo "OUTCOME: vulnerabilities found"
  grep -qE '^error: .*advisory database' "$SCRATCH/cargo-audit.txt" && echo "OUTCOME: advisory DB unavailable"
else
  echo "OUTCOME: not installed"
fi
```
- ✅ PASS: no OUTCOME line and no `error:` line — zero vulnerabilities in Rust dependencies
- ❌ FAIL: `OUTCOME: vulnerabilities found` — known CVEs in Rust dependencies
- ⚠️ Not run, never a PASS: `OUTCOME: advisory DB unavailable` (Coverage & Limitations records "advisory DB unavailable", or rerun with `--no-fetch` against a local DB if one exists) or `OUTCOME: not installed` (N/A, and Coverage & Limitations says so)

**Overall verdict:**
- ✅: No audit vulnerabilities, packages up to date, LTS Node, pinned versions
- ⚠️: Some moderate vulnerabilities, packages slightly outdated
- ❌: Critical vulnerabilities in production dependencies
