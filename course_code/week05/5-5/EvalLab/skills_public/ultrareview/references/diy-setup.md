# DIY Ultrareview Setup Guide

## Table of Contents

- [Option 1: Agent Teams (Native)](#option-1-agent-teams-native)
- [Option 2: Compound Engineering Plugin](#option-2-compound-engineering-plugin)
- [Option 3: Custom Subagent Configuration](#option-3-custom-subagent-configuration)
- [Option 4: CI/CD Integration](#option-4-cicd-integration)
- [Writing Effective Review Agent Prompts](#writing-effective-review-agent-prompts)
- [REVIEW.md Configuration](#reviewmd-configuration)

## Option 1: Agent Teams (Native)

Claude Code's experimental Agent Teams feature enables multi-agent parallel review.

### Enable

```bash
# In settings.json or environment
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

Or in `~/.claude/settings.json`:
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### Create a Slash Command

Save as `.claude/commands/ultrareview.md`:

```markdown
# Ultrareview: Multi-Agent Parallel Code Review

TeamCreate a comprehensive code review team with the following agents:

## Agent 1: Logic Verifier
Review the codebase for logical correctness. Focus on:
- Off-by-one errors, wrong boolean conditions
- Unreachable code paths, infinite loops
- Incorrect algorithm implementations
- Missing return values or wrong return types
Scope: $ARGUMENTS (or entire project if not specified)

## Agent 2: Security Sentinel
Scan for security vulnerabilities. Focus on:
- OWASP Top 10 (injection, XSS, auth bypass, SSRF)
- Buffer overflows, memory safety issues
- Hardcoded secrets, insecure defaults
- Missing input validation, improper error disclosure
Scope: $ARGUMENTS

## Agent 3: Performance Oracle
Identify performance issues. Focus on:
- N+1 queries, unnecessary database calls
- Blocking I/O in async contexts
- Excessive memory allocation, memory leaks
- Algorithm complexity issues (O(n²) where O(n) is possible)
Scope: $ARGUMENTS

## Agent 4: Boundary Inspector
Check edge cases and error handling. Focus on:
- Null/undefined handling, empty collections
- Integer overflow, floating point precision
- Timezone and locale issues
- Missing error propagation, silent failures
Scope: $ARGUMENTS

## Agent 5: Architecture Reviewer
Evaluate design quality. Focus on:
- SOLID principle violations
- Tight coupling between modules
- Missing abstractions, code duplication
- API contract mismatches, breaking changes
Scope: $ARGUMENTS

## Coordination Instructions
After all agents complete their review:
1. Cross-reference findings - if multiple agents flag the same area, increase severity
2. Verify each finding by checking if the issue is handled elsewhere in the codebase
3. Discard any finding that cannot be confirmed with evidence
4. Produce a consolidated report with severity levels:
   - 🔴 Critical: Must fix (confirmed bugs, security vulnerabilities)
   - 🟡 Warning: Should fix (potential issues, performance concerns)
   - 🟣 Pre-existing: Not new, but worth noting (tech debt)
5. For each finding include: location, description, root cause, suggested fix
```

Usage:
```
/project:ultrareview src/auth/
/project:ultrareview  (reviews entire project)
```

### Important: TeamCreate Keyword

Include `TeamCreate` in the command to create an actual agent team (agents that communicate with each other), not just parallel sub-agents (isolated).

## Option 2: Compound Engineering Plugin

The `compound-engineering-plugin` provides a pre-built multi-agent review system.

### Install

```bash
# In your project
git clone https://github.com/EveryInc/compound-engineering-plugin .claude/plugins/compound-engineering
```

### Usage

```bash
claude /compound-engineering:review 123  # Review PR #123
claude /compound-engineering:review https://github.com/org/repo/pull/123
```

Features:
- 12+ specialized review agents running in parallel
- Language-specific reviewers (Rails, TypeScript, Python)
- Security sentinel, performance oracle, architecture strategist
- Data integrity guardian
- Isolated worktree checkout for safe analysis

## Option 3: Custom Subagent Configuration

For maximum control, define individual review agents.

### Create Agent Files

`.claude/agents/security-reviewer.md`:
```markdown
---
name: security-reviewer
description: Security vulnerability scanner. Use when reviewing code for security issues, auditing auth flows, or checking for OWASP Top 10 vulnerabilities.
model: sonnet
tools: Read, Grep, Glob, Bash
---

You are a senior security engineer conducting a code audit.

Review process:
1. Map all entry points (API routes, user inputs, file uploads)
2. Trace data flow from input to storage/output
3. Check for injection, XSS, auth bypass, SSRF, path traversal
4. Verify secrets management (no hardcoded keys, proper env var usage)
5. Check dependency versions for known CVEs

Output format:
- 🔴 CRITICAL: [location] description + fix
- 🟡 WARNING: [location] description + fix
- ✅ PASS: Areas reviewed with no issues found
```

`.claude/agents/logic-reviewer.md`:
```markdown
---
name: logic-reviewer
description: Logic correctness checker. Use when reviewing code for algorithmic bugs, edge cases, and logical errors.
model: sonnet
tools: Read, Grep, Glob
---

You are a formal verification specialist reviewing code for logical correctness.

Review process:
1. For each function, identify preconditions and postconditions
2. Check loop invariants and termination conditions
3. Verify error handling covers all failure modes
4. Test boundary conditions mentally (empty, null, max, negative)
5. Check type coercions and implicit conversions

Flag only confirmed issues with evidence. Do not flag style preferences.
```

### Orchestrate from Main Session

```
Review src/api/ using security-reviewer and logic-reviewer agents in parallel.
Cross-reference their findings and produce a consolidated report.
Discard any finding that either agent cannot confirm.
```

## Option 4: CI/CD Integration

Run ultrareview in headless mode from CI pipelines.

### GitHub Actions Example

```yaml
name: Ultrareview
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Claude Code Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx @anthropic-ai/claude-code -p \
            "Review the changes in this PR. Focus on bugs, security, and logic errors. \
             Ignore style issues. Output as markdown." \
            --output-format stream-json \
            > review-output.json

      - name: Post Review Comment
        uses: actions/github-script@v7
        with:
          script: |
            // Parse and post review results as PR comment
            const fs = require('fs');
            const output = fs.readFileSync('review-output.json', 'utf8');
            // ... post to PR
```

### Git Pre-push Hook

```bash
#!/bin/bash
# .git/hooks/pre-push
echo "Running ultrareview on staged changes..."
claude -p "Review the diff of staged changes (git diff --cached). \
  Focus only on 🔴 Critical issues. Output concisely." \
  --output-format text
```

## Writing Effective Review Agent Prompts

Key principles for review agent prompts:

1. **Be specific about scope**: "Check OWASP Top 10" > "Check for security issues"
2. **Require evidence**: "Flag only issues you can point to in the code" prevents hallucinated bugs
3. **Constrain output**: Define severity levels and output format upfront
4. **Exclude style**: Explicitly say "Do not flag style, naming, or formatting issues"
5. **Set falsification bar**: "For each finding, verify the issue isn't handled elsewhere before reporting"

## REVIEW.md Configuration

Create `REVIEW.md` in project root to customize review behavior:

```markdown
# Review Rules

## Always Check
- SQL queries in /api/ routes must use parameterized queries
- All user input must be validated before processing
- Authentication middleware must be applied to all /admin/ routes
- Database transactions must have proper rollback handling

## Ignore
- Generated code in /src/generated/
- Third-party vendored code in /vendor/
- Test fixtures in /tests/fixtures/

## Project-Specific
- We use UUIDs, not auto-increment IDs
- All timestamps are UTC, stored as ISO 8601
- Error responses follow RFC 7807 (Problem Details)
- Rate limiting is handled at the gateway level, not in application code
```
