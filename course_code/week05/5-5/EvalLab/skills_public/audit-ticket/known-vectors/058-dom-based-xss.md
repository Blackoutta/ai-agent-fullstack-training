---
id: 58
title: "DOM-Based XSS"
severity: 7
category: frontend
---

### 58 — DOM-Based XSS
**Severity: 7** | **Real: Widespread client-side exploits**

`document.write(location.hash)` or `innerHTML = window.location.search` — attacker crafts URL that executes script.

#### Verification Procedure

**Step 1: Find all dangerous DOM sinks**
```
grep -rn --include="*.tsx" --include="*.ts" "document\.write\|innerHTML\|outerHTML\|insertAdjacentHTML" apps/web/
```
- Record: Every DOM manipulation

**Step 2: Check if URL/location data flows to DOM**
```
grep -rn --include="*.tsx" --include="*.ts" "window\.location\|location\.hash\|location\.search\|useSearchParams\|searchParams" apps/web/
```
- ✅ PASS: URL params used only as React state/props (auto-escaped), never in innerHTML
- ❌ FAIL: URL parameters inserted into DOM via innerHTML or document.write

**Step 3: Check for useRouter query param injection**
```
grep -rn --include="*.tsx" -A3 "useSearchParams\|router\.query\|searchParams\.get" apps/web/
```
- ✅ PASS: Query params rendered in JSX `{param}` (auto-escaped)
- ❌ FAIL: Query params used in dangerouslySetInnerHTML or DOM manipulation

**Step 4: Check for eval-like patterns**
```
grep -rn --include="*.tsx" --include="*.ts" "eval(|Function(\|setTimeout.*string\|setInterval.*string" apps/web/
```
- ✅ PASS: No eval, no string in setTimeout/setInterval
- ❌ FAIL: eval() or string-based setTimeout with user data

**Overall verdict:**
- ✅: No DOM sinks with user input, React auto-escaping used throughout
- ⚠️: Some DOM manipulation but with sanitized data
- ❌: URL/user data flowing to innerHTML or eval
