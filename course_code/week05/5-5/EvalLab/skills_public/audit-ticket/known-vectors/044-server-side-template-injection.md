---
id: 44
title: "Server-Side Template Injection"
severity: 8
category: backend
---

### 44 — Server-Side Template Injection
**Severity: 8** | **Real: Uber bounty (2016), Jinja2/EJS/Pug exploits**

User input rendered in template engine — `{{ 7*7 }}` becomes `49`, `{{ system("whoami") }}` executes code.

#### Verification Procedure

**Step 1: Check for template engines**
```
grep -rn --include="*.ts" -iE "ejs|handlebars|pug|nunjucks|mustache|render\(|template\(" apps/backend/
```
- If no template engine: N/A (Next.js uses React, not server templates)
- If template engine: proceed

**Step 2: Check if user input is in template variables**
```
# For each render call: is user input directly in the template context?
grep -rn --include="*.ts" -A5 "render(" apps/backend/ | grep "req\.\|body\.\|query\."
```
- ✅ PASS: User input only in safe context (HTML-escaped template variables)
- ❌ FAIL: User input in raw/unescaped template blocks (`{{{ }}}`, `<%- %>`)

**Step 3: Check for dynamic template compilation**
```
grep -rn --include="*.ts" "compile\(.*req\|Template\(.*req\|render.*string.*req" apps/backend/
```
- ✅ PASS: No dynamic template compilation with user input
- ❌ FAIL: User input used in template string that gets compiled

**Overall verdict:**
- ✅: No template engine, or templates with HTML-escaped variables only
- N/A: No server-side template engine in project
- ❌: User input in unescaped templates or dynamically compiled
