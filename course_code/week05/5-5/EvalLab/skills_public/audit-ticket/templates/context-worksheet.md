# Context Worksheet — {function_name}

File: {path} | Lines: {start}-{end} | Access tier: {permissionless | user | manager | admin}

> Phase 0.5 artifact. Understanding only — no verdicts here. Every claim cites a line (`L#`).
> Banned words: "probably", "might", "seems", "should". If unknown, write `UNKNOWN — needs manual review`.

## Purpose (from code, not docs)
{1-2 sentences}

## Signature
- Inputs (args): {name: type — meaning} @ L#
- Accounts: {name: type/constraint — role} @ L#
- Outputs / state written: {account.field <- what} @ L#

## Block-by-Block Walkthrough
| L# | Code intent | Reads | Writes | Notes |
|----|-------------|-------|--------|-------|
|    |             |       |        |       |

## Invariants preserved (>= 3)
1. {invariant} — enforced at L# / NOT enforced
2.
3.

## Assumptions (>= 5)
1. {assumes X about input / account / caller} — validated at L# / UNVALIDATED
2.
3.
4.
5.

## External-Interaction Risks (>= 3)
1. {CPI / sysvar / remaining_accounts / oracle} @ L# — trust: {validated | unchecked}
2.
3.

## Cross-Function Dependencies
- Shares state with: {fn} via {account / field}
- Must run before / after: {fn} — ordering assumption: {...}

## UNKNOWNS (manual review)
- {...}
