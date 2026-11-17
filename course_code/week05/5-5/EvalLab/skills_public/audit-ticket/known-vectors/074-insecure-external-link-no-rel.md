---
id: 74
title: "Insecure External Link (no rel)"
severity: 3
category: frontend
---

### 74 — Insecure External Link (no rel)
**Severity: 3** | **Real: Reverse tabnabbing attack**

`target="_blank"` without `rel="noopener noreferrer"` — opened page can redirect the opener.

#### Verification Procedure

**Step 1: Find all external links with target="_blank"**
```
grep -rn --include="*.tsx" 'target="_blank"' apps/web/
```
- Record: All external links

**Step 2: Check for rel attribute**
```
grep -rn --include="*.tsx" 'target="_blank"' apps/web/ | grep -v "noopener"
```
- ✅ PASS: Zero results — all `target="_blank"` links have `rel="noopener noreferrer"`
- ❌ FAIL: Any `target="_blank"` without `rel="noopener noreferrer"`

**Step 3: Check for Next.js Link component**
```
grep -rn --include="*.tsx" "<Link.*target" apps/web/ | head -10
```
- Note: Next.js 13+ automatically adds `rel="noopener noreferrer"` for external links with `target="_blank"`
- ✅ PASS: Using Next.js Link component (auto-protection)
- ⚠️ PARTIAL: Mix of Next.js Link and raw `<a>` tags

**Overall verdict:**
- ✅: All external links have noopener noreferrer, or using Next.js Link
- ⚠️: Most correct with 1-2 missing (low severity)
- ❌: Many external links without rel attribute
