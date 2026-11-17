---
name: auditor:re-audit
description: Fix-review / re-audit. Takes a prior audit report + the current tree and classifies every prior finding FIXED / PARTIALLY-FIXED / STILL-OPEN / REGRESSED / ACKNOWLEDGED / DISPUTED (re-running Rule 5b on the fix, citing the remediation commit/PR hash), audits the changed surface for NEW findings via the diff-audit path, and runs a sibling-patch-propagation sweep for un-patched copies of every fixed anti-pattern. Emits a finding-diff.
argument-hint: "[prior-report] [base..head]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# auditor-skill — Fix Review / Re-Audit

**Arguments:** $ARGUMENTS

Re-audit a codebase after a fix round. **Input:** a prior `audit_<n>/REPORT.md` (arg 1) and the current tree; the delta range is `base..head` (arg 2, default `main..HEAD` — the fix commits). Read `OUTPUT-RULES.md` first (severity 1-10, the **Rule 5b** gate). This is a Zenith/Certora-style fix-review, not a fresh audit — it reuses the prior report as the baseline and reports what changed.

## Steps

1. **Load the baseline.** Parse the prior report's findings (id, severity, `file:line`, root-cause, Rule 5b block). Pin both commits: the prior report's audited commit and the current `head`.

2. **Classify every prior finding.** For each prior finding, read the current code at the (possibly moved) location and assign one of six states. **Every non-open status must cite the remediation commit/PR hash** that changed it (`git log --oneline` / the PR the fix landed in), not merely the current `file:line` — the reader must be able to point at *what* fixed it, not just where the code now sits.
   - **FIXED** — the vulnerable path is gone. **Re-run Rule 5b on the fix**: confirm the fix actually closes the reachability/bound the finding claimed — a cosmetic or incomplete patch is **not** FIXED. Cite the fixing commit/PR hash **and** `file:line`.
   - **PARTIALLY-FIXED** — the fix closes *some* of the reachability/bound but a residual path survives (one call site patched, an edge input still breaks it, the guard added is necessary-but-insufficient). Re-run Rule 5b on the *residual* path and carry a severity for what remains. Cite both the fixing commit/PR hash and the surviving `file:line`.
   - **STILL-OPEN** — the finding survives unchanged (or was never touched). Carry its severity forward.
   - **REGRESSED** — the fix introduced a new problem, or a previously-fixed issue returned, or the "fix" made it worse. Treat as a fresh finding through the full Rule 5b gate; a security check deleted in a fix commit is a CRITICAL regression (git-blame it, cite the commit).
   - **ACKNOWLEDGED** — the client accepts the risk and has **not** changed the code (won't-fix / risk-accepted). The code still contains the vulnerable path, so severity is unchanged — do **not** score it as resolved; record it as an accepted-risk item.
   - **DISPUTED** — the client contests the finding's validity/severity and the code is unchanged. Record the dispute as the client's *position*, then state our independent re-derivation verdict (upheld / downgraded / withdrawn) from the code — the report keeps our verdict, not the client's assertion, as the ruling.

   **Verification-verb discipline (never launder a client claim into a confirmation).** Each status must carry an explicit verb that names *who* established it. Use **"we re-tested and confirmed"** / **"we re-derived from the code and confirmed"** only when *we* verified it against the current tree via Rule 5b. When the basis is the client's word, write **"client states fixed (unverified)"** — and that is **not** FIXED until we independently confirm it. A client's "we fixed it" may never be silently promoted to FIXED; an unverified client fix is at most PARTIALLY-FIXED-pending-verification or stays STILL-OPEN.

3. **NEW findings on the changed surface.** Run the changed surface through the **diff-audit path** (`/auditor:diff-audit` logic): `git diff --name-only base..head`, Phase 0.5 context reconstruction on changed functions + 1-hop callers/callees, risk-classify (auth / crypto / value-transfer / validation-removal = HIGH), then the matching checklist items + known-vectors through Rule 5b — including its dependency lane (checklist 11 §11.11, with the prior audited commit as the baseline) when the fix round touched a manifest or lockfile. Fixes routinely introduce new bugs — this catches them. Delegate to `vuln-hunter` for the walk.

4. **Sibling-patch-propagation sweep (variant analysis).** For **every FIXED and PARTIALLY-FIXED finding**, extract the anti-pattern signature (the code shape that was the bug — e.g. a missing signer check, an unchecked `*`, a PDA derived without the stored bump) and `grep` the whole codebase for the **same signature elsewhere**. Report every un-patched sibling instruction: a fix applied to one call site but not its twins is a live vulnerability. This is the Certora/ToB variant-analysis discipline — one fix rarely covers all instances. **The sweep always emits a result, even when empty**: for each swept anti-pattern, record either the un-patched siblings found *or* an explicit **"swept `<signature>` across `<globs>` — no siblings found"**. A silent/absent sweep is indistinguishable from "not run" and is not acceptable — "no siblings found" is a first-class recorded output, not an omission.

4b. **Differential execution (optional, when a harness exists).** When the finding has an executable PoC or the target ships a stateful test suite, don't re-verify a fix by reading alone — run the *same* transaction sequence against both the pre-fix and post-fix builds and assert the behavioral delta is exactly the intended one (the exploit path now reverts; every other path is unchanged). Fuzz around the changed fields to catch downstream drift a line-diff hides. This is the Neodyme differential-fuzzing discipline for change reviews; it upgrades a `FIXED` verdict from asserted to executed. Skip cleanly (note it) when no harness is available — never block the re-audit on it.
   Both builds and the test suite are target-controlled code: run them in the execution mode recorded at intake (`OUTPUT-RULES.md` Rule 11a — isolated recommended; native allowed, with the report caveat). If that mode cannot run them, skip this step, keep the read-based verdict and say so. Build the pre-fix commit from a copy made with `GIT_NO_LAZY_FETCH=1 git clone --no-local <checkout> <scratch copy>` (or a worktree of a clone you made yourself), never by checking out inside a client-supplied `.git/` (Rule 11c).

5. **Emit the finding-diff.** Write `audit_<n+1>/RE-AUDIT.md`:
   - **Finding-diff table:** each prior finding → FIXED / PARTIALLY-FIXED / STILL-OPEN / REGRESSED / ACKNOWLEDGED / DISPUTED, with the **remediation commit/PR hash**, the fixing or surviving `file:line`, and the **verification verb** (who confirmed it — "we re-tested and confirmed" vs. "client states, unverified").
   - **New findings** (from step 3), severity-ordered, full Rule 5b blocks.
   - **Sibling sweep** (from step 4): per swept anti-pattern, the un-patched siblings found *or* the explicit "no siblings found" line — **always present**, one row per swept signature.
   - **Updated safe-to-deploy verdict** reflecting the new state (ACKNOWLEDGED / DISPUTED / STILL-OPEN items keep their severity — they are not resolved). Spawn `audit-reporter` for assembly.
