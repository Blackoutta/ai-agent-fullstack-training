---
id: 68
title: "Subresource Integrity Bypass"
severity: 6
category: frontend
---

### 68 — Subresource Integrity Bypass
**Severity: 6** | **Real: CDN compromise → malicious script injection (British Airways, $230M fine)**

Third-party scripts loaded without SRI hash — if CDN is compromised, malicious code runs on your site.

#### Verification Procedure

**Step 1: Find third-party CDN scripts**
```
grep -rn --include="*.tsx" --include="*.html" -iE "cdn\.|unpkg\.com|cdnjs|jsdelivr|cloudflare" apps/web/
```
- If no CDN scripts: N/A (using only npm-bundled dependencies)
- If CDN: proceed

**Step 2: Check for SRI integrity attribute**
```
grep -rn --include="*.tsx" --include="*.html" -B2 -A2 "cdn\.\|unpkg\|cdnjs\|jsdelivr" apps/web/ | grep "integrity"
```
- ✅ PASS: Every CDN script has `integrity="sha384-..."` and `crossorigin="anonymous"`
- ❌ FAIL: CDN scripts without integrity attribute

**Step 3: Check for dynamic third-party script loading**
```
grep -rn --include="*.tsx" --include="*.ts" "createElement.*script\|Script src\|next/script" apps/web/ | grep -v node_modules
```
- ✅ PASS: No dynamically loaded third-party scripts, or all have integrity hash
- ❌ FAIL: Dynamically loaded scripts without SRI

**Overall verdict:**
- ✅: All CDN scripts have SRI, or no CDN scripts used
- ⚠️: Most scripts from npm bundle, 1-2 CDN without SRI
- ❌: Multiple CDN scripts without integrity hashes
- N/A: No third-party CDN scripts
