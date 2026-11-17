# Methodology — NFT Marketplaces & Token Metadata (Audit Checks)

> **Load when:** an NFT marketplace / digital-asset trading / token-metadata protocol is detected — grep markers:
> `metadata`, `listing`, `escrow`, `royalty`, `merkle`, `MplCore`, `auth_rules`, `collection`
> (also: `token_metadata`, `bubblegum`, `cnft`, `leaf`, `tree_authority`, `canopy`, `pnft`,
> `rule_set`, `creator`, `seller_fee_basis_points`, `delegate`, `bid`, `accept_bid`, `plugin`,
> `TokenRecord`, `edition`, `MetadataPointer`).
>
> **Purpose:** protocol-specific checks for programs that **list, escrow, price, and settle unique
> digital assets** — moving an NFT between a seller and a buyer while splitting proceeds into sale
> value, marketplace fee, and creator royalties. Covers escrow order-books (classic Token-Metadata,
> pNFT), pool/AMM NFT trading (Tensor/Hadeswap-style), delegate-custody marketplaces (MPL Core),
> compressed-NFT listings (Bubblegum/cNFT), and Token-2022 NFTs. These sit **on top of** the
> language-agnostic checklists (`checklists/01`–`07`); where a generic check covers the base case the
> note says *"beyond `<ID>`, also verify…"*.
>
> **How to use:** each section is an auditor check — *safe shape*, *failure mode*, *grep*. PASS = safe
> shape enforced *in code*; FAIL = failure mode reachable.
>
> **Why this surface is distinct from a token DEX:** the traded object is non-fungible and standard-bound,
> so the bug surface spans three layers a fungible-swap audit never touches — (a) the **asset standard**
> (metadata mutability, royalty-enforcement regime, delegate/authority scope), (b) the **marketplace
> state** (listings, escrows, bid books), and (c) the **asset-aware execution path** (auth-rules CPI,
> merkle-proof verification for cNFTs, plugin dispatch for MPL Core). One misordered instruction can
> defeat royalty enforcement, double-spend a single NFT across two venues, or revive a closed escrow PDA
> with attacker-chosen "ownership" state. cNFT proof-staleness overlaps
> `references/vuln-classes/zk-and-compression.md`; the Token-2022 NFT path overlaps the extension
> methodology.

---

## 0. Classify the asset standard FIRST — the custody model dictates the whole review

Solana's NFT standards have shipped in five generations, each with a different custody, royalty, and
authority model. Most production marketplaces support several at once, so identify **every** standard in
scope before scoping the marketplace state — auditing a cNFT flow as if it were an escrow-and-metadata
flow will miss the real security boundary.

| Generation | Standard | Custody model | Royalty enforcement | Solana seam that matters |
|---|---|---|---|---|
| **Classic NFT** (decimals 0, supply 1) | Metaplex Token-Metadata | escrow PDA holds the token | marketplace *chooses* to honor the metadata `seller_fee_basis_points` flag | escrow init/close; PDA revival |
| **Programmable NFT (pNFT)** | Token-Metadata + Auth Rules | escrow, but transfer gated by a rule-set | **on-chain** via `mpl_token_auth_rules` | every transfer must route through the auth-rules CPI; a plain token transfer is the escape |
| **MPL Core** (single account) | Metaplex Core | **non-escrow** — seller keeps the asset, grants a transfer delegate | plugin-based (royalties plugin) | delegate **scope** and plugin dispatch (freeze/royalty/edition) |
| **Compressed NFT (cNFT)** | Bubblegum + state compression | **merkle-proof bearer** — no per-asset account | off-chain / social | proof verified against the **live tree root**; concurrent transfers advance it |
| **Token-2022 NFT** | Token-2022 + metadata-pointer | varies (ATA or delegate) | possible on-mint / transfer-hook | extension enumeration; transfer-hook CPI |

**Custody is the axis that partitions the threat model — everything downstream forks on it:**
- **Escrow marketplaces** (classic, pNFT) — the seller moves the NFT into a marketplace-controlled PDA
  on `list`; the sale moves it PDA→buyer. Dominant bug class: **PDA reuse after close** (revival).
