---
name: ultrareview
description: Multi-agent parallel code review system inspired by Claude Code's /ultrareview. Spawn 5-20 specialized agents (security, logic, performance, edge cases, architecture) to review code simultaneously, cross-validate findings, and produce a consolidated bug report. Use when asked to do deep code review, ultrareview, multi-agent review, comprehensive bug hunting, security audit, or thorough pre-merge code inspection.
---

# Ultrareview

Multi-agent parallel code review: spawn a fleet of specialized review agents, cross-validate findings, and output a consolidated report with severity levels.

## Quick Start

1. Determine review scope (files, directories, PR diff, or full project)
2. Spawn 5 parallel review agents (scale to 20 for large codebases):
   - **Logic Verifier** — algorithmic correctness, off-by-one, unreachable code
   - **Security Sentinel** — OWASP Top 10, injection, auth bypass, secrets
   - **Performance Oracle** — N+1 queries, blocking I/O, complexity
   - **Boundary Inspector** — null handling, empty collections, overflow, timezones
   - **Architecture Reviewer** — SOLID violations, coupling, API mismatches
3. Cross-validate: each agent challenges other agents' findings; discard unconfirmed issues
4. Aggregate, deduplicate, rank by severity, output report

## Review Process

### Phase 1: Context Collection
- Read project's `CLAUDE.md` and `REVIEW.md` for custom rules
- Identify scope: specific files, git diff, or full codebase
- Map entry points, dependencies, and data flow paths

### Phase 2: Parallel Agent Dispatch
Spawn agents as subagents or Agent Team members. Each agent receives:
- Full code context for the review scope
- Specialization prompt defining its review angle
- Project-specific rules from CLAUDE.md / REVIEW.md

Minimum 5 agents for meaningful cross-validation. Scale up for large/critical codebases.

### Phase 3: Cross-Validation
After initial findings:
1. Share findings across agents
2. Each agent attempts to disprove others' findings (check if issue is handled elsewhere, verify fix won't regress)
3. Retain only findings confirmed by evidence
4. Assign confidence score based on cross-agent agreement

### Phase 4: Report Generation

Severity classification:
- 🔴 **Critical**: Must fix. Confirmed bugs, security vulnerabilities, data corruption
- 🟡 **Warning**: Should fix. Potential issues, performance concerns, code smells
- 🟣 **Pre-existing**: Not introduced by current changes. Historical tech debt

Each finding includes:
- File + line range
- Issue description
- Root cause analysis
- Suggested fix with code
- Reasoning trace (collapsible)

## Output Format

```markdown
# Ultrareview Report
**Scope**: [files/directories reviewed]
**Agents**: [count] | **Duration**: [time] | **Findings**: [count]

## 🔴 Critical (N)
### [C1] [Short title]
- **Location**: `path/to/file.ts:42-58`
- **Issue**: [Description]
- **Root cause**: [Why this is a bug]
- **Fix**: [Suggested code change]

## 🟡 Warning (N)
### [W1] ...

## 🟣 Pre-existing (N)
### [P1] ...

## ✅ Areas Reviewed — No Issues
- [List of clean areas]
```

## Excluding From Review

Respect `REVIEW.md` ignore patterns. Common exclusions:
- Generated code, vendored dependencies, test fixtures
- Style/formatting issues (never flag these)

## Implementation Options

Choose based on your environment:

- **Agent Teams** (native Claude Code) — See [references/diy-setup.md](references/diy-setup.md#option-1-agent-teams-native) for slash command setup with `TeamCreate`
- **Compound Engineering Plugin** — Pre-built 12+ agent review, see [references/diy-setup.md](references/diy-setup.md#option-2-compound-engineering-plugin)
- **Custom Subagents** — Maximum control with individual `.claude/agents/*.md` files, see [references/diy-setup.md](references/diy-setup.md#option-3-custom-subagent-configuration)
- **CI/CD Headless** — GitHub Actions / pre-push hook integration, see [references/diy-setup.md](references/diy-setup.md#option-4-cicd-integration)

## Architecture Deep Dive

For execution flow diagrams, agent specialization details, cross-validation mechanics, cost benchmarks, and product comparison table → see [references/architecture.md](references/architecture.md).
