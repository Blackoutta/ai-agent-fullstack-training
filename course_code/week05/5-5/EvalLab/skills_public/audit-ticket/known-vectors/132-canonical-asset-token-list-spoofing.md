---
id: 132
title: "Canonical-Asset / Token-List Spoofing & Primary-Variant Hijack"
severity: 8
category: crypto
---

### 132 — Canonical-Asset / Token-List Spoofing & Primary-Variant Hijack

**Severity: 8** | **Real: the original `solana-labs/token-list` was archived after symbol / name squatting and impersonation PRs made a curated list unmaintainable; lookalike-token phishing on DEX aggregators and wallets is a standing incident class; the open-sourced tokens.xyz registry (solana-foundation/tokens, 2026) documents the many-mints-per-asset model — native, bridged, wrapped, yield variants — with a primary variant chosen by liquidity, volume, curated rank and tie-breaks**

On Solana **only the mint address is identity**. `name`, `symbol`, logo and `uri` are writable metadata that any mint can set (Metaplex Token Metadata or the Token-2022 `MetadataPointer` extension), and one real asset legitimately has **many mints** — USDC native plus several bridged versions, wBTC via different bridges, tokenized stocks from several issuers. Token registries collapse that into a *canonical asset* with a *primary variant* and hand consumers a `symbol → mint` answer. Two attacks follow:

- **Spoofing.** An attacker mints a token whose metadata matches a real asset and gets a consumer's search / `getTokenBySymbol` / payment link / agent prompt to resolve to it. Any value path that takes the first hit, or that keys trust on symbol, routes user funds to the attacker.
- **Primary-variant hijack.** Where a registry ranks several mints of one asset, the ranking inputs (pool liquidity, 24h volume, trade count, holder count, curated rank, lexical / address tie-break) are cheap to move: seed a pool and withdraw after the snapshot, wash-trade, dust-airdrop, or vanity-grind a mint that sorts first. Once the hostile mint is "primary", every consumer that auto-follows the registry — a backend refreshing "the USDC mint" on a timer, a router reading `variants[0]`, a lending market syncing its accepted list — switches to it in one refresh.

The consumer-side root cause is the same in both: **the registry is treated as an authority for identity on a value-moving path**, instead of a display / alert source over a mint that was pinned at integration time. The operator-side root cause is a ranker or grouper whose every input is issuer-controlled at low cost, with no curated / attested input, no dwell time, and lexical tie-breaks.

> Cross-ref: `references/methodologies/token-registry-risk.md` (R1 identity = mint, R2 pinned value paths, R3 variants are separate trust domains, R7 manipulation-priced ranking); KV-107 (canonical-ATA assumptions — the token-account analogue of this vector); KV-133 (score / tier farming — the trust-signal sibling); `token-2022.md` S8 (metadata-pointer spoofing); AI-018 (token metadata as prompt-injection surface).

#### Verification Procedure

**Step 1: Find every symbol- or name-keyed resolution and what it feeds**
```
grep -rn -iE "getTokenBySymbol|bySymbol|findToken\(|tokens\.find\(|search\(|resolve\(|coingeckoId|assetId" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.rs" .
grep -rn -iE "swap|transfer|send|pay|deposit|collateral|quote|route" --include="*.ts" --include="*.tsx" . | grep -iE "symbol|assetId"
```
- Record: each resolution site and whether its result reaches a **value path** (swap, send, pay, deposit, collateral, routing) or only display.
- ✅ PASS: value paths consume a **mint address** supplied by config, the user, or an on-chain allowlist; symbol lookups only *suggest* and the confirmation shows the resolved mint
- ❌ FAIL: a value path takes the first search hit / the registry primary for a symbol and builds the transaction from it

**Step 2: Are value-moving mints pinned, or auto-followed from the registry?**
```
grep -rn -iE "setInterval|cron|schedule|revalidate|refresh" --include="*.ts" --include="*.py" . | grep -iE "token|mint|asset|registry|list"
grep -rn -iE "USDC_MINT|acceptedMints|allowlist|ALLOWED_MINTS|mint_registry" --include="*.ts" --include="*.rs" .
```
- ✅ PASS: the mint for each supported asset is a constant / on-chain allowlist entry (mint + token program id); registry changes to a primary raise an **alert** and require a human or governance step to adopt
- ❌ FAIL: the accepted / primary mint is re-read from a registry endpoint on a timer or at request time with no gate — one registry flip re-routes every user

**Step 3: Variants are not treated as fungible**
- ✅ PASS: bridged / wrapped / yield / leveraged variants of one `assetId` are separate entries with their own trust (bridge program, wrapper), separate collateral buckets and no implicit 1:1 conversion
- ❌ FAIL: code treats "same assetId" as interchangeable (shared pool / bucket, 1:1 swap, a single "USDC" balance summed across mints)

**Step 4: Registry metadata is rendered and fetched as untrusted content**
```
grep -rn -iE "logoURI|logo_uri|image|uri" --include="*.tsx" --include="*.ts" . | grep -iE "<img|src=|fetch\(|dangerouslySetInnerHTML"
grep -rn -iE "normalize\(|NFKC|confusable|zero.?width" --include="*.ts" --include="*.tsx" .
```
- ✅ PASS: names / symbols rendered as text with the mint shown alongside; logos through an allowlisted host or sniffing proxy; `uri` `https:`-only and allowlisted; confusable / zero-width symbols normalised or flagged; unknown / singleton assets render with an explicit *unverified* treatment
- ❌ FAIL: metadata goes straight into `<img src>`, `fetch()` or HTML; lookalike symbols are indistinguishable from the real one; unknown mints inherit the verified styling

**Step 5 (operator): Can the primary-variant ranking be bought?**
```
grep -rn -iE "liquidity|volume|trades|holders|curated|rank|lexical|localeCompare|tieBreak" --include="*.ts" packages/ apps/ | grep -iE "primary|variant|rank"
grep -rn -iE "dwell|hysteresis|cooldown|minAge|attest" --include="*.ts" packages/ apps/
```
- ✅ PASS: grouping of a mint under a canonical asset is curated / attested (never metadata-similarity alone); the ranker requires at least one non-gameable input (curated rank, issuer attestation), uses depth-at-impact or locked liquidity rather than headline TVL, applies outlier filters tested against a wash fixture, enforces a minimum dwell time before a flip, alerts on flips, and has **no lexical / address tie-break** on value-bearing decisions
- ❌ FAIL: metadata similarity groups mints; ranking is liquidity / volume / holders only; a lexical tie-break exists; a flip is silent and instant

**Step 6: Agents and bots cannot be steered by the list**
- ✅ PASS: an AI agent / trading bot treats the registry as untrusted input (AI-018) — the list cannot widen the agent's mint allowlist (AI-004..006) or raise a spend cap
- ❌ FAIL: the agent's tradable set *is* the registry verified list, refreshed at runtime

**Overall verdict:**
- ✅: Mint address is identity everywhere; value paths use pinned / allowlisted mints with a human gate on registry changes; variants are separate trust domains; metadata is untrusted; (operator) the ranker mixes attested inputs, has dwell time and no lexical tie-break
- ⚠️: Value paths are pinned but display / search can show a lookalike as if verified; or the operator ranker has outlier filters but no dwell time / curated input
- ❌: A swap / send / pay / collateral path resolves a symbol or auto-follows the registry primary at runtime; or the ranker can be flipped with temporary liquidity, wash volume, dusting or an address tie-break
- N/A: The codebase never resolves human identifiers to mints and never consumes a token registry (all mints are hardcoded and no list is fetched)