- **Delegate marketplaces** (MPL Core, some Token-2022) — the seller keeps the NFT and grants a
  transfer delegate to the marketplace. Dominant bug class: **delegate-scope overflow** (a transfer
  delegate that is actually update/burn/freeze) and **stale delegate not revoked on cancel**.
- **Merkle-proof marketplaces** (cNFT) — the seller signs an off-chain order; the marketplace verifies a
  merkle proof against the tree's current root at execution. Dominant bug class: **proof staleness /
  root race / replay across a forked tree**.

```
grep -rn -E "token_metadata|auth_rules|rule_set|MplCore|mpl_core|bubblegum|cnft|merkle|metadata_pointer|delegate" programs/
```

---

## 1. Invariant catalog

Every NFT-marketplace audit must produce evidence (test / proof / review note) for each. Numbered for
cross-reference from the worksheets (§2) and the fast-pass checklist.

| # | Invariant | Failure = |
|---|-----------|-----------|
| **N1** | **List→sale atomicity** — bid acceptance / purchase transfers the asset **and** settles all money legs (proceeds, marketplace fee, creator royalties) in **one transaction**; there is no reachable state where the asset moved but a payment did not, or vice versa | Seller cancels between transfer and payment; buyer revokes between payment and transfer |
| **N2** | **Royalty-escape audit** — for a standard whose royalties are enforced (pNFT rule-set, MPL Core royalties plugin, Token-2022 hook), **no code path performs the ownership transfer while skipping the enforcing CPI**; the marketplace's own sale path *and* any auxiliary transfer route are both checked | Silent 0-royalty transfers; documented "royalty-enforcing" claim is false |
| **N3** | **Owner re-check at execution** — the seller/lister still **currently owns** the asset (or holds a live delegate) at the moment `accept_bid`/`buy` runs, re-read from the live token account / proof leaf / MPL Core owner — **not** trusted from list-time state | Seller transfers out, then double-settles a stale listing (Cashio-class TOCTOU) |
| **N4** | **Escrow close = non-revival** — a listing/bid escrow PDA closed on sale or cancel is zeroed and marked (`data[0]=0xff`) or drained below rent and data-cleared, so it cannot be reopened later with attacker-chosen state | Closed escrow revived to forge an "I own this NFT" claim to another instruction |
| **N5** | **cNFT proof freshness (live root, not argument root)** — the merkle proof is verified against the **current on-chain root read from the tree account this instruction**, never a root passed in instruction data; a concurrent transfer that advanced the root is **detected and rejected**, not silently overwritten | Two buyers both "win" the same cNFT; stale-root replay |
| **N6** | **Delegate scope bounded (MPL Core / delegate custody)** — a marketplace acting via delegated authority is scope-limited to **transfer only**; it is never granted update, burn, freeze, or plugin-authority; delegates are revoked on cancel and replaced atomically | Scope-overflowed delegate becomes a freeze-and-drain / seize primitive |
| **N7** | **Price & currency-mint validation** — the listing price is `> 0` and within sane bounds (no downstream `u64::MAX` overflow); the settlement currency mint is pinned (a listing priced in mint A cannot be paid in attacker mint B); the buyer's payment account and the payout accounts are the pinned mint's accounts | Zero/overflow-price abuse; payment in a worthless substitute mint |
| **N8** | **Fee/royalty split conserved & consistently rounded** — marketplace fee and creator royalty use a single rounding direction (`floor(price·bps/10_000)`), the seller receives at least `price − fees`, and **the splits sum to the price exactly** (no dust routed to the program) | Per-sale lamport drain from the seller; dust siphon |
| **N9** | **Auction / bid timing bound to `Clock`** — bid expiry, auction close, and any commit/reveal windows are validated against the `Clock` sysvar, not a user-supplied timestamp; reveals/bids after close are rejected; escrowed bids are refundable and not strandable | Final-second snipe on a spoofed clock; strand or replay of escrowed bids |
| **N10** | **Listing/bid record uniqueness & lifecycle** — one active listing per `(asset, marketplace)`; bid records are unique per `(asset, bidder)` or have explicit replace semantics; cancel is single-shot (no double-cancel after an acceptance race) and closes the record atomically with the asset return / bid refund | Double-cancel drains escrow; orphaned record vs returned asset |
| **N11** | **Standard-correct transfer & authority** — the transfer uses the right primitive for the standard (`transfer_checked` for SPL/Token-2022, auth-rules transfer for pNFT, Bubblegum CPI for cNFT, MPL Core transfer for Core), the asset is a genuine mint/asset of that standard (owner-checked), and collection membership is verified where the flow is collection-bound | Type-confusion between standards; fake-asset settlement |
| **N12** | **Cross-marketplace exactly-one-wins** — the same asset listed on two venues cannot settle on both in the same slot; the losing venue fails **cleanly** (no stranded escrowed bid) because the owner re-check (N3) enforces single-settlement | Double-sale of one asset; stranded counter-party funds |

