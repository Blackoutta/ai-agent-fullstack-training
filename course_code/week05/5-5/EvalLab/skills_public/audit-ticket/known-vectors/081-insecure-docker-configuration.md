---
id: 81
title: "Insecure Docker Configuration"
severity: 7
category: devops
---

### 81 — Insecure Docker Configuration
**Severity: 7** | **Real: Containers running as root, exposed Docker sockets**

Container runs as root, no security limits, host volumes mounted — container escape gives full host access.

#### Verification Procedure

**Step 1: Find Dockerfiles**
```
find . -name "Dockerfile*" -not -path "*/node_modules/*" 2>/dev/null
```
- If no Dockerfiles: N/A
- If found: proceed

**Step 2: Check for non-root user**
```
grep -n "USER\|useradd\|adduser\|groupadd" Dockerfile* apps/*/Dockerfile* 2>/dev/null
```
- ✅ PASS: `USER nonroot` or `USER node` before CMD — container runs as non-root
- ❌ FAIL: No USER instruction — defaults to root

**Step 3: Check for secrets in Dockerfile**
```
grep -iE "ENV.*KEY|ENV.*SECRET|ENV.*PASSWORD|ARG.*KEY|COPY.*\.env" Dockerfile* apps/*/Dockerfile* 2>/dev/null
```
- ✅ PASS: No secrets in Dockerfile (passed at runtime via env vars or secrets manager)
- ❌ FAIL: Secrets baked into image layers

**Step 4: Check for minimal base image**
```
grep "^FROM" Dockerfile* apps/*/Dockerfile* 2>/dev/null
```
- ✅ PASS: Using slim/alpine/distroless base images
- ⚠️ PARTIAL: Using standard images (larger attack surface)
- ❌ FAIL: Using `latest` tag (unpredictable, could be compromised)

**Step 5: Check for .dockerignore**
```
cat .dockerignore 2>/dev/null; cat apps/backend/.dockerignore 2>/dev/null
```
- ✅ PASS: .dockerignore excludes .env, .git, node_modules, keypairs
- ❌ FAIL: No .dockerignore — entire project context sent to Docker daemon (including secrets)

**Overall verdict:**
- ✅: Non-root user, no secrets in layers, slim base, .dockerignore complete
- ⚠️: Standard base image but otherwise secure
- ❌: Root user, secrets in Dockerfile, no .dockerignore
- N/A: No Docker used
