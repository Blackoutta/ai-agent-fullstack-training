---
id: 57
title: "Stored XSS (User Content)"
severity: 8
category: frontend
---

### 57 — Stored XSS (User Content)
**Severity: 8** | **Real: MySpace/Samy worm (2005), eBay, Zoom chat**

Malicious HTML stored in database → rendered for other users → JavaScript executes in their browser.

#### Verification Procedure

**Step 1: Find all user content rendering**
```
grep -rn --include="*.tsx" "dangerouslySetInnerHTML" apps/web/
```
- Record: Every use of dangerouslySetInnerHTML

**Step 2: For each dangerouslySetInnerHTML, trace the data source**
```
# For each: where does the HTML content come from?
# Is it user-generated content or system-controlled HTML?
```
- ✅ PASS: Only used with trusted/system content (e.g., CMS, markdown rendered by server)
- ❌ FAIL: Any user-generated content rendered via dangerouslySetInnerHTML

**Step 3: Check for HTML sanitization before storage**
```
grep -rn --include="*.ts" -iE "sanitize|DOMPurify|sanitize-html|xss|escape.*html" apps/
```
- ✅ PASS: User HTML is sanitized with DOMPurify or sanitize-html before storage AND before rendering
- ❌ FAIL: No sanitization pipeline

**Step 4: Check React's default escaping**
```
# React auto-escapes {variable} in JSX — but NOT dangerouslySetInnerHTML
grep -rn --include="*.tsx" "\{.*\.name\b\|\{.*\.title\b\|\{.*\.description\b" apps/web/ | head -20
```
- ✅ PASS: User text rendered via `{variable}` (React auto-escapes)
- ❌ FAIL: User text rendered via `dangerouslySetInnerHTML` or `v-html`

**Step 5: Check for markdown rendering**
```
grep -rn --include="*.tsx" -iE "markdown|remark|marked|react-markdown" apps/web/
```
- ✅ PASS: Markdown rendered via react-markdown (safe by default) or with sanitization plugin
- ❌ FAIL: Markdown converted to HTML and injected via dangerouslySetInnerHTML

**Overall verdict:**
- ✅: No dangerouslySetInnerHTML with user data, React escaping, sanitization on both sides
- ⚠️: dangerouslySetInnerHTML with sanitized content (DOMPurify)
- ❌: User content in dangerouslySetInnerHTML without sanitization