---

## 2. Per-instruction review worksheets

Each worksheet lists the safe shape. FAIL if any line is missing on any reachable path. Lines tagged
`[cNFT]` apply only to compressed flows; `[Core]` only to Metaplex Core; `[pNFT]` only to programmable NFTs.

### `list`
- Seller is a **signer** and **currently owns** the asset (live token-account amount `== 1` / live
  proof-leaf owner / MPL Core owner), not a list-time snapshot (N3).
- The asset is a genuine mint/asset of its standard — mint/asset account **owner-checked**, not an
  arbitrary account (N11); `[pNFT]` the transfer into escrow routes through `mpl_token_auth_rules` (N2).
- Escrow PDA initialized with its **canonical bump stored**; exact init only (no `init_if_needed`).
- Listing price `> 0` and bounded; settlement currency mint pinned (N7).
- Listing record is unique for `(asset, marketplace)`; no second active listing (N10).
- `[cNFT]` proof verified against the **live tree root** and the leaf matches the seller-claimed asset (N5).
- `[Core]` transfer delegate granted is **scope-limited to transfer**, and any prior delegate is
  revoked/replaced atomically (N6).

### `cancel_listing` / `delist`
- Seller is a **signer**; the asset returns to the seller's wallet (escrow) **or** the delegate is
  revoked (non-escrow) — no residual transfer authority remains (N6).
- Escrow PDA is **closed with a non-revival marker** (`data[0]=0xff` / zero+drain) (N4).
- The listing record is closed **atomically** with the asset return; no partial state where the asset is
  back but the record persists (or vice-versa) (N10).

### `buy` / `accept_bid` (the settlement instruction — highest stakes)
- Buyer is a **signer** (or a buyer-PDA with a documented authority chain).
- **Seller still owns the asset**, re-read live at execution (N3); guards the cross-marketplace
  exactly-one-wins property (N12).
- Bid/price satisfies the listing (`bid ≥ ask`, or the listing accepts current best bid) and is in the
  **pinned currency mint** (N7).
- **All legs in one tx:** asset buyer←seller, fee→marketplace, royalty→creators, proceeds→seller —
  atomically (N1). The splits use one rounding direction and **sum to the price exactly** (N8).
- The **enforcing CPI runs before settlement is final**: `[pNFT]` auth-rules transfer / `[Core]`
  royalties-plugin honored / Token-2022 transfer-hook executed — with no plain-token-transfer escape
  path elsewhere (N2).
- `[cNFT]` the proof is verified against the **root fetched in this instruction** and a root that has
  advanced (concurrent transfer) is rejected (N5).
- Listing record closed; escrow PDA **marked closed** (N4).
- Event emitted with `(asset, buyer, seller, price, marketplace_fee, royalty)` for off-chain indexers
  and royalty distribution.

### `place_bid`
- Bidder is a **signer**; the bid amount is **actually escrowed** into a marketplace-controlled PDA (not
  merely recorded) (N10).
- Bid record unique per `(asset, bidder)` or explicit replacement; bid is in the pinned currency mint.
- Bid expiry validated against `Clock::get()`, **not** a user-supplied timestamp (N9); bid `>` current
  best (English) or `≥` collection minimum.

