---
id: 32
title: "SQL Injection"
severity: 9
category: backend
---

### 32 — SQL Injection
**Severity: 9** | **Real: Heartland ($134M, 2008), TalkTalk ($77M, 2015)**

User input concatenated into SQL query — attacker reads/modifies/deletes all data.

#### Verification Procedure

**Step 1: Check if SQL is used**
```
grep -rn --include="*.ts" -iE "pg\b|mysql|sqlite|sequelize|prisma|knex|typeorm|postgres|\.query\(" apps/backend/
```
- If no SQL: N/A (e.g., MongoDB-only project)
- If SQL: proceed

**Step 2: Find all SQL query executions**
```
grep -rn --include="*.ts" -E "\.query\(|\.raw\(|execute\(" apps/backend/
```
- Record: Every raw query

**Step 3: Verify parameterized queries**
```
# Every query should use placeholders ($1, ?, :param) — never string concatenation
grep -rn --include="*.ts" -E "query\(`|query\(\"" apps/backend/ | grep -v "\$"
```
- ✅ PASS: All queries use parameterized placeholders
- ❌ FAIL: Any query uses string interpolation with user input (`\`SELECT * FROM x WHERE id = ${userId}\``)

**Step 4: Check ORM usage safety**
```
grep -rn --include="*.ts" "\.raw\(|\.rawQuery\(" apps/backend/
```
- ✅ PASS: No raw queries, or raw queries use parameterized placeholders
- ❌ FAIL: Raw SQL with user input interpolation

**Overall verdict:**
- ✅: All parameterized queries, no raw SQL with user input
- N/A: Project does not use SQL
