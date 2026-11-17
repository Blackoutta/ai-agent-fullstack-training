# Methodology — Token Registries, Canonical-Asset Resolution & Risk-Signal Consumers (Audit Checks)

> **Load when:** the codebase **resolves a human identifier to a mint**, **ranks or labels mints**, or
> **gates behaviour on a third-party trust / risk signal** — grep markers:
> `tokens.xyz` · `api.tokens.xyz` · `assetId` · `canonical` · `token list` / `tokenlist` / `strict` list ·
> `coingeckoId` · `getTokenBySymbol` / `resolveMint` · `trustTier` / `liquidityTier` · `risk_score` / `riskScore` ·
> `rugcheck` · `webacy` · `goplus` · `birdeye` · `verified` badge · `primaryVariant` / `primary_variant`.
>
> **Purpose:** protocol-specific checks for two roles.
> **(A) Registry consumers** — any dApp, wallet, aggregator, DAO tool, indexer, trading bot or AI agent that
> turns a symbol / name / CoinGecko id / canonical asset id into a **mint address**, or that decides listing,
> collateral eligibility, routing, display or a "verified" badge from a **registry-provided trust or risk
> signal**. **(B) Registry operators** — services that *publish* a token list, a canonical-asset → mint mapping,
> a primary-variant choice, or a risk score (the open-sourced tokens.xyz stack, a Jupiter-style strict list,
> a RugCheck-style scorer). The scope is the integration seam: the registry is an **off-chain oracle for
> identity and trust**, and identity oracles are manipulable in ways price oracles are not — there is no
> market to arbitrage a wrong `symbol → mint` mapping; users simply lose funds. These checks sit on top of
> the language-agnostic checklists (`checklists/06`, `08`–`10`) and the Token-2022 methodology
> (`references/methodologies/token-2022.md`); where a generic check covers the base case the note says
> *"beyond `<ID>`, also verify…"*.
>
> **How to use:** each section is an auditor check — *safe shape*, *failure mode*, *grep*. PASS = safe shape
> enforced *in code*; FAIL = failure mode reachable. Consumer worksheets are §3, operator worksheets §4.
>
> **Why this surface is dense:** on Solana **only the mint address is identity**. Name, symbol, logo and URI
> are attacker-writable metadata (Metaplex Token Metadata or the Token-2022 `MetadataPointer` extension), and
> one real-world asset (USDC, wBTC, a tokenized stock) legitimately has **many mints** — native, bridged via
> several bridges, wrapped, yield-bearing, leveraged. A registry collapses that many-to-one mess into a
> *canonical asset* with a *primary variant*, then decorates it with tiers and scores. Every one of those
> decisions is an attack surface: get a hostile mint accepted as a variant, get it promoted to primary, get a
> good score on a bad token, or get a consumer to auto-follow a registry change.

---

## 0. Classify FIRST — what does the registry decide for you?

List every decision the code delegates to the registry. The severity of everything below scales with the
worst cell reached.

| Decision delegated | Consumer failure if the registry is wrong / poisoned | Typical code marker |
|---|---|---|
| **Display** — name, symbol, logo, links | phishing UI, stored XSS via logo / URI, homoglyph symbol (`USDC` vs `USDС`) | `token.symbol`, `token.logoURI`, `<img src={logo}>` |
| **Symbol → mint resolution** for swap / transfer / payment | the user's value goes to the attacker's mint; "buy USDC" buys a fake | `getTokenBySymbol`, `resolve(`, `search(`, `bySymbol` |
| **Listing / tradability** | scam token listed with a green badge; real token delisted (DoS) | `isVerified`, `strict`, `curated`, `allowlist` |
| **Collateral / eligibility** in a protocol | hostile mint accepted as collateral → bad debt, freeze-DoS, permanent-delegate drain | `collateral_factor` keyed off a list, `acceptedMints` fetched at runtime |
| **Primary-variant selection** among several mints of one asset | protocol treats a bridged / wrapped / fake variant as "the" asset; fungibility assumed across bridges | `primaryVariant`, `variants[0]`, `rankVariants` |
| **Risk tier / grade gating** | "grade A" bypasses mint-authority / freeze / extension checks; provider outage becomes "safe" | `riskScore >`, `grade === 'A'`, `tier1` |