### `cancel_bid`
- Bidder is a **signer**; the escrowed bid is returned in full.
- Bid record closed with a **non-revival marker** (N4); **double-cancel** blocked via a state field so a
  cancel racing an acceptance cannot refund twice (N10).

### `transfer_with_auth_rules` (`[pNFT]` asset-aware transfer)
- The `mpl_token_auth_rules` program id is **hardcoded / validated** against the expected id.
- The rule-set account **matches the one referenced in the asset's metadata**, and is **re-fetched per
  sale** (rule-sets are upgradable — a cached rule-set diverges after an upgrade).
- Caller authority (owner or scoped delegate) verified; **no bypass path** performs the move via plain
  `spl_token::transfer`, skipping the rules (N2).

### `delegate_transfer` (`[Core]` / delegate custody)
- Delegate scope is **transfer only** — never update, burn, freeze, or plugin-authority (N6).
- Delegate expiry set or explicitly documented as permanent-until-revoke; existing delegates revoked or
  replaced **atomically**.
- The asset owner is a **signer** when granting.

### `mint_compressed` (`[cNFT]`)
- Tree authority is a **program-derived PDA**, not user-controlled.
- Leaf schema matches the expected version `(owner, delegate, …)`; collection authority validated for
  collection-bound mints (N11).

