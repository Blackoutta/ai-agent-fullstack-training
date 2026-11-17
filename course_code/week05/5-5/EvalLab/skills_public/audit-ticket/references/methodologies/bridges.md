# Methodology — Cross-Chain Bridges & Messaging (Audit Checks)

> **Load when:** a cross-chain bridge / messaging / attestation protocol is detected — grep markers:
> `guardian`, `vaa`, `post_vaa`, `verify_signatures`, `emitter`, `sequence`, `lz_receive`, `ism`, `attestation`
> (also: `signature_set`, `guardian_set`, `complete_transfer`, `complete_wrapped`, `foreign_emitter`,
> `dispatch`, `mailbox`, `dvn`, `tss`, `submission`, `wormhole`, `sysvar::instructions`).
>
> **Purpose:** protocol-specific checks for bridges where a Solana program **receives, verifies, and acts
> on** a message authenticated by another chain (destination-side), plus the source-side path where a
> Solana program **emits** a verifiable message consumed elsewhere. Covers generic message bridges
> (Wormhole core, LayerZero ULN, Hyperlane ISM, deBridge, ZetaChain TSS), token bridges (Wormhole
> Portal, Allbridge, Mayan), liquidity-network / intent bridges (Across, Everclear, Mayan Swift, deBridge
> DLN), and HTLC / atomic-swap bridges (1inch Fusion, SolLightning). These sit **on top of** the
> language-agnostic checklists (`checklists/01`–`07`); where a generic check covers the base case the
> note says *"beyond `<ID>`, also verify…"*.
>
> **How to use:** each section is an auditor check — *safe shape*, *failure mode*, *grep*. PASS = safe
> shape enforced *in code*; FAIL = failure mode reachable.
>
> **Why this surface is the highest-stakes historically:** bridges are the single largest loss category
> in crypto (>$2.5B aggregate). The **Wormhole exploit ($326M)** — a sysvar account substituted at
> `verify_signatures`, letting forged "guardian signatures" pass and minting 120,000 unbacked wETH — is
> the canonical Solana lesson, and nearly every section here is downstream of it. Message-format
> taxonomy, signature schemes, and replay mechanics are public bridge architecture; the Wormhole
> primitive (sysvar substitution + signature-set replay) is public post-mortem material.

---

## 0. Classify the message format FIRST — misclassification guarantees missed findings

Every bridge family has a distinct on-the-wire format, signer set, quorum model, and Solana
verification path. Auditing a LayerZero OApp as if it were a Wormhole integration will miss the real
security boundary. Identify the target before scoping anything else:

| Family | Message format | Signer set / quorum | Solana verification seam |
|---|---|---|---|
| **Wormhole (VAA)** | VAA = header + body + payload, guardian-signed | ~19 named rotating guardians; supermajority `2n/3+1` (13/19) | `verify_signatures` writes a signature-set account; `post_vaa` reads it. **The exploit was at this seam.** Modern shims use the sigVerify precompile + strict sysvar checks |
| **LayerZero (ULN)** | Packet: nonce, src/dst chain, src/dst address, guid, payload | Configurable DVN set (often 1 oracle + 1 relayer; can be N-of-M) | Endpoint verifies DVN signatures; **per-OApp config is the security boundary** |
| **Hyperlane (ISM)** | Message: version, nonce, origin/dest, sender/recipient, body | Validator-set ISM (multisig / aggregation / optimistic / custom), modular | Mailbox dispatches to recipient program; the ISM verifies before delivery |
| **deBridge** | Submission: chain-id, sender, receiver, amount, data + validator sigs | deBridge validator set; supermajority | Solana program verifies sigs and routes to receiver |
| **Mayan Swift / intent** | Solana-native order (maker/taker/amount/deadline), maker-signed; solver fills | 1-of-1 maker for the order; solver provides liquidity | Heavy sigVerify-precompile use over alternative curves |
| **ZetaChain Gateway (TSS)** | Omnichain tx, TSS-signed by observer-validators | TSS threshold (single on-chain signature) | Gateway program verifies one TSS signature |
| **HTLC / atomic swap** | Hashlock + timelock order | Counterparty signatures, 1-of-1 | sigVerify precompile + instruction introspection for resolve/refund |

