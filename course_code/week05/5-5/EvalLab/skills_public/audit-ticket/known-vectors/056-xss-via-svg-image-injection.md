---
id: 56
title: "XSS via SVG / Image Injection"
severity: 7
category: frontend
---

### 56 — XSS via SVG / Image Injection
**Severity: 7** | **Real: Discord CDN exploitation, "vibe-coded" apps (2025-2026)**

Upload SVG containing `<script>alert(document.cookie)</script>` — when rendered, executes in victim's browser, steals sessions.

#### Verification Procedure

**Step 1: Find all file upload handling**
```
grep -rn --include="*.ts" --include="*.tsx" -iE "upload|multer|formData|input.*type.*file|FileReader" apps/
```
- If no uploads: N/A
- If uploads: proceed

**Step 2: Check MIME type validation**
```
grep -rn --include="*.ts" -iE "mimetype|content-type|accept.*image|fileFilter" apps/backend/
```
- ✅ PASS: Server validates MIME type by reading file magic bytes (not just extension or Content-Type header)
- ❌ FAIL: Only checks file extension (attacker renames .svg to .png)

**Step 3: Check SVG specifically**
```
grep -rn --include="*.ts" -iE "svg|image/svg" apps/
```
- ✅ PASS: SVG uploads rejected, or SVG content sanitized (DOMPurify with SVG profile, stripping `<script>`, `<foreignObject>`, event handlers)
- ❌ FAIL: SVG accepted and served as-is

**Step 4: Check how uploaded images are served**
```
grep -rn --include="*.ts" --include="*.tsx" -iE "blob\.|createObjectURL|data:image" apps/web/
```
- ✅ PASS: Images served from separate domain (CDN) or with `Content-Disposition: attachment` or sandboxed in iframe
- ❌ FAIL: User-uploaded images served from same origin as app

**Step 5: Check for Content-Security-Policy on image display**
```
grep -rn --include="*.ts" --include="*.tsx" "Content-Security-Policy\|img-src" apps/
```
- ✅ PASS: CSP restricts script execution even if SVG slips through
- ⚠️ PARTIAL: CSP exists but allows `unsafe-inline`

**Step 6: Check for `<img>` tag vs direct SVG rendering**
```
grep -rn --include="*.tsx" -E "<img.*src=|dangerouslySetInnerHTML" apps/web/ | grep -iE "upload\|user\|avatar\|profile"
```
- ✅ PASS: User images always in `<img>` tags (SVG scripts don't execute in `<img>`)
- ❌ FAIL: User SVG content rendered via `dangerouslySetInnerHTML` or inline SVG

**Overall verdict:**
- ✅: MIME validation by magic bytes, SVG rejected or sanitized, images in `<img>` tags, separate origin
- ⚠️: SVG sanitized but served from same origin
- ❌: SVG uploaded and rendered without sanitization
- N/A: No file uploads
