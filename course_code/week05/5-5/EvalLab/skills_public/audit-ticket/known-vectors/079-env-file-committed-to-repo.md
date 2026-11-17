---
id: 79
title: ".env File Committed to Repo"
severity: 9
category: devops
---

### 79 — .env File Committed to Repo
**Severity: 9** | **Real: Thousands of public repos with .env files**

.env file with database URLs, API keys, and private keys pushed to git. Even on private repos, any collaborator or fork has access.

#### Verification Procedure

**Step 1: Check if .env is currently tracked**
```
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false ls-files | grep -E "\.env"   # Rule 11c flags
```
- ✅ PASS: No .env files tracked
- ❌ FAIL: .env file is tracked — IMMEDIATE action: `git rm --cached .env` + rotate all secrets

**Step 2: Check .gitignore for .env patterns**
```
grep -E "\.env" .gitignore
```
- ✅ PASS: `.env`, `.env.local`, `.env.production`, `.env.*` patterns in .gitignore
- ❌ FAIL: .env not in .gitignore — any `git add .` will commit it

**Step 3: Check if .env was EVER committed**
```
# OUTPUT-RULES Rule 11c flags
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  log --all --no-textconv --diff-filter=A --name-only --pretty=format: | grep -E "\.env"
```
- ✅ PASS: .env was never committed
- ❌ FAIL: .env was committed at some point — secrets are in history, rotate ALL variables in that file

**Step 4: If .env exists, verify it's a template only**
```
cat .env.example 2>/dev/null || cat .env.sample 2>/dev/null
```
- ✅ PASS: .env.example exists with placeholder values (no real secrets), is committed
- ⚠️ PARTIAL: No .env.example — developers may not know what vars to set

**Step 5: Check for .env in deployment configs**
```
grep -rn --include="*.yaml" --include="*.yml" --include="Dockerfile" "\.env\|env_file" . | grep -v node_modules
```
- ✅ PASS: Docker/deploy configs reference env vars from runtime, not .env files copied into image
- ❌ FAIL: .env file copied into Docker image (leaks secrets in image layers)

**Overall verdict:**
- ✅: .env not tracked, complete .gitignore, never committed, .env.example with placeholders
- ⚠️: .env handled correctly now but was committed historically (rotate secrets!)
- ❌: .env currently tracked or committed — rotate ALL secrets immediately