**Custody model also shifts the threat:** *lock-and-mint / burn-and-release* (Wormhole Portal,
Allbridge, deBridge) — the bridge holds the global lock, so mint-authority compromise = unbacked
wrapped supply; *liquidity-network* (Across, Everclear, Mayan) — solver/LP insolvency + proof-of-fill;
*atomic swap* (Fusion, SolLightning) — no custody, but counterparty + timing risk; *general message*
(Wormhole core, LayerZero, Hyperlane) — the **recipient program** is the security boundary, the bridge
only guarantees message integrity, not destination logic.

```
grep -rn -E "vaa|guardian|emitter|lz_receive|ism|mailbox|dvn|tss|submission|attestation" programs/
```

---

## 1. Invariant catalog

Every bridge audit must produce evidence (test / proof / review note) for each. Numbered for
cross-reference from the worksheets (§2) and the fast-pass checklist.

| # | Invariant | Failure = |
|---|-----------|-----------|
| **B1** | **Message uniqueness / no replay** — every cross-chain message is processed **at most once**, tracked by a per-source-chain monotonic sequence or a unique message hash in a processed-set account; the processed marker is set **atomically with** (ideally before) the value-moving action | Double-mint / double-release |
| **B2** | **Source-chain + emitter authentication** — the message commits to and the program validates `(source_chain, foreign_emitter)`; only a **registered** emitter on a **registered** chain is honored | Any chain/contract forges inbound messages |
| **B3** | **Destination binding** — the signed payload commits to `(destination_chain, destination_program)`; a message for chain X or program A cannot execute on chain Y or program B | Cross-domain replay across deployments |
| **B4** | **Signature / quorum verification** — signatures are verified against the **canonical guardian/validator set for the current epoch**, and the quorum threshold is met; no path accepts a signer-set that isn't the pinned current set. **The Wormhole exploit broke this** | Forged messages |
| **B5** | **Guardian/validator-set rotation correctness** — set updates are **atomic and forward-only**: the new set is signed by the old set (chained authority), the old set cannot be revived (incl. via reorg-replay), and there is no window where both or neither set is valid | Set downgrade / revival → forged messages |
| **B6** | **Sequence monotonicity** — inbound sequence/nonce per source chain is strictly increasing (or slot-in-a-processed-set); message N+1 is not processable before N where ordering is required; outbound sequence per emitter is monotonic | Out-of-order / repeat processing |
| **B7** | **Payload integrity & bounded parsing** — every byte is length-checked; integer fields use `try_into` with explicit error paths; no `unwrap`, no `as` truncation, no length×element-size overflow; endianness is explicit (EVM-origin big-endian vs Solana-origin little-endian) | Silent data corruption / parser panic-DoS |
| **B8** | **Decimal / amount normalization across chains** — token amounts are normalized between source-chain and Solana-mint decimals with the correct direction and rounding; Token-2022 transfer-fee amounts are accounted at the right boundary (net received ≠ gross sent) | Value inflation/deflation on the wire |
| **B9** | **sigVerify-precompile alignment & instruction-introspection correctness** — when using ed25519/secp256k1 precompiles (which return no result), the program reads the **pinned** Instructions sysvar, confirms the precompile ran at a **validated** index with the **expected message hash + pubkey**, and follows SIMD-0152 strict-mode behavior | Verification bypass (the Wormhole class) |
| **B10** | **Sysvar-account-substitution rejection** — every sysvar (`Instructions`, `Clock`, `Rent`) is typed `Sysvar<'info,T>` or its address is asserted equal to the canonical sysvar ID; never an unchecked `AccountInfo`. **The exact Wormhole primitive** | Attacker-supplied "sysvar" → forged verification |
| **B11** | **Token mint authority restricted** — only the bridge program (PDA-signed) can mint wrapped tokens; the mint-authority PDA is derived from `(bridge_program, original_token, source_chain)`; freeze authority is that PDA or explicitly `None`; authority transfer is governance-gated (timelock + multisig) | Unbounded wrapped-supply inflation |
| **B12** | **Signature-set account discipline** — when verification spans transactions (`verify_signatures` → `post_vaa`), the signature-set account is **per-VAA, fresh, owned by the bridge, and bound to the VAA hash** it authenticates; it cannot be replayed across VAAs. **The stale-`SignatureSet` reuse in the Wormhole exploit** | Reuse of a prior tx's verified signatures |
| **B13** | **Relayer/solver cannot forge or misdeliver** — an untrusted relayer only *transports*; it cannot alter payload, recipient, or amount, cannot pick which signer-set is used, and cannot redirect delivery. For intent/liquidity bridges, the fill is validated against the signed intent and repayment is bound to a verified source-chain settlement | Relayer steals / redirects value |
| **B14** | **Finality / reorg assumptions documented and enforced** — a message from a reorged-out source block is not processable: confirmation depth per source chain is enforced, and finality assumptions are documented per chain | Reorg replay double-spend |