**Role check.** If the codebase *publishes* any of these (a list endpoint, a `/risk` endpoint, a curated
collection, an admin panel that edits assets), it is also an **operator** — apply §4 in addition to §3.

```
grep -rn -iE "tokens\.xyz|tokenlist|token_list|token-list|strict.?list|getTokenBySymbol|resolveMint|assetId|canonical|primaryVariant|coingeckoId" --include="*.ts" --include="*.tsx" --include="*.rs" --include="*.py" .
grep -rn -iE "riskScore|risk_score|trustTier|liquidityTier|isVerified|verified|rugcheck|webacy|goplus|birdeye" --include="*.ts" --include="*.tsx" --include="*.rs" --include="*.py" .
```

---

## 1. Threat model of an identity oracle

Price oracles fail on *value*; identity oracles fail on *which thing*. The attacker goals, in order of payoff:

1. **Become the resolved mint.** Register a mint whose metadata matches a real asset (same symbol / name /
   logo), then get the consumer's `symbol → mint` lookup, search, or "did you mean" to return it. Cost: a
   mint + metadata (dust). Payoff: every user who types the symbol.
2. **Become a variant, then the primary.** Registries that group mints into one canonical asset choose a
   primary by **liquidity, volume, trade count, holder count, curated rank, or lexical tie-break**. Each of
   those is an economic or trivial input: seed a pool, wash-trade it, dust-airdrop holders, grind a mint
   address that sorts first. A hijacked primary flips the mint every downstream consumer uses for "USDC".
3. **Score a bad token well.** Market-structure scores (liquidity tier, top-10 concentration, holder count,
   age, volume) are computed from inputs the issuer controls; **mint-level facts** (mint authority live,
   freeze authority live, permanent delegate, mutable metadata, LP unlocked) are the non-farmable ones and
   are frequently *not* in the score. A consumer that reads "A / Established" as "safe" skips the checks
   that would have caught the rug.
