---
id: 41
title: "Path Traversal / LFI"
severity: 8
category: backend
---

### 41 — Path Traversal / LFI
**Severity: 8** | **Real: Multiple web app exploits, API file access**

User sends `../../../etc/passwd` — reads arbitrary files from server.

#### Verification Procedure

**Step 1: Find all file read operations**
```
grep -rn --include="*.ts" -E "readFile|readFileSync|createReadStream|readdir|stat\(" apps/backend/
```
- Record: Every file operation

**Step 2: Check if file path comes from user input**
```
# For each file operation: trace the path parameter
# Does it include req.body, req.params, or req.query?
```
- ✅ PASS: All file paths are hardcoded or from trusted source
- ❌ FAIL: Any file path includes user-controlled input

**Step 3: Check for path normalization**
```
grep -rn --include="*.ts" -iE "path\.resolve\|path\.normalize\|path\.join" apps/backend/ | grep -i "req\.\|user\.\|input"
```
- ✅ PASS: `path.resolve()` used with base directory check before any user input in path
- ❌ FAIL: `path.join('/base', userInput)` without verifying result stays inside /base

**Step 4: Check for traversal character filtering**
```
grep -rn --include="*.ts" "\.\.\/" apps/backend/
```
- ✅ PASS: User input is validated to not contain `..`, `/`, or `\` before use in path
- ❌ FAIL: No traversal character filtering

**Step 5: Check static file serving**
```
grep -rn --include="*.ts" "express\.static\|serveStatic" apps/backend/
```
- ✅ PASS: Static files served from explicit directory with express.static (built-in traversal protection)
- ❌ FAIL: Custom file serving without traversal protection

**Overall verdict:**
- ✅: No user input in file paths, or path.resolve with base directory validation
- ⚠️: User input in paths but with validation
- ❌: User input directly in file paths without traversal protection