---

## 2. Per-instruction review worksheets

Each worksheet lists the safe shape. FAIL if any line is missing on any reachable path.

### `post` / emit (outbound: `transfer_native`, `transfer_wrapped`, `dispatch`, `send`)
- User assets are **burned (wrapped) or escrowed to custody (native)** before the message is emitted;
  the emitted `(destination_chain, recipient, amount)` matches what was moved (B8).
- Source chain id in the message is Solana's; **sequence is monotonic per emitter** (B6) and the
  emitter is the program's own PDA, not user input.
- For token bridges: the amount is normalized to the wire decimal convention with the
  protocol-conservative rounding (B8); Token-2022 fee-on-transfer is netted (B8).
- Event/log carries the full committed payload so off-chain relayers cannot substitute fields (B13).

### `receive` (inbound delivery: `complete_transfer` / `complete_wrapped` / `complete_native` / `lz_receive` / `process`)
- The message is **verified and posted first** (B4/B9/B12), then acted on.
- `(source_chain, foreign_emitter)` are **registered and matched** (B2); `(destination_chain,
  destination_program)` match this deployment (B3).
- **Not previously claimed** — a claim account / claim bitmap / processed-set marker is checked **and
  set atomically** with the mint/release (B1); prefer mark-before-CPI so a mid-flight panic can't leave
  it unmarked.
- Recipient and amount match the signed payload exactly; amount is de-normalized to mint decimals with
  correct rounding (B8).
- Mint/release: wrapped mint = expected derivation `(token_bridge, original_token, source_chain)` and
  the mint CPI is **PDA-signed by the bridge**, not an arbitrary authority (B11); native release is
  bounded by custody balance.
- **LayerZero:** DVN quorum per the OApp's *own* config was verified by the endpoint; nonce matches
  expected; payload size bounded (B7). **Hyperlane:** the recipient's ISM verified; replay is tracked
  per origin chain.

### `verify_signatures` (the Wormhole-class instruction)
- The **Instructions sysvar account is pinned** to the canonical address — typed `Sysvar<'info,_>` or
  asserted equal (B10). *This single check is what the $326M exploit lacked.*
- The sigVerify precompile ran at a **validated index** with the **expected message hash and the
  guardian pubkeys**, and its program id (`ed25519_program`/`secp256k1_program`) is asserted (B9).
- Guardian **indexes are within current-set bounds**; **no duplicate signatures**; the count meets
  quorum against the **current** guardian-set epoch (B4).
- The **signature-set account is fresh, bridge-owned, and bound to this VAA hash** — not a pre-existing
  account from a prior transaction (B12).

### `verify` set-management & registration (`update_guardian_set`, `register_chain`, `register_emitter`, `set_send/receive_library`)
- `update_guardian_set`: new set is **signed by the current set** (B5); epoch is monotonic; the old set
  expires (no dual-valid or dead window); rotation is logged; a set that **lowers** the threshold or
  shrinks the set requires explicit governance acknowledgment.
- `register_chain` / `register_emitter`: authorized by a **governance VAA / multisig**, not a single
  key; chain id is unique; the foreign emitter address is recorded with its destination-chain binding
  (B2/B3).
- Library/config setters (LayerZero): OApp owner authorized; target address is registered and non-zero.

---

## 3. High-density surfaces (fastest findings)