4. **Poison through the pipeline.** Upstream aggregators (CoinGecko id squatting, DEX-derived liquidity),
   third-party risk feeds (unschema'd JSON merged into the response), admin / curator edits with
   last-writer-wins provenance, and client-side list snapshots that never refresh.
5. **Exploit the registry's own trust in itself.** Category exemptions ("stocks and LSTs are exempt from the
   concentration cap"), "trusted launch" score floors for tokens in curated lists, and singleton /
   auto-generated ids for unknown mints that inherit verified styling in the UI.

**Consequence framing for severity.** A wrong resolution on a *display* path is phishing (5–6). On a
*swap / transfer / payment* path it is direct loss of user funds (8–9). On a *collateral / listing* path in a
protocol it is protocol insolvency or freeze-DoS (8–10, see `token-2022.md` T4 / T5).

---

## 2. Invariant catalog

For every registry consumer and operator, the following must hold. Evidence (test / review note) per item.

| # | Invariant | Failure = |
|---|-----------|-----------|
| **R1** | **Identity is the mint address (+ token program id)** — no trust, balance, routing or accounting decision is keyed on `symbol`, `name`, `coingeckoId` or a registry `assetId` alone | Symbol squatting resolves to a hostile mint |
| **R2** | **Value-moving resolutions are pinned at integration time** — the mint for a swap / transfer / collateral / payment path is a constant or an on-chain allowlist; the registry is consulted for *display* and *alerts*, and a registry change to a primary mint is a human / governance decision, never auto-followed | Primary-variant hijack propagates to every consumer instantly |
| **R3** | **Variants are separate trust domains** — bridged / wrapped / yield / leveraged variants of one asset are not treated as fungible with each other; each carries its bridge / wrapper trust (cross-ref `bridges.md` B8) | "Same assetId" → 1:1 swap or shared collateral bucket across bridges |
| **R4** | **Risk score / tier is advisory, never authorization** — no code path maps a grade or tier to *skipping* mint-authority, freeze-authority, permanent-delegate, metadata-mutability or LP-lock checks (`token-2022.md` T4 / T5 / T10 still run) | "Grade A" rug |
| **R5** | **Fail closed** — registry unavailable, stale beyond bound, or "unknown mint" ⇒ treat as *unlisted / unverified*; auto-generated singleton ids for unknown mints never inherit verified UI or default-safe scores | Provider outage becomes a listing bypass |
| **R6** | **Metadata is untrusted content** — name / symbol / description rendered as text, logos served through a content-type-sniffing proxy or allowlisted host, URIs `https:`-only and allowlisted, homoglyph / zero-width characters normalised or flagged | Stored XSS / SSRF / lookalike phishing through token metadata |
| **R7** | **Manipulation-priced ranking inputs are bounded and mixed with non-gameable ones** — any listing / primary / tier decision that uses liquidity, volume, trades, holder count, concentration or age also requires at least one input the issuer cannot cheaply fake (curated rank, issuer attestation, on-chain authority state) and applies hysteresis (minimum dwell time before a flip) | Wash-liquidity primary flip, holder-count dusting |
| **R8** | **Provenance and change control on every registry mutation** — source (automated seed vs admin), actor, timestamp; admin overrides are visible, reviewable and expire or are re-reviewed; seeds cannot silently revert admin corrections and admin edits cannot silently persist forever | Last-writer-wins poisoning; un-audited curator edits |
| **R9** | **Freshness is explicit** — operators publish `as_of` / `stale`; consumers bound the age they accept; caches are keyed on the normalised mint (never on user-controlled query text) | Stale primary served after a fix; cache poisoning |
| **R10** | **Least-privilege distribution** — API keys are scoped (`assets:read` vs `assets:risk:read`), server-side only, revocable (BE-110..117); list snapshots embedded in clients carry a hash / version and refresh on a schedule | Leaked key → scraping / quota theft; frozen client list |

---

## 3. Consumer worksheets (per code path)

Each worksheet lists the safe shape. FAIL if any line is missing on any reachable path.

### Display (token pickers, portfolio, explorers)
- Symbol / name rendered as text; **mint address (shortened) always shown next to it**; lookalike symbols
  (Unicode confusables, trailing spaces, zero-width joiners) normalised or visibly flagged (R6).
- Logo loaded through an image proxy or `next/image` `remotePatterns` allowlist (FE-082); SVG logos
  sanitised or rasterised (FE-063); no `dangerouslySetInnerHTML` on descriptions (FE-001).
- "Verified" / tier badge maps to a *documented* registry semantics string, and an **unknown / singleton**
  asset renders with an explicit *unverified* treatment, never the default styling (R5).

### Symbol → mint resolution (swap, send, pay, quote)
- The value path uses a **mint address the user or config supplied**, or a pinned constant — the symbol
  search only *suggests*; the confirmation screen shows the resolved mint and the user signs for that mint
  (R1 / R2). Beyond `FE-033` (simulate before sign): the simulated token account **mint** must equal the
  displayed one.
- If the registry returns several mints for one symbol, the UI shows all with their tier and the
  **primary is not silently chosen** for value paths (R2 / R3).
- Aggregator / router integrations pass the mint, never the symbol, and validate the route's input / output
  mints against the pinned pair after quoting (cross-ref `launchpads.md` §2 `execute_swap`).

### Collateral / listing eligibility (lending, perps, launchpads, DAOs)
- Accepted mints live in an **on-chain allowlist or program config** (`token-2022.md` §4); the registry may
  *propose* additions but a governance / admin instruction adds them (R2). Beyond `AV-066` (mint allowlist):
  the allowlist entry stores the mint *and* the token program id.
- A registry grade / tier is never a substitute for the on-chain checks: mint authority, freeze authority,
  permanent delegate, extension set, metadata mutability, LP lock (R4).
- Delisting from the registry triggers an **alert and a review**, not an automatic liquidation or freeze
  (a registry outage must not liquidate users) (R5).

### Wallet send / receive & payment links
- Payment requests (Solana Pay–style URLs, invoices) carry the **mint address**; a symbol-only request is
  rejected or resolved through a pinned map with user confirmation (R1).
- Airdrop / incoming-token display uses the registry for labels only; unknown mints are quarantined in the
  UI ("unknown token"), never auto-labelled from their own metadata alone (R5 / R6).

### Indexers, bots, keepers and AI agents
- A trading bot or agent that consumes a token list treats it as **untrusted input** (AI-018): the list
  cannot expand the agent's mint allowlist (AI-004..006) and a "verified" flag cannot raise a spend cap.
- Keepers acting on a registry signal (delist → liquidate, tier change → rebalance) require the on-chain
  fact to agree (KV-122 posture: off-chain signals are hints).

---

## 4. Operator worksheets (if the codebase publishes a registry)

### Ingestion of on-chain metadata
- Metadata is read via the official accessors (Metaplex `Metadata` deserializer; `spl_token_metadata_interface`
  for Token-2022 `MetadataPointer`) and the **pointed account's owner program is validated** (T7 in
  `token-2022.md` S8); a mint whose metadata pointer targets an account owned by an unexpected program is
  quarantined.
