# address-pr-comments skill

An agent skill for working through pull request review comments — especially the ones bot
reviewers leave — without letting a machine become the gatekeeper.

The problem it solves is not "handle comments faster". It is that once agents raise your
throughput, review becomes the bottleneck, and review comments arrive as **interrupts**: one at a
time, across several pull requests, each costing a context switch back into code you finished
days ago.

**Why it exists:** [Review without interrupts: putting the agent first in the queue](https://stories.rdok.co.uk/posts/agent-first-code-review/)
— the reasoning behind the workflow, and the two cases that shaped it.

## The two rules everything else follows from

**A review comment is a hypothesis, not an instruction.** Bot reviewers raise frequent false
positives and often self-flag low confidence. A claim is actionable only once it has been
reproduced in the real code path **at the pull request's head commit**. And a comment is never
dismissed on instinct either — "invalid" must cite the guard, test, or framework default that
disproves it. Both verdicts carry evidence and a permalink, so they can be checked rather than
trusted.

**The bot's silence is not done.** A pull request can clear every automated round, satisfy every
nit, and still never have been read by a second human — and "the reviewer found nothing more"
reads exactly like a green light. So the moment the machine loop ends, the skill checks the human
gate: what the repository actually requires, whether a human review exists, and if not, who it
should be.

## What's here

| Path | What it is |
|---|---|
| [`SKILL.md`](SKILL.md) | The skill — the workflow, phase by phase |
| [`reference/github-mechanics.md`](reference/github-mechanics.md) | The exact `gh` CLI and GraphQL calls for each phase |

## Install

```bash
git clone https://github.com/rdok/address-pr-comments-skill.git

# Claude Code
cp -R address-pr-comments-skill ~/.claude/skills/address-pr-comments

# Copilot CLI
cp -R address-pr-comments-skill ~/.copilot/skills/address-pr-comments

# Grok
cp -R address-pr-comments-skill ~/.grok/skills/address-pr-comments

# OpenCode
cp -R address-pr-comments-skill ~/.config/opencode/skills/address-pr-comments
```

Then set two values at the top of `SKILL.md` in your copy: the organisation whose pull requests
are in scope, and where your repositories are checked out locally. Everything else is generic.

## The shape of a round

1. **Enumerate** open pull requests, oldest first, counting only *unresolved* threads.
2. **Gather** each comment with its permalink, dropping resolved threads and flagging outdated ones.
3. **Verify** each claim against the real code at the head commit — VALID with a failure path, or
   INVALID with the evidence that disproves it.
4. **Propose** the fix, opened in the editor for review — never committed without approval.
5. **Close** every comment: reply, then resolve, whether or not a commit was needed.
6. **Judge** whether another automated round is worth it — never "iterate until it reports zero".
7. **Check the human gate**, then hand off to the next pull request.

## Knowing when to stop

The stopping rule is the part most easily got wrong, so it is explicit:

- Another automated round is worth it when this round produced a **real, reproduced bug fixed with
  a behavioural change** — that fix is new code the first pass never saw.
- It is not worth it when the round produced only nits, rejections, or cosmetic edits, or when the
  reviewer starts re-flagging code it earlier accepted.
- Stop once human review is approved and tests are green.

One re-review after a batch of substantive fixes; a second only if the first found another
reproduced bug; by the third you are in nit territory.

## Finding the right human

In order, stopping at the first that answers: **CODEOWNERS**, then GitHub's **suggested
reviewers** (the people who recently changed these files), then **ask**. The skill never guesses
a name — handles are unique, and disambiguating people is a human's job.

## Licence

MIT — see [LICENSE](LICENSE).
