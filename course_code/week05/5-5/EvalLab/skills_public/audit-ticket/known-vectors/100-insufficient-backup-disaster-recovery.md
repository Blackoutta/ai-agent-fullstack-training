---
id: 100
title: "Insufficient Backup / Disaster Recovery"
severity: 7
category: devops
---

### 100 — Insufficient Backup / Disaster Recovery
**Severity: 7** | **Real: GitLab database deletion incident (2017), Code Spaces shutdown (AWS console compromised)**

No backups, or untested backups → database corruption, accidental deletion, or ransomware wipes everything.

#### Verification Procedure

**Step 1: Check for database backup configuration**
```
grep -rn --include="*.yaml" --include="*.yml" --include="*.ts" -iE "backup|mongodump|snapshot|retention" . | grep -v node_modules | head -10
```
- ✅ PASS: Automated database backups configured (cloud provider or cron)
- ❌ FAIL: No backup configuration

**Step 2: Check MongoDB Atlas backup (if using Atlas)**
```
# Atlas: Database → Backup → verify backup policy
# - Continuous backup or scheduled snapshots?
# - Retention period?
```
- ✅ PASS: Continuous backup or daily snapshots with ≥7 day retention
- ⚠️ PARTIAL: Snapshots exist but short retention
- ❌ FAIL: No backups configured

**Step 3: Check for code/infrastructure backup**
```
# Is the git repo the single source of truth?
# Are there other critical configs not in version control?
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false remote -v   # Rule 11c flags
```
- ✅ PASS: All code in version control, infrastructure as code, multiple remotes
- ❌ FAIL: Single point of failure (one GitHub repo, no mirrors)

**Step 4: Check for recovery procedure documentation**
```
find . -name "*.md" | xargs grep -liE "disaster|recovery|restore|backup.*procedure" 2>/dev/null | head -5
```
- ✅ PASS: Documented disaster recovery procedure
- ⚠️ PARTIAL: Backups exist but no documented recovery procedure
- ❌ FAIL: No backups or recovery documentation

**Step 5: Check for backup testing**
```
# Has backup restoration ever been tested?
# When was the last test recovery?
```
- ✅ PASS: Backup restoration tested within last 90 days
- ⚠️ PARTIAL: Backups configured but never tested
- ❌ FAIL: No backup testing, no confidence in restoration

**Overall verdict:**
- ✅: Automated backups, documented recovery, tested restoration, multiple redundancy
- ⚠️: Backups exist but untested or undocumented
- ❌: No backups — total data loss risk

---

## Using This in an Audit Report

### Verdict Rules

Each hack produces one of four verdicts:

| Verdict | Meaning |
|---------|---------|
| ✅ PASS | Fully mitigated — no action needed |
| ⚠️ PARTIAL | Mitigated but with gaps — should be addressed |
| ❌ FAIL | Vulnerable — must be fixed before production |
| N/A | Not applicable to this project |

### Severity Scoring

| Range | Level | Action |
|-------|-------|--------|
| 8-10 | CRITICAL | Fix immediately, block deployment |
| 6-7 | HIGH | Fix before next release |
| 4-5 | MEDIUM | Plan fix within sprint |
| 1-3 | LOW | Track for future improvement |

### Report Structure

For each hack that is ⚠️ PARTIAL or ❌ FAIL:

```markdown
## [HACK #N] — Title
- **Severity**: X/10
- **Verdict**: ⚠️ PARTIAL / ❌ FAIL
- **Failed Steps**: Step 2, Step 4
- **Evidence**: [paste grep output or code snippet]
- **Recommendation**: [specific fix]
- **Checklist Items**: [link to related SEC-XXX, BE-XXX items]
```

### Aggregate Score

```
Total Applicable Hacks: XX / 100
PASS:    XX (XX%)
PARTIAL: XX (XX%)
FAIL:    XX (XX%)
N/A:     XX

Overall Security Score: (PASS * 1.0 + PARTIAL * 0.5) / Total Applicable * 100 = XX%
```

### Thresholds

| Score | Rating |
|-------|--------|
| 90%+ | Excellent — production-ready |
| 75-89% | Good — minor improvements needed |
| 60-74% | Fair — significant gaps to address |
| <60% | Poor — not production-ready |