- `name` / `symbol` / `uri` are length-bounded, Unicode-normalised, and stored raw + normalised; the
  normalised form drives search and collision detection (R6).
- Fetching `uri` JSON and logos happens in a sandboxed fetcher with host allowlist, size cap, content-type
  sniffing and no redirects to private ranges (SSRF, BE-018 / KV-036).

### Canonical grouping & primary-variant ranking
- Candidate variants for an asset are **curated** (a human or a signed issuer attestation adds a mint to an
  asset); metadata similarity alone never groups a mint under a canonical asset (R1 / R7).
- The primary-variant chooser mixes at least one non-gameable input (curated rank, issuer attestation) with
  the market inputs; **lexical / address tie-breaks are disabled** for anything value-bearing (a mint
  address can be vanity-ground to sort first) (R7).
- Activity-outlier filters (median / MAD or z-score gates on volume and trade counts) exist *and* are tested
  against a wash-trading fixture; a primary flip requires a **minimum dwell time** and emits an event to an
  operator alert channel (R7 / R8).
- Liquidity used for ranking is **depth at a bounded price impact** (or TVL locked ≥ N days), not headline
  pool TVL — deposit-and-withdraw liquidity flips a naive ranking for one snapshot.

### Score / grade computation
- Every threshold is treated as **public** (open-source or reverse-engineerable). For each input, the review
  records *cost-to-game* vs *payoff*: liquidity (temporary own-liquidity), top-N concentration (split across
  wallets, ≈ free), holder count (dust airdrop, rent-only), age (wait), volume (wash, pays only fees). Inputs
  with cost ≪ payoff are **capped in weight** and paired with mint-level facts (R7).
- The score explicitly **includes or explicitly disclaims** mint-level facts: mint authority, freeze
  authority, permanent delegate, transfer hook / fee, metadata mutability, LP lock. If disclaimed, the API
  and UI say so and expose them as separate fields (R4).
- **Category exemptions** (e.g. concentration cap waived for stocks / LSTs / currencies) and **score floors**
  ("trusted launch" bump for curated lists) are privilege escalations — the path that assigns a category or
  list membership is admin-only, audited (R8), and the exemption cannot be reached by self-declared metadata.
- "Insufficient data" is a distinct, non-safe state in the API contract (never `score: 0` with `grade: A`,
  never omitted) (R5).

### Third-party risk feeds (Webacy / GoPlus / RugCheck-style)
- Responses are parsed through a schema before merge (BE-118); a provider error or timeout yields
  `unavailable`, never a default-safe value (BE-119 / R5).
- Provider-sourced flags are attributed (`source: webacy`) so consumers can weight them; the operator's own
  computed fields and third-party fields are never silently blended into one number.

### Curation, admin panel & provenance
- Every asset / collection mutation stores `source` (`registry` seed vs `admin`), actor id, timestamp;
  admin overrides are listed in a review view and either expire or require periodic re-approval (R8).
- The automated seed cannot overwrite an admin correction, **and** an admin edit cannot suppress a seed
  update forever without a visible flag ("admin-pinned since <date>").
- Admin routes sit behind the strongest auth tier the app has (BE-008), are rate-limited, and log a diff.

### Publication (API, lists, embeds)
- API keys: hashed + prefixed storage, per-route scopes, immediate revocation, metering, redaction
  (BE-110..117). Anonymous / public endpoints are rate-limited per IP with proxy-header hardening (BE-034).
- Published list snapshots carry a version and a content hash; consumers can pin and verify; breaking
  changes (a primary flip, a delist) are announced through a changelog / webhook, not only by diffing.
