---
description: >
  Use this skill when asked to go through pull request review comments — validating,
  handling, or rejecting them. Invoked via /address-pr-comments or phrasings like
  "go over my PRs", "address the review comments", "handle the bot's comments".
  Verifies each comment against the real code, then commits fixes behind a developer
  approval gate and replies to + resolves each thread.
name: address-pr-comments
---
# Address PR Comments — Verify → Propose → Apply

See `reference/github-mechanics.md` for the exact `gh` / GraphQL commands.

Configure once, at the top of your own copy — everything else is generic:

| Setting | What it is |
|---|---|
| `ORG` | The organisation whose pull requests are in scope. Never touch repositories outside it. |
| `CHECKOUT_ROOTS` | Where repositories are cloned locally, e.g. `~/code`. Used to find the canonical working tree. |

---

## Philosophy — verify, don't trust

An automated review comment (a bot reviewer, a linter, a static analyser) is a
**hypothesis, not an instruction**. Reviewer bots raise frequent false positives and often
self-flag "low confidence" — a claim is actionable only once you have **reproduced it in the
actual code path at the pull request's head commit**. Equally, never dismiss one without
evidence: "invalid" must cite the code, test, or behaviour that disproves it.

Every write is gated by **propose-and-confirm**: the agent cannot verify its own fix is what
the developer intended, so commits, pushes, and issue-tracker updates happen only on the
developer's explicit go-ahead. When a situation is not covered below, reason from these two
principles.

---

## Workflow

### 0. Enumerate — the pull requests in scope

List the developer's open pull requests, scoped to `ORG`, **oldest first**, with no time
cutoff — a pull request opened days ago can pick up a fresh comment today. Present them as a
set with, per pull request, the count of **unresolved** review threads (not the raw comment
count, which includes resolved threads and the developer's own replies).

Assume most are already partly handled: a large share of threads will be done, and some pull
requests will have nothing open at all. Triage on `isResolved` first and mark those **nothing
to do** — do not open them or re-verify closed threads. Then work **one pull request at a
time**, oldest first, so the oldest threads clear before they rot.

**Use `isOutdated` as a triage signal.** A thread flagged outdated sits on code that has since
changed, so the comment may already be moot. Do not silently skip it — verify against the
current head like any other, but say it is outdated when you present it, because that context
usually shortens the decision.

### 1. Gather — comments with permalinks

Fetch review bodies **and** inline comments, capturing each `html_url` (permalink) and
`diff_hunk`. **Every item you report carries its permalink** — the developer clicks it to read
the comment in context and check your verdict; a verdict they cannot click through to is
uncitable. Some reviewers bury suppressed low-confidence notes inside the review body with no
inline anchor, so surface those explicitly.

**Only unresolved threads are in scope.** Query each thread's `isResolved` and drop the closed
ones — a resolved thread is finished business whether you closed it, a teammate did, or it
carries only the developer's own earlier reply. Do not re-verify, re-reply, re-resolve, or
count it. The raw comment endpoint returns everything, which inflates the count and tempts a
redundant second pass over merged work.

Then work through the open comments **strictly one at a time** — carry a single comment all
the way through verify → propose → close before looking at the next. Do not dump every
verdict up front: a wall of parallel findings is unreadable, and the developer can only act on
one decision at a time. "N comments on this pull request, starting with 1 of N" is fine.

**The one exception:** group comments only when they are individually trivial **and** share a
root cause, and say why in the first line ("Comments 1–3 are the same typo in a test title,
all fixed by one change — grouping them"). Without that stated justification, default back to
one at a time. Anything needing real judgment is never grouped, however small it looks.

### 2. Verify — reproduce each claim against real code

Find the canonical checkout under `CHECKOUT_ROOTS`. If the branch is checked out, read and run
locally. If not, read the file **via the API at the pull request's head ref** — never the
default branch, because the reviewer commented on the head.

A temporary clone is for read-only verification **only** — never the surface you ask the
developer to review or commit from. The change they review and the commit you push must live in
the canonical working tree, not a copy they will never see again. If that tree has uncommitted
work on another branch, park it (`git stash push -u`) or add a worktree inside it.

Match the project's pinned runtime version before running anything (`.nvmrc`, `engines`, or the
equivalent) — an engine mismatch fails the run and sends you down a false trail. Prefer a real
check — a one-line repro, running the test, reading the dependency's source — over reasoning
alone. Then classify:

- **VALID** — reproduced. State the concrete failure path: inputs → wrong result.
- **INVALID** — disproved. Cite the guard, test, framework default, or dead code that makes the
  concern moot.

### 3. Propose — make the change, then gate on the developer's review

For a VALID comment, make the fix in the canonical working tree — **but do not commit**. Present
it two ways at once: open the repository root in the developer's editor so they review the
changeset in source control, and in chat report *what* changed and *where* (`file:line` plus a
one-line summary) without pasting the diff. For an INVALID verdict there is nothing on disk, so
say "no change — nothing to open" explicitly rather than silently omitting it.

**Any change to source or test code goes through your unit-testing skill or standard, always** —
write the missing test or extend the covering one before presenting. A reviewer asking for an
extra assertion is asking for a new single-assertion test, not a second assertion piled onto an
existing one. Run the affected spec and report it green as part of "what changed".

Then **stop and ask the developer to review and approve**. Lead with your recommendation and a
one-line why — you did the verification, so hand them a judgment, not a bare menu:

> Recommend **1) Approve** — <one-line why>.
> **1) Approve (recommended) · 2) Edit · 3) Skip**

