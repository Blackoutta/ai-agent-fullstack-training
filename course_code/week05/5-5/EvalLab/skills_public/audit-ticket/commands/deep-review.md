---
name: auditor:deep-review
description: Deep single-instruction / single-function security review using the instruction worksheet, context reconstruction, and adversarial exploit modeling.
argument-hint: "<file> [function|instruction]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# auditor-skill — Deep Review

**Arguments:** $ARGUMENTS

1. Read the target file completely.
2. Run Phase 0.5 Context Reconstruction on the target function (`templates/context-worksheet.md`): purpose, inputs, invariants (≥3), assumptions (≥5), external-interaction risks (≥3) — each cited to `L#`.
3. Fill `templates/instruction-worksheet.md`; cross-reference code that shares state.
4. Adversarially model exploitation. Any high-severity finding (N≥6) must pass the Rule 5b validation gate.
5. Report per-item verdicts + findings for this unit only.
