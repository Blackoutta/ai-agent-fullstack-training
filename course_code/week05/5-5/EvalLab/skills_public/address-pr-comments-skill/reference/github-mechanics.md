# GitHub mechanics — commands for address-pr-comments

Exact `gh` CLI and GraphQL calls for each phase. Replace `ORG`, `OWNER`, `REPO`, `NUM`, `CID`.

---

## 0. Enumerate the developer's pull requests

`gh pr list` is scoped to one repository; to sweep every repository the developer has open pull
requests in, use search. Scope it to your organisation and enumerate **oldest first**, with no
time cutoff, so a pull request that just picked up a fresh comment is never dropped:

```bash
gh search prs --author "@me" --owner ORG --state open \
  --sort created --order asc --limit 100 \
  --json number,title,url,createdAt,state,repository
```

Hitting `--limit` drops the *newest* pull requests, not the stale ones the sweep exists to
clear — so the oldest are always covered. Raise it or paginate if you genuinely exceed 100 open.

**Count only UNRESOLVED threads.** The raw `/comments` length counts resolved threads and your
own replies, so it overstates what is open. `isOutdated` comes along for free here and is worth
carrying into the report:

```bash
gh api graphql -f query='
{ repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: NUM) {
      reviewThreads(first: 100) { nodes { isResolved isOutdated } } } } }' \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length'
```

Review bodies (some reviewers bury suppressed low-confidence notes here, with no inline anchor):

```bash
gh api "repos/OWNER/REPO/pulls/NUM/reviews" --jq '[.[] | select(.body != "")] | length'
```

---

## 1. Gather comments with permalinks

Review bodies:

```bash
gh api "repos/OWNER/REPO/pulls/NUM/reviews" \
  --jq '.[] | "[\(.state)] \(.user.login)\n\(.html_url)\n\(.body)\n---"'
```

Inline comments — `html_url` is the permalink, `id` is needed to reply, `diff_hunk` is context:

```bash
gh api "repos/OWNER/REPO/pulls/NUM/comments" \
  --jq '.[] | "\(.path):\(.line // .original_line)\t\(.html_url)\tid=\(.id)\n\(.body)\nDIFF:\n\(.diff_hunk)\n==="'
```

**Keep only the unresolved ones**, with their outdated flag and whether you may resolve them.
Each thread's first comment `databaseId` is the `CID` you reply and resolve with:

```bash
gh api graphql -f query='
{ repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: NUM) {
      reviewThreads(first: 100) { nodes {
        isResolved isOutdated viewerCanResolve
        comments(first: 1) { nodes { databaseId path line url } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[]
        | select(.isResolved==false)
        | {cid: .comments.nodes[0].databaseId, path: .comments.nodes[0].path,
           line: .comments.nodes[0].line, url: .comments.nodes[0].url,
           outdated: .isOutdated, canResolve: .viewerCanResolve}'
```

---

## 2. Verify

Locate the canonical checkout under your configured roots:

```bash
for base in $CHECKOUT_ROOTS; do
  find "$base" -maxdepth 2 -type d -name "REPO" -not -path '*/node_modules/*' 2>/dev/null
done
```

If checked out, confirm the branch matches the pull request head, then read and run locally:

```bash
gh pr view NUM --json headRefName --jq '.headRefName'   # compare to `git branch --show-current`
git diff origin/main...HEAD -- PATH                      # what the pull request actually changed
```

If **not** checked out, read the exact file the reviewer saw, at the head SHA:

```bash
head=$(gh api repos/OWNER/REPO/pulls/NUM --jq '.head.sha')
gh api "repos/OWNER/REPO/contents/PATH?ref=$head" --jq '.content' | base64 -d
```

Match the project's pinned runtime before running repros or tests, or an engine mismatch will
fail the run and mislead you.

---

## 3–4. Apply — commit, reply, resolve

Commit on the pull request branch with your agent's co-author trailer, then push:

```bash
git commit -m "$(cat <<'EOF'
<type>: <subject>

Co-Authored-By: <your agent> <noreply@example.com>
EOF
)"
git push
```

Post the commit URL so the developer can check it:

```bash
echo "https://github.com/OWNER/REPO/commit/$(git rev-parse HEAD)"
```

**Reply** to an inline comment (`CID` from phase 1):

```bash
gh api "repos/OWNER/REPO/pulls/NUM/comments/CID/replies" \
  -f body="Fixed in <sha>. <one-line reason>." --jq '.html_url'
```

**Resolve** the thread — REST cannot do this; use the GraphQL mutation. Find the thread id by
matching the comment's `databaseId`, then resolve:

```bash
threadid=$(gh api graphql -f query='
{ repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: NUM) {
      reviewThreads(first: 100) {
        nodes { id isResolved comments(first: 1) { nodes { databaseId } } } } } } }' \
  --jq ".data.repository.pullRequest.reviewThreads.nodes[] | select(.comments.nodes[].databaseId == CID) | .id")

gh api graphql -f query='mutation($t:ID!){ resolveReviewThread(input:{threadId:$t}){ thread { isResolved } } }' \
  -f t="$threadid" --jq '.data.resolveReviewThread.thread.isResolved'
```

Requires a token with write scope.

---

## 5. Request another automated review (on the developer's approval)

Mechanical once approved — add the reviewer bot via the API rather than sending the developer
through the interface. The login differs per provider; for GitHub Copilot's reviewer:

```bash
gh api --method POST repos/OWNER/REPO/pulls/NUM/requested_reviewers \
  -f "reviewers[]=copilot-pull-request-reviewer[bot]"
```

Verify, then move on — bot reviews post asynchronously and can take several minutes:

```bash
gh api repos/OWNER/REPO/pulls/NUM --jq '.requested_reviewers[].login'
```

---

## 6. The human gate — what the repo requires, who has reviewed, who should

**What does the repository require?** Rulesets are the modern form; branch protection the older
one. Either may require approving reviews, in which case that is the real gate:

```bash
gh api repos/OWNER/REPO/rulesets --jq '.[] | {id, name, target, enforcement}'
gh api repos/OWNER/REPO/rules/branches/main --jq '.[] | .type' 
gh api repos/OWNER/REPO/branches/main/protection/required_pull_request_reviews \
  --jq '.required_approving_review_count' 2>/dev/null
```

Rulesets on a private repository need a paid plan; a 403 here means "cannot tell", not "no rule".
Report that honestly rather than assuming the gate is absent.

**Has a human reviewed it?** Ignore bot entries — check the reviewer's `__typename` / type rather
than pattern-matching the login:

```bash
gh pr view NUM --repo OWNER/REPO --json reviewRequests,latestReviews
```

**Who should review it?** Ask these in order, stopping at the first that answers.

1. **CODEOWNERS** — declarative and authoritative where it exists. GitHub may already have
   requested them:

```bash
gh api "repos/OWNER/REPO/contents/.github/CODEOWNERS" --jq '.content' | base64 -d
gh api repos/OWNER/REPO/codeowners/errors --jq '.errors | length'   # 0 = file parses
```

2. **GitHub's suggested reviewers** — the people who recently changed these files. `isAuthor` and
   `isCommenter` tell you why each was suggested:

```bash
gh api graphql -f query='
{ repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: NUM) {
      suggestedReviewers { isAuthor isCommenter reviewer { login name } } } } }' \
  --jq '.data.repository.pullRequest.suggestedReviewers[]'
```

3. **Ask the developer.** If neither answers, ask who should review — do not guess a name.

Request it on their approval:

```bash
gh api --method POST repos/OWNER/REPO/pulls/NUM/requested_reviewers \
  -f "reviewers[]=LOGIN"
```
