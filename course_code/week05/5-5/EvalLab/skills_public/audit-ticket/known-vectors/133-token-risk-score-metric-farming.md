---
id: 133
title: "Token Risk-Score / Trust-Tier Metric Farming"
severity: 6
category: backend
---

### 133 — Token Risk-Score / Trust-Tier Metric Farming

**Severity: 6** | **Real: public-threshold market-structure scores (liquidity tiers, top-10 holder share, holder count, token age, volume) as shipped in the open-sourced tokens.xyz registry (solana-foundation/tokens, 2026) and in RugCheck / GoPlus / Webacy-style feeds; "grade A" tokens that later rugged through a live mint or freeze authority the score never looked at**

Registries and risk providers compress a token into a **grade / tier / score** and consumers gate listing, collateral, routing or a badge on it. Two things go wrong:

- **The inputs are farmable.** Market-structure metrics are computed from state the issuer controls at low cost: pool liquidity (deposit, snapshot, withdraw), top-N holder concentration (split supply across wallets — free), holder count (dust-airdrop; costs only token-account rent), volume (wash trades against your own pool — costs only fees), age (wait). When the thresholds are public — they are, once the code is open source or the API is probed — an attacker tunes each input to just clear the next tier. Category exemptions ("stocks / LSTs skip the concentration cap") and score floors ("curated-list tokens get at least a B") add privilege escalations reachable through whatever assigns the category or list membership.
- **The score omits what actually rugs.** Mint authority live (infinite mint), freeze authority live (freeze-DoS), permanent delegate (seizure), transfer hook / fee, mutable metadata, unlocked LP — the **non-gameable, on-chain facts** — are often not in the market score at all, or are sourced from a third-party feed that fails open. A consumer that reads "A / Established" as "safe" skips exactly the checks (`token-2022.md` T4 / T5 / T10) that catch the rug.

The consumer-side bug is **score ⇒ authorization**: a grade or tier substituting for on-chain checks, or a provider outage collapsing to a default-safe value. The operator-side bug is a score whose every input costs the attacker less than a hijacked listing pays, with no non-gameable input, no weight caps, and exemptions reachable from self-declared data.

> Cross-ref: `references/methodologies/token-registry-risk.md` (R4 score is advisory, R5 fail closed, R7 manipulation-priced inputs, §5 gaming-economics table); KV-132 (identity spoofing — the sibling on the *which mint* axis); BE-118 / BE-119 (schema-validated, fail-closed providers); KV-105 / `token-2022.md` (the mint-level checks a score must not replace); checklist 06 collateral-eligibility items for lending consumers.

#### Verification Procedure

**Step 1: Find where a score / grade / tier is consumed and what it authorizes**
```
grep -rn -iE "riskScore|risk_score|grade|tier1|tier2|trustTier|liquidityTier|isVerified|verified|rugcheck|webacy|goplus|birdeye" --include="*.ts" --include="*.tsx" --include="*.rs" --include="*.py" .
grep -rn -iE "grade *===? *[\"'][AB]|score *[<>]=? *[0-9]|tier *===? *[\"']tier1|verified *&&|if *\(.*(verified|grade|tier)" --include="*.ts" --include="*.tsx" --include="*.rs" .
```
- Record: each consumption site and the decision it gates — badge (display), listing / search ranking, routing, collateral / borrow, spend cap, agent allowlist.
- ✅ PASS: the score gates **display and ordering** only, or gates a decision *in addition to* on-chain checks
- ❌ FAIL: a grade / tier / `verified` flag is the sole condition for listing, collateral eligibility, a routing shortcut, or a raised spend cap

**Step 2: Score never replaces mint-level checks**
```
grep -rn -iE "mint_authority|mintAuthority|freeze_authority|freezeAuthority|permanent_delegate|PermanentDelegate|transfer_hook|TransferFee|is_mutable|isMutable|lp.?lock|burned" --include="*.ts" --include="*.rs" .
```
- ✅ PASS: every listing / collateral / acceptance path reads the mint authorities, extension set and metadata mutability itself (or via an on-chain allowlist that was populated after those checks) regardless of the score
- ❌ FAIL: a high grade short-circuits those reads (`if (grade === 'A') return eligible`), or the only source of "freeze authority" is a third-party feed

**Step 3: Provider outage / unknown token fails closed**
```
grep -rn -B2 -A8 -iE "catch|\.catch\(|onError|fallback" --include="*.ts" . | grep -iE "score: *0|flags: *\[\]|risk: *(null|undefined)|safe|grade: *[\"']A"
grep -rn -iE "insufficient|unavailable|unknown|stale|as_of|asOf" --include="*.ts" --include="*.tsx" .
```
- ✅ PASS: timeout / 429 / 500 / malformed JSON from the provider yields an explicit `unavailable` state that every consumer renders as *unverified* and no listing / collateral / swap decision treats as safe; "insufficient data" is a distinct non-safe state; an unknown mint (singleton / auto-generated id) never inherits a verified score
- ❌ FAIL: errors collapse to `score: 0` / empty flags / cached "clean"; the UI *no data* state is indistinguishable from *no issues*

**Step 4 (operator): Cost-to-game each input**
```
grep -rn -iE "liquidity|volume|trades|holders|concentration|top10|topHolders|age|createdAt" --include="*.ts" packages/ apps/ | grep -iE "score|tier|grade|threshold|weight"
grep -rn -iE "exempt|floor|bump|trusted|minScore|override|category" --include="*.ts" packages/ apps/ | grep -iE "score|tier|grade"
```
- Fill the §5 table from `token-registry-risk.md` for each input: how it is moved, at what cost, and what non-gameable counterpart exists.
- ✅ PASS: inputs with cost ≈ free (concentration, holder count, headline TVL, wash volume) are weight-capped and paired with at least one non-gameable input (mint / freeze authority state, LP lock, issuer attestation, curated rank); liquidity is depth-at-impact or locked-for-N-days; **category exemptions and score floors are assigned only by admin-audited paths**, never from self-declared metadata; thresholds are treated as public
- ❌ FAIL: the score is a weighted sum of issuer-controlled metrics only; a self-assigned category or list membership unlocks an exemption or floor; thresholds are assumed secret

**Step 5 (operator): Third-party feed handling**
- ✅ PASS: provider responses are schema-validated (BE-118), attributed (`source:`), cached with a bounded TTL, and a provider failure surfaces as `unavailable` (BE-119); provider fields and own-computed fields are not blended into one opaque number
- ❌ FAIL: unvalidated provider JSON is merged straight into the response; a provider error is swallowed into a default

**Step 6: Freshness and caching**
- ✅ PASS: the API publishes `as_of` / `stale`; consumers bound the accepted age; caches are keyed on the normalised mint, not on user-controlled query text
- ❌ FAIL: scores are served with no age; a cached grade survives a mint-authority change; cache keys include raw query strings

**Overall verdict:**
- ✅: Score / tier is advisory; every acceptance path performs its own mint-level checks; provider outages and unknown tokens fail closed; (operator) cheap inputs are weight-capped and paired with non-gameable ones, exemptions are admin-only, feeds are schema-validated and attributed
- ⚠️: Score is advisory on value paths but the UI *unavailable* state looks like *clean*; or the operator score includes mint-level facts but exemptions / floors are reachable from category data without audit
- ❌: A grade / tier / `verified` flag alone lists a token, admits collateral, shortcuts routing or raises an agent spend cap; or a provider failure returns default-safe; or the operator score is a public-threshold sum of freely farmable inputs
- N/A: The codebase neither consumes nor publishes any token risk score, grade, tier or verified flag