Nothing is final until they choose Approve. Do not commit, push, or update the tracker before
that, and do not move to the next comment until this one is closed.

### 4. Close every comment — reply, then resolve

**Every inline comment ends the same way: reply, then resolve** — whether or not a commit was
needed. Leaving a handled comment open forces every teammate to re-derive whether it was
addressed, and the reply is the durable record of why.

- **Fix required (VALID, approved)** — commit, push to the branch, post the commit's URL so the
  developer can check it, then reply citing the commit and a one-line reason, and resolve.
- **No fix (INVALID)** — no commit: present the disproving evidence, confirm, then reply with
  that evidence and resolve.

A rejected note with no inline anchor has no thread to resolve — record it in your report
instead. Check `viewerCanResolve` before attempting the mutation rather than failing on it.

### 5. Wrap up — judge whether another machine round is worth it

Once every comment is closed, summarise the round and **make a judgment call: recommend, or
explicitly recommend against, another automated review.** Do not hand over a flat "want another
review?" — you did the verification, so you know whether the round has signal left.

**The bar is never "iterate until the bot reports zero."** Its false-positive rate means it will
almost always surface one more nit, so chasing zero loops forever on noise.

- **Recommend another round** when this round produced at least one **VALID, reproduced bug fixed
  with a behavioural change** — that fix is new code the first pass never saw.
- **Recommend against** when the round produced only nits, rejections, or cosmetic edits — nothing
  behavioural changed, so a re-review has little new to catch. Also stop when the reviewer is
  flip-flopping: re-flagging code it earlier accepted is noise, not signal.
- **Always stop** once human review is approved and tests are green. The bot is an assist, never
  the gatekeeper.

Rule of thumb: one re-review after a batch of substantive fixes; a second only if the first found
another reproduced bug; by the third you are in nit territory — stop and ship.

Requesting the re-review is mechanical: on the developer's yes, make the API call yourself rather
than sending them clicking through the interface. Bot reviews are not instant — allow several
minutes, do not busy-poll, move on and pick up new comments when they land.

### 6. The bot's silence is not done — check the human gate

**Whenever the machine loop ends, the very next question is the human one.** A pull request can
clear every automated round, satisfy every nit, and still never have been read by a second human
— and "the bot found nothing more" reads exactly like done.

Check, in this order:

1. **What does the repository require?** Read its branch protection or ruleset: if it requires
   approving reviews, that is the real gate and you should report whether it is satisfied rather
   than inventing your own.
2. **Is a human review already given or pending?** Check review requests and latest reviews,
   ignoring bots.
3. **If none, who should it be?** Ask in this order and stop at the first that answers:
   - **`CODEOWNERS`** — if the repository has one and it matches the changed paths, those owners
     are the answer; GitHub may already have requested them.
   - **GitHub's suggested reviewers** — the people who recently changed these files, available
     per pull request with flags for whether each is an author or commenter of the code.
   - **Ask the developer.** If neither source answers, do not guess a name — ask who should
     review it. Handles are unique; disambiguating people is the human's job, not yours.

Then offer it as a numbered choice with your recommendation stated. On approval, make the request
yourself — it is a single API call.

### 7. Hand off to the next pull request

The wrap-up ends with a handoff, not a dead stop: re-triage the enumeration and, if another pull
request still has unresolved threads, offer it as a numbered option.

> Recommend **1) Continue with `repo#123` (3 open threads)** — next in the batch.
> **1) Continue with next (recommended) · 2) Stop here**

When none have open threads left, say the batch is exhausted, give the overall summary, and end.
Never offer a continuation with nowhere to go.

---

## Per-comment layout — always the same shape

Present **every** comment in this layout so nothing is dropped — the permalink, the reviewer's
own words, the verdict, the recommendation. Never collapse it to a bare menu, even on a
follow-up nudge:

```
**Comment <i> of <n> — `path:line`** · 🔗 <permalink> <· outdated, if flagged>

> <the reviewer's comment, quoted verbatim — or faithfully summarised if long>

**Verdict:** VALID / INVALID — <one-line evidence: the failure path, or the guard that disproves it>

**Change:** <file:line + one-line summary, or "no change — nothing to open">

Recommend **1) Approve** — <one-line why>.
**1) Approve (recommended) · 2) Edit · 3) Skip**
```
