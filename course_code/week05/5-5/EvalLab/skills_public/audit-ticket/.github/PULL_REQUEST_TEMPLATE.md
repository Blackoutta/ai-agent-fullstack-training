<!-- One theme per PR. Fill every section; "n/a" is fine, empty is not. -->

## What

<!-- One or two sentences: what this PR adds or changes. -->

## Why

<!-- The gap it closes, the incident / spec / audit report it is grounded in, or the bug it fixes. -->

## Corpus impact

- Checklist items: <!-- e.g. +6 (FE-077..FE-082) / none -->
- Known vectors: <!-- e.g. +1 (KV-134) / none -->
- Methodologies / references: <!-- e.g. new references/methodologies/x.md / edited token-2022.md §9 / none -->
- Counts and index updated: <!-- yes — scripts/check-corpus.sh passes locally / n/a -->

## Evidence

<!-- For new vectors or items: the public incident, spec, audit report or program documentation each claim rests on. Links preferred. -->

## Checklist

- [ ] One coherent theme; unrelated changes split out
- [ ] `bash scripts/check-corpus.sh` passes locally
- [ ] New vectors / items are checkable from code (grep + PASS / FAIL shape)
- [ ] Cited incidents are real and public; no invented figures
- [ ] No AI-attribution trailers in any commit; no secrets, `.env`, state or local assistant files tracked
- [ ] Version line untouched (content PR) **or** this is the release PR and every version reference moved together

## Stacked on

<!-- If this branch is based on another open PR, name it and the merge order. Otherwise "n/a". -->
