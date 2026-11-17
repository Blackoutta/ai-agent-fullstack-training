---
id: 42
title: "XML External Entity (XXE)"
severity: 7
category: backend
---

### 42 — XML External Entity (XXE)
**Severity: 7** | **Real: Billion Laughs DoS, data exfiltration via XML**

Server parses XML with external entities — attacker reads files (`file:///etc/passwd`) or causes DoS.

#### Verification Procedure

**Step 1: Check for XML parsing**
```
grep -rn --include="*.ts" -iE "xml|parseXml|DOMParser|libxml|xml2js|fast-xml-parser|sax|expat" apps/backend/
```
- If no XML parsing: N/A
- If XML: proceed

**Step 2: Verify external entity processing is disabled**
```
grep -rn --include="*.ts" -iE "noent|dtd|external|entity|LIBXML_NOENT" apps/backend/
```
- ✅ PASS: External entities explicitly disabled (varies by parser)
- ❌ FAIL: Default XML parser settings (often allow external entities)

**Step 3: Check for SOAP or XML-RPC endpoints**
```
grep -rn --include="*.ts" "text/xml\|application/xml\|soap" apps/backend/
```
- ✅ PASS: No XML content types accepted, or XML parser is hardened
- ❌ FAIL: XML content type accepted with default parser

**Overall verdict:**
- ✅: No XML parsing, or parser configured with external entities disabled
- ⚠️: XML parsed but only internal/trusted sources
- ❌: XML parsed from user input with default entity settings
- N/A: No XML in the project