- **S1 — Signature/quorum verification (the Wormhole class).** Any bridge that splits verification
  across transactions, introspects prior instructions via sysvars, or trusts account ordering without
  explicit owner/address checks. **Audit every sysvar usage explicitly** (B9/B10/B12). Beyond `AV-069`
  (sysvar typed) / `AV-071`–`AV-074` (introspection binds pubkey+message+index, precompile id asserted)
  and `KV-102`: the bridge addition is that the introspected message must be the **VAA/packet body**
  and the signer set must be the **pinned current epoch**.
- **S2 — Replay state tracking (idempotency).** Off-by-one in nonce sequencing (N+1 before N); bitmap
  aliasing (two messages → one slot); account-per-message rent griefing; cross-domain replay when the
  destination chain id isn't in the signed payload (B1/B3/B6). Beyond `SM-045` (replay) / `SM-027`
  (reinit): the marker must be **cross-domain-bound**, not just locally unique.
- **S3 — Cross-domain binding.** Payload must carry `(source_chain, destination_chain,
  destination_program)`; any omission enables replay across deployments (B2/B3).
- **S4 — Token mint authority.** Mint-authority PDA derivation, governance-gated transfer, freeze
  authority is PDA-or-`None` (B11). Beyond `CPI-010` (validate program id in `invoke_signed`): the
  bridge angle is **who holds mint authority and how it rotates**.
- **S5 — Message-format parsing.** Variable-length payloads, nested optional fields, chain-specific
  endianness, address padding from shorter source formats (B7).
- **S6 — sigVerify precompile integration.** Precompiles return no value — the program must read the
  pinned Instructions sysvar and confirm parameters (B9). SIMD-0152 strict mode; no reliance on legacy
  non-strict behavior.

---

## 4. Cross-cutting concerns

- **Defense-in-depth on set rotation.** Guardian/validator-set rotation should require the on-chain
  governance signature (multi-guardian) **and** a Squads multisig on the program's upgrade authority — a
  compromised quorum still can't change the program; a compromised Squads still can't impersonate
  guardians. Beyond `checklists/07` (opsec/governance): the bridge addition is the **two-key rotation**.
- **Pause granularity.** A pause authority distinct from operational keys, able to: refuse new inbound
  messages, halt outbound emission, **per-chain** pause (disable one source/destination without halting
  the rest), and **per-token** pause (disable one wrapped token on observed exploit). Pause fast,
  unpause timelocked.
- **Token-2022 wrapped tokens.** A transfer hook adds CPI surface on every wrapped transfer →
  re-entrancy into mint/release (guard it); transfer-fee changes net vs gross → account fees at the
  right boundary (B8); confidential-transfer breaks holder observability; the metadata pointer must
  reference a bridge-controlled or immutable source.
- **Oracle freshness for liquidity bridges.** Across/Everclear/Mayan reference an oracle for
  cross-chain price or proof-of-fill — verify staleness gating, manipulation resistance, and a defined
  **settlement timeout** (what happens if no solver fills). Cross-ref `references/methodologies/oracles.md`.

---

## 5. Attacker goals (frame the review)

Work backward from what an attacker wants; each maps to invariants to break:

1. **Mint unbacked wrapped tokens** — forge signatures (break B4/B9/B10/B12 — the Wormhole path), or
   seize mint authority (B11).
2. **Double-spend a real message** — replay the same VAA/packet (B1), or replay a stale signature-set
   (B12).
3. **Redirect a legitimate transfer** — cross-domain replay onto another deployment (B3), or a relayer
   altering recipient/amount (B13).
4. **Impersonate a source chain/contract** — send from an unregistered emitter/chain (B2).
5. **Inflate value on the wire** — decimal-normalization mismatch (B8).
6. **Downgrade / revive a signer set** — malicious rotation or reorg-revival of the old set (B5/B14).
7. **DoS the parser or the processed-set** — malformed payload panic (B7) or account-per-message rent
   griefing (S2).

---

## 6. Test / PoC strategy

- **Message-parser fuzzing (B7).** Arbitrary byte strings; target: length-prefix manipulation (claim
  large payload, provide small bytes), length×element-size overflow for arrays, null/embedded zeros in
  address fields, and the endianness boundary (Solana LE vs EVM-origin BE — mismatch = silent
  corruption). Trident coverage-guided.
