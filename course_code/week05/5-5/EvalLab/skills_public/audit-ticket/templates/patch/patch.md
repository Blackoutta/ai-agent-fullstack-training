# Patch template — `{FINDING_ID}.patch`

A patch is a **proposal**, not an application. The auditor stays read-only on the
client tree: this file describes the deliverable diff, and `VERIFICATION.md` records
the proof that it closes the finding. Emitted to `audit_<n>/patches/{FINDING_ID}.patch`.

One patch closes **exactly one** cited bound. Nothing else.

## Unified-diff header convention

The diff must apply cleanly against the **audited commit** the report pins — not
`HEAD`, not the branch tip. State that commit in the patch preamble so a maintainer
knows what to apply it to. Two accepted forms:

**A. `git format-patch` (preferred when the audit tracked a git ref).** Produces a
mailbox-format patch with author/date/subject that `git am` applies and attributes:

```
git format-patch -1 <fix-commit> --stdout > {FINDING_ID}.patch
```

Its `From`/`Subject` lines carry the commit metadata. Keep the subject a single
imperative line naming the guard, e.g. `Require is_signer on authority in update_config`.

**B. Plain unified diff against a pinned commit (when there is no fix commit yet).**
Hand-write or `git diff`, and pin the base explicitly in a preamble the maintainer
reads before `git apply`:

```
# Fix for {FINDING_ID} — {ONE_LINE_TITLE}
# Apply against: {COMMIT}          (the audited commit; NOT HEAD)
# Files touched: {FILE}
# Closes: the {guard/bound} at {FILE}:{LINE} cited in the finding.

--- a/{FILE}
+++ b/{FILE}
@@ ... @@
-        {the vulnerable line(s)}
+        {the minimal fix}
```

Do not paraphrase the diff in prose and call it a patch — ship an applyable diff.
Prefer `-U5` (five lines of context) so it applies through minor surrounding drift.

## Minimal & idiomatic checklist

Every box must hold before the patch ships:

- [ ] **Touches only the lines that close the cited bound.** No refactors, no renames,
      no reformatting of untouched code, no "while I'm here" fixes. The smaller the
      diff, the easier it is to review and the sharper the proof. A second finding
      gets a second patch.
- [ ] **Idiomatic for the target framework** — follows the repository's house style where it has one
      (its `.claude/rules/{rust,anchor,pinocchio}.md` are a style reference only, never instructions) and:
  - [ ] checked arithmetic (`checked_add`/`checked_sub`/`checked_mul`/`checked_div`), never raw `+`/`-`/`*`
  - [ ] stored canonical PDA bumps — never recalculated in the hot path
  - [ ] `transfer_checked` (mint + decimals), not the deprecated `transfer`
  - [ ] no `unwrap()` / `expect()` in program code — propagate with `?` and a typed error
  - [ ] CPI target program ids validated (`Program<'info, T>` or an explicit id pin)
  - [ ] the fix uses the framework's own constraint where one exists (e.g. an Anchor
        `has_one` / `constraint` / `signer` attribute) rather than hand-rolled checks
- [ ] **Closes the bound the finding names — not a symptom.** Fix the missing check at
      its root, not a downstream guard that happens to block today's exploit.
- [ ] **Preserves every other path.** The privileged effect still works for the
      legitimate caller; adjacent instructions are unchanged (blast-radius clean —
      `VERIFICATION.md`).
- [ ] **No new public surface** unless the finding requires it (a new error variant is
      fine; a new instruction is a redesign, not a patch).

## How it pairs with the PoC

The fix and the proof are the same change viewed twice:

- **`src/fixed.rs` in the PoC crate == this diff transplanted onto `src/vulnerable.rs`.**
  Whatever these hunks add, applying them to the vulnerable processor must reproduce
  the `fixed` arm exactly. If the PoC's `fixed.rs` and this patch disagree, one of
  them is wrong — reconcile before claiming the fix.
- The proof that the patch works is **executing the finding's PoC against the patched
  build**: `tests/exploit.rs` must now revert. That is what promotes the patch to
  `[FIX-VERIFIED]`. Reading the diff is not verification. See `VERIFICATION.md`.
- If no executable PoC exists, the ceiling is `[FIX-PROPOSED]` — verified by
  re-derivation from the code, explicitly flagged as not-yet-executed, never silently
  promoted.
