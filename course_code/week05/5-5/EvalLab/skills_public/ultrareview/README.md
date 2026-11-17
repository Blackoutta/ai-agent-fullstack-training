# ultrareview

[English](README.md) | [简体中文](README.zh-CN.md)

> A reusable multi-agent code review workflow for high-signal findings, cross-validation, and structured reports.

`ultrareview` packages a practical review pattern: dispatch specialized reviewers in parallel, let them challenge each other's claims, then merge the confirmed issues into a single report that is easier to trust and easier to act on.

## Why this exists

A lot of AI code review still looks like this:
- one model
- one pass
- one undifferentiated list of comments

That is often enough for light review, but it breaks down when you care about:
- correctness on important changes
- security-sensitive code paths
- large diffs
- edge cases
- noisy false positives

`ultrareview` uses a different pattern:
- **specialized reviewers** instead of one generic reviewer
- **parallel review** instead of serial thinking
- **cross-validation** instead of trusting the first claim
- **structured aggregation** instead of dumping raw notes

The result is a review workflow that is better suited to pre-merge review, bug hunting, security-oriented review, and higher-risk refactors.

## What this repo is

This repository is a reusable skill package for running a multi-agent review workflow in your own environment.

It is designed for setups where you want to use:
- your own agent runtime
- your own model provider
- your own local or self-hosted infrastructure

This repo does **not** include any hosted proprietary review backend, and it does **not** make model usage free. It gives you a workflow pattern, role prompts, and setup guidance that you can adapt to your own stack.

## Core workflow

`ultrareview` turns code review into a multi-agent system:

1. **Collect context**
   - files, folders, PR diff, or full repo
   - project-specific guidance from files such as `CLAUDE.md` and `REVIEW.md`

2. **Spawn parallel specialists**
   Typical roles include:
   - Logic Verifier
   - Security Sentinel
   - Performance Oracle
   - Boundary Inspector
   - Architecture Reviewer

3. **Cross-validate findings**
   - agents try to disprove each other's claims
   - weak or unconfirmed issues are dropped
   - overlapping findings are deduplicated

4. **Produce a structured report**
   - Critical
   - Warning
   - Pre-existing

## Quick start

### Option 1: Use the skill package directly

Copy this repo into your skill directory or reuse the files in your own skill system:

```text
ultrareview/
|-- SKILL.md
`-- references/
    |-- architecture.md
    `-- diy-setup.md
```

Then invoke it for tasks like:
- deep code review
- security review
- large PR review
- correctness-focused review

Example prompts:

```text
Run ultrareview on src/auth/
Review this PR diff with logic, security, performance, and edge-case agents
Do a deep pre-merge audit for this refactor
```

### Option 2: Adapt the workflow to your own coding agent

If your environment supports:
- subagents
- team or parallel agent execution
- slash-command prompt files
- CI headless CLI review

then you can directly adapt the orchestration guidance from:
- `SKILL.md`
- `references/diy-setup.md`

## Example output

```markdown
# Ultrareview Report
**Scope**: `src/auth/`, `src/session.ts`
**Agents**: 5 | **Duration**: 2m 41s | **Findings**: 4

## Critical (1)
### [C1] Session token can be reused after logout
- **Location**: `src/session.ts:88-121`
- **Issue**: Logout clears client state but does not revoke the persisted server-side token.
- **Root cause**: Token invalidation path is missing in the logout flow.
- **Fix**: Revoke the token on logout and reject stale tokens during session validation.

## Warning (2)
### [W1] User lookup can trigger N+1 queries during permission checks
- **Location**: `src/auth/permissions.ts:41-79`
- **Issue**: Role expansion performs repeated DB reads inside a loop.
- **Fix**: Batch-load role mappings before permission evaluation.

### [W2] Null email path produces silent fallback behavior
- **Location**: `src/auth/user.ts:24-37`
- **Issue**: Missing email falls through to guest behavior without explicit handling.
- **Fix**: Fail closed or return an explicit typed error.

## Pre-existing (1)
### [P1] Legacy password hash path lacks migration guard
- **Location**: `src/auth/hash.ts:12-33`
- **Issue**: Old hash format is still accepted without progressive upgrade.
```

## Repository structure

```text
ultrareview/
|-- README.md
|-- README.zh-CN.md
|-- SKILL.md
|-- LICENSE
`-- references/
    |-- architecture.md
    `-- diy-setup.md
```

## Files

- `SKILL.md` - main skill definition, review process, report format, and implementation paths
- `references/architecture.md` - architecture notes on multi-agent review, agent roles, cross-validation, and evaluation framing
- `references/diy-setup.md` - practical setup guide for Agent Teams, custom subagents, plugin-based review, and CI/CD usage

## Implementation paths

This repo documents four practical ways to apply the workflow:

1. **Native Agent Teams**  
   Best when your coding agent supports team-style parallel agents.

2. **Plugin-based setup**  
   Useful if you already use a compound orchestration plugin.

3. **Custom subagents**  
   Best when you want full control over roles, prompts, and consolidation logic.

4. **CI/CD integration**  
   Useful for automated pull-request review pipelines.

## Positioning

The value here is not "ask one strong model to review code."

The value is the system design:
- multiple reviewers
- specialized roles
- falsification
- synthesis

That pattern is portable across runtimes, providers, and local engineering workflows.

## Suggested GitHub metadata

**Repository description**

> Multi-agent code review workflow with specialized reviewers, cross-validation, and structured reporting.

**Suggested topics**

```text
code-review
multi-agent
ai-code-review
agent-workflow
prompt-engineering
security-review
static-analysis
developer-tools
```

## Related reading

- `references/architecture.md`
- `references/diy-setup.md`
- `README.zh-CN.md`

## License

MIT