- **Replay scenario tests (B1/B3/B6).** For every message format: (a) submit the same message twice →
  must reject; (b) submit a message signed for chain B on Solana → must reject; (c) submit from a
  reorged source block (fork sim) → must reject; (d) verify per-source-chain sequencing under
  concurrent reception.
- **Guardian/validator-set transition tests (B5).** Rotate → old-set signatures must fail, new-set must
  succeed; rotation with insufficient current-set signatures → must fail; a security-decreasing
  rotation (smaller set / lower threshold) → must require explicit governance acknowledgment; a
  pre-rotation cached message either works or fails **per documented intent** (assert the choice).
- **Negative sigVerify / signature tests (B4/B9/B10/B12) — MANDATORY.** For every instruction that
  depends on the precompile or a signer set, each of these **MUST be rejected**:
  - **Malformed** — precompile instruction absent from the transaction.
  - **Wrong index** — precompile present but at an unexpected/shifted index (attacker inserted
    instructions).
  - **Wrong message** — precompile ran for a *different* message than the VAA/packet body.
  - **Replayed** — a stale/reused signature-set account from a prior transaction (the Wormhole
    reuse).
  - **Wrong guardian set** — signatures from an old/other/attacker guardian set, or below quorum, or
    with duplicate signers, or an out-of-bounds guardian index.
  - **Sysvar substituted** — the Instructions sysvar replaced with an attacker-controlled account (the
    exact $326M primitive) — must fail.
- **Fork tests with mainnet signer state.** Surfpool-fork mainnet with the live Wormhole guardian set
  and signature-set accounts; run a real cross-chain transfer end-to-end so integration tests reflect
  actual mainnet conditions.

---

## Bridges checklist (fast pass)

- [ ] Message format classified (Wormhole/LayerZero/Hyperlane/deBridge/TSS/HTLC); custody model identified (§0)
- [ ] Message uniqueness enforced; processed marker set atomically (mark-before-CPI) — no double-mint (B1)
- [ ] Source-chain + registered-emitter authenticated; destination `(chain, program)` bound (B2/B3)
- [ ] Signatures verified against the pinned **current-epoch** guardian/validator set at quorum (B4)
- [ ] Set rotation atomic, forward-only, old-set signed the new set, no revival (B5)
- [ ] Sequence monotonic per source (in) and per emitter (out) (B6)
- [ ] Payload bounded-parsed: `try_into`, no `unwrap`/`as` truncation, explicit endianness (B7)
- [ ] Amounts normalized across decimals with conservative rounding; Token-2022 fee netted (B8)
- [ ] sigVerify precompile alignment: pinned Instructions sysvar, validated index, expected hash+key, strict mode (B9)
- [ ] Every sysvar typed `Sysvar<'info,_>` / address-asserted — **no substitutable sysvar** (B10, the Wormhole primitive)
- [ ] Wrapped mint authority = bridge PDA, governance-gated transfer, freeze PDA-or-`None` (B11)
- [ ] Signature-set account fresh, bridge-owned, bound to its VAA hash — not replayable across VAAs (B12)
- [ ] Relayer/solver cannot alter payload/recipient/amount or redirect delivery; fill bound to verified settlement (B13)
- [ ] Finality/reorg: confirmation depth enforced per source chain; assumptions documented (B14)
- [ ] Negative sigVerify tests reject malformed/wrong-index/wrong-message/replayed/wrong-set/substituted-sysvar signatures (§6)
- [ ] Set rotation two-keyed (governance VAA + Squads); pause is per-chain + per-token; liquidity-bridge oracle gated (§4)

*Public exploit referenced: Wormhole (2022, $326M — sysvar account substitution at `verify_signatures`
enabling forged guardian signatures + stale-signature-set replay). Message-format taxonomy, signature
schemes, sequence/replay mechanics, and the sigVerify-precompile pattern are public bridge architecture
and post-mortem material. Cross-refs: `AV-069`–`AV-074` (sysvar/introspection), `SM-027`/`SM-045`
(reinit/replay), `CPI-010` (invoke_signed program-id), `KV-102` (precompile-introspection), `KV-123`
(sysvar write-demotion), and vuln-class VC-43 (cross-chain message replay).*