- Every response carries `as_of` (or `stale`) and a request id (R9).

---

## 5. Gaming economics — the review table

For each ranking or score input the code uses, fill in this table; any row whose cost is far below the
payoff of a hijacked listing is a **R7 finding** unless a non-gameable input is required alongside it.

| Input | How an attacker moves it | Typical cost | Non-gameable counterpart |
|---|---|---|---|
| Pool liquidity (USD) | seed own pool; withdraw after the snapshot | capital *temporarily*, ≈ free | LP tokens locked / burned ≥ N days; depth at bounded impact |
| Top-10 holder share | split supply across wallets | ≈ free | issuer-disclosed treasury wallets + attestation |
| Holder count | dust-airdrop to N wallets | rent for N token accounts | holders with ≥ X USD *and* ≥ Y days |
| 24h / 7d volume | wash trades against own pool | pool fees only | volume from *distinct* counterparties with independent funding |
| Token age | wait | time | none — treat as weak |
| Curated list membership / category | social engineering of curators; admin-panel compromise | variable | signed issuer attestation; multi-party curation |
| Mint authority / freeze authority / permanent delegate / metadata mutability | **cannot be faked** — on-chain, read at use-time | — | this is the counterpart |

---

## 6. High-density surfaces (fastest findings)

- **S1 — Symbol-keyed value path (R1).** A swap / send / pay flow that resolves `symbol → mint` at runtime
  from a registry search and uses the first hit. Beyond `FE-033` / `FE-039`: assert the signed transaction's
  mint equals the one shown.
- **S2 — Auto-followed primary (R2).** A backend or program config that refreshes "the USDC mint" from a
  registry endpoint on a timer with no human gate. One registry flip = every user routed to the new mint.
- **S3 — Grade ⇒ skip (R4).** `if (risk.grade === 'A') return ok` or a lending market that reads
  `tier1` as collateral-eligible without reading the mint's authorities / extensions.
- **S4 — Default-safe on outage (R5).** `catch { return { score: 0, flags: [] } }` or a UI whose *no data*
  state is indistinguishable from *no issues*.
- **S5 — Metadata into the DOM / fetcher (R6).** `logoURI` straight into `<img>` / `fetch()`; description
  into `dangerouslySetInnerHTML`; symbol used as a map key without normalisation.
- **S6 — Public thresholds with cheap inputs (R7).** Ranking or scoring code whose every input is in the
  table in §5 with cost ≈ free, and no curated / attested input, no dwell time, and a lexical tie-break.

---

## 7. Detection recipes

```
# Consumer: symbol-keyed resolution feeding a value path
grep -rn -iE "getTokenBySymbol|bySymbol|findToken\(|tokens\.find\(.*symbol|search\(.*symbol" --include="*.ts" --include="*.tsx" .
grep -rn -iE "swap|transfer|send|pay|quote" --include="*.ts" --include="*.tsx" . | grep -iE "symbol"

# Consumer: registry-driven config refresh (auto-follow)
grep -rn -iE "setInterval|cron|schedule|revalidate" --include="*.ts" . | grep -iE "token|mint|asset|registry|list"

# Consumer: grade / tier used as authorization
grep -rn -iE "grade *===? *[\"']A|tier1|isVerified|verified *&&|riskScore *[<>]" --include="*.ts" --include="*.tsx" --include="*.rs" .

# Consumer: fail-open on provider error
grep -rn -B2 -A6 -iE "catch" --include="*.ts" . | grep -iE "score: *0|flags: *\[\]|risk: *null|safe"

# Consumer / operator: metadata into DOM or fetcher
grep -rn -iE "logoURI|logo_uri|image|uri" --include="*.tsx" . | grep -iE "<img|src=|fetch\("

# Operator: ranking inputs & tie-breaks
grep -rn -iE "liquidity|volume|trades|holders|concentration|age|lexical|localeCompare|tieBreak|rank" --include="*.ts" packages/ apps/ | grep -iE "primary|variant|score|tier"

# Operator: category exemptions / score floors
grep -rn -iE "exempt|floor|bump|trusted|minScore|override" --include="*.ts" packages/ apps/ | grep -iE "score|tier|rank"

# Operator: provenance on mutations
grep -rn -iE "source|admin_edited|edited_by|updated_by|provenance" db/ apps/ --include="*.sql" --include="*.ts"
```