### `transfer_compressed` / `burn_compressed` (`[cNFT]`)
- Current owner **per the proof leaf** matches the signer (or the signer's delegate).
- Proof verified against the **live on-chain root**, accounting for **canopy depth** (short-proof case) (N5).
- Transfer: new leaf hash computed from the new owner with the delegate **cleared** (unless explicitly
  preserved); a concurrent-modification root mismatch returns an **explicit error**, never a silent
  overwrite. Burn: the leaf is **nullified** (not merely cleared) to prevent re-spend; collection size
  decremented if collection-bound.

### admin (`set_fee`, `set_royalty_policy`, `upgrade`)
- Admin authority validated against a canonical PDA / governance key; **two-step** transfer
  (propose + accept) for the upgrade authority.
- Parameter bounds enforced (fee ≤ max, royalty ≤ 100%); event emitted for off-chain monitoring.

---

## 3. High-density surfaces (fastest findings)

- **S1 — Royalty escape.** The single most abused NFT-marketplace surface. Establish the **regime**
  first (enforced via pNFT rule-set / MPL Core plugin / Token-2022 hook, *optional* metadata-flag, or
  *ignored*), then hunt for a path that moves ownership while skipping the enforcing CPI — a plain
  `spl_token::transfer` on a pNFT mint, a pool-trade path that forgets the plugin, an aggregator hop
  that bypasses auth-rules (N2). The documented policy **must** match on-chain behavior.
- **S2 — Escrow close-revival.** PDAs that held NFTs are prime revival targets: reopening one with
  attacker-chosen ownership lets an attacker forge "I own this NFT" claims to other instructions. Every
  close must zero + mark (N4). Beyond `SM-027` (reinit) / the close-revival vuln-class: the NFT angle is
  the **forged-ownership** downstream use of the revived account.
- **S3 — cNFT proof staleness.** Concurrent transfers on one tree create proof races. If the marketplace
  doesn't verify against the root read *in this instruction* and reject an advanced root, two buyers can
  both win the same cNFT (N5). Cross-ref `references/vuln-classes/zk-and-compression.md`.
- **S4 — Owner-at-sale TOCTOU.** An ownership check performed at `list` and trusted at `accept_bid` is
  the Cashio-class time-of-check/time-of-use gap; the seller transfers the asset out between the two and
  double-settles (N3). This is also what enforces cross-marketplace exactly-one-wins (N12).
- **S5 — Fee/royalty rounding composition.** Mixed rounding directions across the marketplace-fee and
  the creator-royalty (floor one, ceil the other) drain the seller by a lamport per sale, or route dust
  to the program; the splits must share one direction and sum to the price (N8).
- **S6 — Delegate-scope overflow.** A "transfer" delegate that actually carries update/burn/freeze scope
  is a seize-and-freeze primitive on non-escrow custody (N6). Enumerate the exact granted scope on every
  MPL Core / Token-2022 delegate path.

---

## 4. Cross-cutting concerns

- **Royalty-regime disclosure is policy, not a bug — but the code must match it.** Before assigning
  severity, establish with the client whether the marketplace **enforces**, **optionally enforces**, or
  **ignores** creator royalties. A marketplace that *claims* enforcement but ships a code path skipping
  auth-rules / the royalties plugin is a finding regardless of the chosen policy (S1).
- **Cross-marketplace listing collisions.** The same asset can be listed on venue A and venue B at once.
  In the same slot only one settles on-chain; the other must fail **cleanly**, not strand the losing
  venue's escrowed bid. The owner re-check (N3) is what delivers exactly-one-wins (N12) — verify it,
  don't assume the runtime does it.
- **MPL Core plugins are individually load-bearing.** Core assets carry pluggable behavior (auth,
  royalties, freeze, attributes, edition), each with its own update-authority semantics. An integration
  that ignores a plugin — e.g. transfers a **freeze**-plugged asset by skipping the freeze check — is a
  finding. Enumerate every plugin on supported asset types and confirm each is honored (N6).
- **Auth-rules / rule-set upgradability.** `mpl_token_auth_rules` rule-sets can be upgraded; a
  marketplace that caches the rule-set account or its semantics diverges from the live rules after an
  upgrade. Re-fetch per sale (N2).
- **Token-2022 NFT extensions.** A Token-2022 NFT may carry a **TransferHook** (CPI surface / re-entrancy
  into the sale path), **TransferFee** (net received `<` gross — royalty/fee math must net it),
  **NonTransferable** / **PermanentDelegate** (stall or seize), or a **MetadataPointer** that must
  reference a marketplace-controlled or immutable source. Whitelist extensions, don't blacklist.
  Cross-ref the Token-2022 extension methodology and `EXT-012`/`EXT-013`/`EXT-014`.
- **Pool/AMM NFT pricing (Tensor/Hadeswap-style).** A pool that quotes NFT prices inherits the swap-curve
  concerns of `references/methodologies/amm-clmm.md` (rounding direction, first-deposit, `k`
  monotonicity) *plus* creator-royalty composition on every pool trade — verify royalties are paid on the
  pool path, not just the peer-to-peer path (S1).

---

## 5. Attacker goals (frame the review)

Work backward from what an attacker wants; each maps to invariants to break:

1. **Buy an asset and pay zero royalty** — route the transfer around the enforcing CPI (break N2).
2. **Double-sell one asset** — stale owner check at settlement (N3), or the same asset winning on two
   venues (N12).
3. **Both-win a single cNFT** — stale-root proof (N5).
4. **Forge an ownership claim** — revive a closed escrow PDA with attacker state (N4).
5. **Seize or freeze a seller's asset** — a scope-overflowed delegate on non-escrow custody (N6).
6. **Skim from every sale** — rounding-direction mismatch / dust siphon in the fee split (N8).
7. **Snipe an auction** — spoofed timestamp on the close / reveal window (N9).
8. **Pay in a worthless mint** — unpinned settlement currency (N7).
9. **Strand a counter-party's escrowed bid** — double-cancel or an unclean losing-venue failure (N10/N12).

---

## 6. Test / PoC strategy

- **Atomic-settlement unit tests (N1/N3/N8) — Mollusk/LiteSVM.** Drive `accept_bid`/`buy` end-to-end with
  a synthetic asset + escrow + creator accounts; assert asset-balance and lamport-balance deltas move
  **together**. Run with deliberately misordered sub-steps (transfer without payment, payment without
  transfer) and confirm each reverts.
- **Owner-race negative test (N3) — MANDATORY.** Between `list` and `accept_bid`, transfer the asset out
  of the seller's account, then submit `accept_bid` → **must reject** (`SellerNoLongerOwnsNft`). This is
  the Cashio-class TOCTOU and the exactly-one-wins guarantee.
- **Close-revival negative test (N4).** Close a listing/bid escrow, then attempt to reopen the same PDA
  with attacker state in a follow-up instruction → **must fail** (non-revival marker present).
- **cNFT proof-race tests (N5) — MANDATORY for compressed flows.** Issue two `transfer_compressed`
  operations in adjacent slots on the same tree; the second must either succeed against the **advanced**
  root or fail with an explicit `RootStale`, and **never** silently overwrite. Also submit a
  proof against a **root passed in instruction data** (not read from the tree) → must reject.
- **Auth-rules bypass test (N2).** Attempt to move a pNFT via plain `spl_token::transfer`; assert the
  marketplace's sale instruction rejects an asset moved this way (or that auth-rules itself rejects the
  raw transfer). Repeat for MPL Core: attempt a sale path that skips the royalties plugin → royalty must
  still be paid or the sale must fail.
