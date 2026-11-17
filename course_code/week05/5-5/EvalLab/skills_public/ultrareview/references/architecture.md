# Ultrareview Architecture & Technical Details

## Table of Contents

- [Overview](#overview)
- [Multi-Agent Execution Flow](#multi-agent-execution-flow)
- [Agent Specializations](#agent-specializations)
- [Cross-Validation & Self-Falsification](#cross-validation--self-falsification)
- [Severity Classification](#severity-classification)
- [Context Awareness](#context-awareness)
- [Cost & Performance Benchmarks](#cost--performance-benchmarks)
- [Comparison: Ultrareview vs Code Review vs Agent Teams](#comparison)

## Overview

Ultrareview is a multi-agent parallel code review system discovered in the Claude Code v2.1.88 source leak (March 2026). It uses a "Bug Fleet" pattern: multiple specialized agents review the same codebase concurrently from different angles, cross-validate findings, and produce a consolidated report.

Key stats from the production Code Review product (same architecture):
- Large PRs (>1000 lines): 84% problem detection rate, avg 7.5 bugs per PR
- False positive rate: <1%
- PRs receiving substantive review comments: 16% → 54% after deployment
- Mozilla Firefox pilot: 22 vulnerabilities in 2 weeks (14 high-severity), including a heap buffer overflow that escaped decades of fuzz testing

## Multi-Agent Execution Flow

```
User triggers review (CLI /ultrareview or GitHub PR)
        │
        ▼
┌───────────────────────────────────┐
│  1. Context Collection            │
│  - Read full codebase context     │
│  - Parse CLAUDE.md / REVIEW.md    │
│  - Identify changed files / scope │
└───────────┬───────────────────────┘
            ▼
┌───────────────────────────────────┐
│  2. Agent Dispatch (Cloud)        │
│  - Spawn 5-20 parallel agents    │
│  - Each agent gets:              │
│    • Full code context            │
│    • Specialization prompt        │
│    • Project-specific rules       │
└───────────┬───────────────────────┘
            ▼
┌───────────────────────────────────┐
│  3. Parallel Analysis (5-20 min)  │
│  - Each agent reviews from its    │
│    specialized angle              │
│  - Agents produce raw findings    │
└───────────┬───────────────────────┘
            ▼
┌───────────────────────────────────┐
│  4. Cross-Validation              │
│  - Agents attempt to disprove     │
│    each other's findings          │
│  - Confirmed issues retained      │
│  - Unconfirmed issues discarded   │
└───────────┬───────────────────────┘
            ▼
┌───────────────────────────────────┐
│  5. Aggregation & Reporting       │
│  - Deduplication                  │
│  - Severity ranking               │
│  - Generate structured report     │
│  - Include reasoning traces       │
└───────────┬───────────────────────┘
            ▼
     Structured Report Output
```

## Agent Specializations

Each agent is prompted with a distinct review perspective. Typical specializations:

| Agent Role | Focus Area | What It Catches |
|---|---|---|
| Logic Verifier | Algorithmic correctness | Off-by-one errors, wrong conditions, unreachable code, infinite loops |
| Security Sentinel | Vulnerability scanning | SQL injection, XSS, auth bypass, buffer overflows, OWASP Top 10 |
| Performance Oracle | Optimization | N+1 queries, unnecessary allocations, blocking I/O, complexity issues |
| Boundary Inspector | Edge cases | Null handling, empty collections, integer overflow, timezone issues |
| Architecture Strategist | Design review | SOLID violations, tight coupling, missing abstractions, API misuse |
| Data Integrity Guardian | Database concerns | Race conditions, transaction safety, schema drift, migration risks |
| Concurrency Analyst | Thread safety | Deadlocks, race conditions, atomicity violations, shared state bugs |
| Error Handling Reviewer | Failure paths | Uncaught exceptions, missing error propagation, silent failures |

Default deployment: 5 agents. Maximum: 20. Agent count scales with codebase complexity.

## Cross-Validation & Self-Falsification

The key differentiator from simple multi-pass review:

1. **Finding Phase**: Each agent produces a list of suspected issues with evidence
2. **Challenge Phase**: Other agents receive these findings and attempt to:
   - Reproduce the issue path
   - Find counterevidence (e.g., the "bug" is actually handled elsewhere)
   - Verify the fix suggestion wouldn't introduce regressions
3. **Verdict Phase**: Only issues that survive cross-examination are included
4. **Confidence Scoring**: Each surviving issue gets a confidence score based on how many agents confirmed it

This loop is what drives the <1% false positive rate.

## Severity Classification

Three-tier system with color coding:

- 🔴 **Critical** (Red): Must fix before merge. Confirmed bugs, security vulnerabilities, data corruption risks
- 🟡 **Warning** (Yellow): Should fix, won't block merge. Potential issues, performance concerns, code smells with real impact
- 🟣 **Pre-existing** (Purple): Not introduced by current changes. Historical bugs or tech debt surfaced during review

Each finding includes:
- Location (file + line range)
- Issue description
- Root cause analysis
- Suggested fix (with code)
- Collapsible extended reasoning trace

## Context Awareness

The system reads project-specific configuration:

- **CLAUDE.md**: Project-level instructions, coding standards, architectural decisions
- **REVIEW.md**: Review-specific rules (e.g., "always check for SQL injection in /api routes", "ignore style issues in generated code")
- **Dependency graph**: Understands import chains and cross-module effects
- **Git history**: Considers recent changes and patterns

## Cost & Performance Benchmarks

From production Claude Code Review data:

| Metric | Value |
|---|---|
| Avg time per review | 10-25 minutes |
| Avg cost per PR | $15-25 (token-based) |
| Problem detection (large PR) | 84% |
| Avg bugs found per PR | 7.5 |
| False positive rate | <1% |
| Agent count (default) | 5 |
| Agent count (max) | 20 |

Cost breakdown:
- 50-person team, 100 PRs/day → ~$730K/year
- Token consumption scales with codebase size + diff size
- Each agent consumes context independently (no shared window)

## Comparison

| Dimension | /ultrareview (Leaked) | Code Review (Shipped) | Agent Teams (DIY) |
|---|---|---|---|
| Trigger | CLI command | GitHub PR auto | Manual / slash command |
| Execution | Cloud remote | Cloud | Local or cloud |
| Agent count | 5-20 (configurable) | Multiple (opaque) | User-defined |
| Scope | Local worktree | PR diff + full repo | User-defined |
| Output | Terminal report | GitHub inline comments | Terminal / file |
| Custom rules | CLAUDE.md + REVIEW.md | CLAUDE.md + REVIEW.md | Agent prompt files |
| Cross-validation | Built-in | Built-in | Manual setup needed |
| Status | Unreleased (feature flag) | Research preview | Experimental |
| Cost | Unknown | $15-25/PR | Your API costs |