---

## 8. Test / PoC strategy

- **Symbol-collision fixture (R1).** Two mints with identical `symbol` / `name` / logo; one real, one hostile.
  Drive every resolution path (search, URL param, payment link, agent prompt) and assert the value path
  cannot end on the hostile mint without an explicit mint-address choice.
- **Primary-flip simulation (R7).** On a fork (Surfpool) or a fixture, seed liquidity / wash volume / dust
  holders on a hostile variant until the ranker prefers it; assert dwell-time, curated-input and alerting
  gates block the flip; assert consumers with pinned mints are unaffected.
- **Registry-outage drill (R5).** Stub the registry / risk provider to timeout, 500, 429 and malformed JSON;
  assert every consumer path renders *unavailable / unverified* and no listing, collateral or swap decision
  proceeds as *safe*.
- **Metadata payload fixture (R6).** Mint with SVG-script logo, `javascript:` / private-range `uri`,
  confusable symbol, 10 KB name; assert sanitisation, proxying, truncation and normalisation.
- **Cache-key poisoning (R9).** Vary query casing / whitespace / extra params on a cached lookup; assert the
  cache key is the normalised mint and a poisoned entry cannot be served to other users.
- **Provenance replay (R8).** Admin edit → seed run → assert the edit persists *and* is flagged; expire the
  override → assert the seed value returns; every step present in the audit log with actor + timestamp.
- **Grade-bypass negative test (R4).** A mint with live freeze authority + permanent delegate that scores
  grade A on market metrics; assert every collateral / listing path still rejects it.

---

## Token-registry / risk-consumer checklist (fast pass)

- [ ] No trust, balance, routing or accounting decision is keyed on symbol / name / `assetId` — mint address (+ token program) is identity (R1)
- [ ] Value-moving mints are pinned or on an on-chain allowlist; registry changes to a primary mint require a human / governance step (R2)
- [ ] Variants (bridged / wrapped / yield) are separate trust domains, never treated as fungible by shared `assetId` (R3)
- [ ] Risk grade / tier never skips mint-authority / freeze / permanent-delegate / extension / LP-lock checks (R4)
- [ ] Registry or risk-provider outage, staleness or unknown mint ⇒ *unverified*; singleton ids never inherit verified UI (R5)
- [ ] Metadata rendered as text; logos proxied / allowlisted; URIs `https:` + allowlisted; confusable symbols normalised or flagged (R6)
- [ ] Ranking / scoring uses ≥ 1 non-gameable input, weight-caps cheap inputs, applies dwell time, disables lexical tie-breaks (R7)
- [ ] Every registry mutation carries source / actor / timestamp; admin overrides are visible and re-reviewed; seeds cannot silently revert corrections (R8)
- [ ] `as_of` / `stale` published and bounded by consumers; caches keyed on normalised mint (R9)
- [ ] API keys scoped, hashed, revocable, redacted; list snapshots versioned + hashed (R10 / BE-110..117)
- [ ] Symbol-collision, primary-flip, outage, metadata-payload and grade-bypass tests exist and pass (§8)

*Public references: the open-sourced tokens.xyz monorepo (solana-foundation/tokens, Aug 2026 — asset
registry with canonical assets / variants / liquidity tiers, a liquidity-volume-curation primary-variant
ranker, a market-structure score with public thresholds and category exemptions, third-party risk feeds
merged server-side, admin-vs-seed provenance); the archival of the original `solana-labs/token-list`
repository after symbol / name squatting made a PR-curated list unmaintainable; the Jupiter strict /
verified list model; Metaplex Token Metadata and Token-2022 `MetadataPointer` semantics. Cross-refs:
`KV-107` (canonical-ATA assumptions), `KV-105` / `token-2022.md` T4 / T5 / T10 (mint-level facts a score
omits), `KV-122` (off-chain signals are hints), `AI-018` (token metadata into an LLM), `BE-110..123`
(API-key issuance, data-provider integrity), `FE-063` / `FE-082` (SVG + remote images), `bridges.md` B8
(wrapped variants).*