- **Royalty-math property tests (N8).** For all `(price, marketplace_bps, royalty_bps)` in a wide range:
  assert `marketplace_fee + royalty + seller_proceeds == price`, every value fits `u64`, no negative
  remainder, one rounding direction throughout.
- **Delegate-scope test (N6) — MPL Core / Token-2022.** Grant the marketplace its delegate, then attempt
  update/burn/freeze via that delegate → **must fail** (transfer-only scope).
- **Auction-timing tests (N9).** Submit a bid/reveal after the `Clock`-validated close → must reject;
  confirm expiry is read from `Clock`, not instruction data.
- **Fork tests with mainnet asset state — Surfpool.** Fork mainnet at a state where the target asset is
  listed; replay the sale via the marketplace instruction and compare the on-chain result to the
  expected creator-royalty distribution.

---

## NFT-marketplaces checklist (fast pass)

- [ ] Every asset standard in scope classified; custody model (escrow / delegate / merkle-proof) identified (§0)
- [ ] List→sale is atomic — asset move + fee + royalty + proceeds in one tx, no partial state (N1)
- [ ] Royalty-escape audited — no ownership-transfer path skips the enforcing CPI on any standard (N2)
- [ ] Owner re-checked live at settlement, not trusted from list time (Cashio-class TOCTOU) (N3)
- [ ] Escrow close zeroes + marks (`0xff`) — closed listing/bid PDA cannot be revived (N4)
- [ ] cNFT proof verified against the root read **in this instruction**; advanced root rejected (N5)
- [ ] Delegate scope = transfer only; revoked on cancel; no update/burn/freeze grant (N6)
- [ ] Price `> 0` and bounded; settlement currency mint pinned on payment + payout accounts (N7)
- [ ] Fee/royalty one rounding direction; splits sum to price exactly; no dust to program (N8)
- [ ] Bid expiry / auction close / reveal windows validated against `Clock`, not user input (N9)
- [ ] Listing/bid records unique; cancel single-shot; record closed atomically with asset/bid movement (N10)
- [ ] Standard-correct transfer primitive + owner check; collection membership verified where bound (N11)
- [ ] Cross-marketplace exactly-one-wins — losing venue fails cleanly, no stranded escrow (N12)
- [ ] MANDATORY negatives pass: owner-race, close-revival, cNFT proof-race, auth-rules bypass, delegate-scope (§6)
- [ ] Royalty regime documented and matches code; MPL Core plugins each honored; rule-sets re-fetched; Token-2022 extensions whitelisted (§4)

*Invariants above are public NFT-standard mechanics (Metaplex Token-Metadata, Auth Rules, Metaplex Core
plugins, Bubblegum/state-compression merkle proofs, Token-2022 metadata-pointer). The owner-at-sale
TOCTOU is the Cashio-class time-of-check/time-of-use pattern applied to NFT settlement. Cross-refs:
`references/vuln-classes/zk-and-compression.md` (cNFT proof staleness / state trees), the Token-2022
extension methodology (Token-2022 NFT path), `references/methodologies/amm-clmm.md` (pool-traded NFT
pricing), `references/methodologies/launchpads.md` (drop / mint campaigns), plus base checks `SM-027`
(reinit), `CPI-010` (invoke_signed program-id), and `EXT-012`/`EXT-013`/`EXT-014` (extension enumeration
/ delta accounting).*
