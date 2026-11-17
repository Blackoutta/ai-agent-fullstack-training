# Vuln Classes — ZK, Confidential Transfers & Account Compression

> **Load when:** the target touches zero-knowledge proofs, confidential transfers, account
> compression / compressed NFTs (cNFTs), or ZK-compression (Light Protocol). Trigger tokens in
> the codebase / deps: `groth16`, `spl-account-compression`, `bubblegum`, `merkle`,
> `nullifier`, `ConfidentialTransfer`, `light` (Light Protocol / `light-*` crates), `poseidon`,
> `verify_proof`, `Fiat`/`transcript`/`challenge`.
>
> **Purpose:** These classes carry catastrophic, often *silent* failure modes (unlimited mint,
> proof replay, forged inclusion). Several are **scope gates**, not greps — the correct auditor
> action is to *recognize the class, flag the required specialist review, and bound the
> program-audit deliverable*, rather than to claim a soundness verdict a program auditor cannot
> responsibly give.
>
> **Scope:** Solana ZK ElGamal / confidential transfers, `spl-account-compression` + Bubblegum
> cNFTs, and Light Protocol ZK-compression. Read alongside the arithmetic/state checklists
> (`checklists/06`, `05`) and `known-vectors/030` (infinite-mint). Findings still route through
> the **Rule 5b** validation gate (`OUTPUT-RULES.md`).
>
> *(Credit: public incident write-ups and publicly disclosed audits — the Solana ZK ElGamal
> proof issue (2025), OtterSec's account-compression review, Metaplex Bubblegum, and Light
> Protocol audits. Public-derivable; re-expressed in our own words, no third-party text copied.)*

---

## 0. The scope-gate principle (read first)

A program auditor can check **how a proof is *used*** — is it bound to the right accounts, can
it be replayed, are all public inputs constrained — but generally **cannot** certify the
**soundness of the underlying cryptography** (circuit constraints, trusted-setup, transcript
construction). When ZK is in scope:

- **Recognize** which sub-class is present (§1–§3 below).
- **Gate:** if circuit/protocol soundness is in question, the engagement **requires a
  cryptographer / specialized ZK review** — state this explicitly in the report and scope it
  *out* of the program-audit verdict rather than rubber-stamping it.
- **Still audit** the *integration surface* you can reason about: replay, proof-binding,
  account/owner checks around the verifier, public-input completeness at the call site.

Do not emit a "ZK is sound / not sound" PASS from a program audit. Emit "integration checked;
circuit soundness **out of scope — specialist review required**."

---

## 1. ZK soundness / Fiat–Shamir — every public input must enter the transcript

**Class.** Non-interactive proofs (Groth16, Bulletproofs, sigma protocols behind
confidential-transfer instructions) derive their challenge by hashing a **transcript** of the
public inputs (the Fiat–Shamir heuristic). **Soundness requires that *every* value the verifier
relies on is absorbed into the transcript *before* the challenge is derived.** If a public input
(or a proof component) is omitted from the transcript, an attacker can choose it *after* seeing
the challenge — a **phantom / malleable challenge** — and forge a proof for a false statement.

**Real precedent.** The Solana **ZK ElGamal proof** issue (2025): a public value was not bound
into the Fiat–Shamir transcript, yielding a theoretical path to forge validity proofs — in the
confidential-transfer context, a route toward **unlimited/undetected mint**. The feature was
disabled while fixed. This is the canonical example of "one un-absorbed input breaks
everything."

**What an auditor can/should do.**
- **Gate:** any in-scope custom circuit or Fiat–Shamir construction ⇒ **require a cryptographer
  review**; do not certify soundness from the program audit. Say so in the report.
- **Integration checks you *can* run (these are gate-supporting, not a soundness proof):**
  - Enumerate every public input the statement depends on (amounts, commitments, keys, mints,
    range bounds) and confirm each is **fed into the transcript / absorbed before the
    challenge** — an input that reaches the verified relation but not the transcript is the red
    flag.
  - Confirm the verifier uses the **canonical / audited** verifying key and curve params, not a
    caller-supplied or swappable VK.
  - Confirm proof + public inputs are **bound to this transaction's accounts** (see §2/§3
    proof-binding) so a valid proof can't be lifted to another context.
- If confidential-transfer instructions are used **as provided by the SPL Token-2022 / ZK
  ElGamal program**, verify the program is on a **patched** version and used as documented; a
  bespoke re-implementation is the high-risk case.

**Rule 5b note.** A soundness finding here is almost always `[UNCONFIRMED]` from a *program*
audit unless a cryptographer supplies the break; report the *integration* gaps you can prove
(un-bound public input, swappable VK, replayable proof) with cited `file:line`, and flag the
soundness question for specialist follow-up.

---

## 2. Account compression / cNFT Merkle proofs (spl-account-compression, Bubblegum)

**Class.** Compressed state (cNFTs via Metaplex **Bubblegum** over
**`spl-account-compression`** concurrent Merkle trees) stores only a **root** on-chain; leaves
live off-chain and are proven with an **inclusion proof** at mutation time. The attack surface
is the **proof + root lifecycle**, not the leaf contents.

**What to verify (integration-level, greppable + reasoned).**
- **Stale / replayed proof acceptance.** A concurrent Merkle tree keeps a **changelog** of
  recent roots so proofs generated against a slightly-old root still validate. Confirm the
  program accepts proofs **only** against a root within the valid changelog window and that a
  proof for an **already-spent / superseded** leaf state cannot be replayed to act twice.
- **Leaf sequence / monotonicity.** cNFT leaf schemas carry a **nonce / sequence** (e.g. leaf
  `nonce`, tree `sequence_number`). Confirm updates enforce **monotonic** progression so an
  attacker cannot roll a leaf back to a prior (e.g. higher-value or different-owner) state.
- **Domain separation.** Leaf hashing must be **domain-separated** (distinct hash prefixes for
  leaf vs. node, and per asset-type) so a value hashed in one position cannot be reinterpreted
  as a valid hash in another — the compression analogue of type-cosplay.
- **Empty-subtree / default-node handling.** Confirm the canonical **empty/zero subtree**
  constants are used and that a proof cannot exploit default-filled nodes to forge inclusion of
  a **non-existent** leaf (proving membership against padding).
- **Root-rotation races.** When the root advances (append/replace) concurrently with a
  mutation, confirm there is no window where a proof validated against root *R* is applied after
  the tree moved to *R'* in a way that double-applies or resurrects a leaf. OtterSec's
  account-compression review centered on exactly these proof/root-lifecycle edges.

```
grep -rn -E "spl.?account.?compression|ConcurrentMerkleTree|bubblegum|mpl.bubblegum" .
grep -rn -E "verify_leaf|append|replace_leaf|prove|proof|changelog|canopy" .
grep -rn -E "nonce|sequence|leaf_index|root" .
```

**Verdicts.** Missing changelog-window / replay guard, missing monotonic sequence check, or
missing domain separation are real **High/Critical** integration findings — route each through
Rule 5b (show the replay/rollback path and its effect: duplicate mint, ownership theft).

---

## 3. ZK-compression state trees (Light Protocol)

**Class.** Light Protocol compresses **program state** (not just NFTs) into Merkle trees with
**validity proofs** and **nullifiers** — closer to a zk-rollup model. Extra surfaces beyond §2:
- **Nullifier replay / double-spend.** Every consumed compressed account must produce a
  **unique nullifier** that is checked against a nullifier set/queue so the same state cannot be
  spent twice. Confirm the nullifier is **derived from the spent leaf** (not attacker-chosen)
  and that the **insert-and-check is atomic** — a TOCTOU between "check not nullified" and
  "insert nullifier" is a double-spend.
- **Proof-binding.** The validity proof must be bound to **this** transaction's inputs
  (recipient, amount, program, nullifiers) so a valid proof cannot be **replayed or
  front-run** into a different context. Unbound proofs are liftable.
- **Batched-MT / queue correctness.** Light uses **batched** Merkle-tree updates and
  input/output queues; confirm ordering, capacity, and root-advancement of the batch cannot be
  manipulated to admit an invalid state transition or to drop/duplicate an update.

```
grep -rn -E "\blight[-_]|light_compressed|compressed_account|state_merkle_tree" .
grep -rn -E "nullifier|nullifier_queue|validity_proof|address_merkle_tree|output_queue" .
```

**Gate + verdict.** The proof-*system* soundness is a **cryptographer / Light-audit** concern
(gate it out with a specialist recommendation). The **nullifier-replay, proof-binding, and
queue/ordering** checks are program-audit-able — report gaps via Rule 5b with the concrete
double-spend / replay path.

---

## 4. Out-of-scope-for-program-audit classes — defensive-awareness only

These classes appear near ZK/infra engagements but are **not** program-level bugs; a program
audit **cannot** resolve them. Do **not** produce PASS/FAIL verdicts on them — instead, note
them as *awareness* and recommend the appropriate specialist. Emitting a confident verdict here
is itself a quality defect.

- **Validator-client consensus divergence.** Two client implementations (or two versions)
  disagreeing on a state transition ⇒ chain split. This is a **client / protocol** concern, not
  a program concern.
- **Slashing evasion.** Whether a staking/restaking or validator scheme lets a misbehaving
  operator dodge slashing is a **protocol economics / infra** question.
- **TEE / enclave attestation (e.g. Jito BAM and similar).** Trust in a
  Trusted-Execution-Environment (remote attestation, enclave key management, side-channels) is
  a **hardware/enclave-security** discipline.

**Recommend specialist review** for these: validator-infra / consensus / cryptography houses
such as **Trail of Bits, NCC Group, or Kudelski (Cryptography Services)** — and state clearly in
the report that they fall outside the program-audit boundary.

---

## ZK & compression fast pass

- [ ] **Recognize the sub-class** (custom ZK/Fiat–Shamir §1 · cNFT/Bubblegum §2 · Light §3) and
      set the scope boundary explicitly in the report.
- [ ] **Scope-gate soundness:** any custom circuit / transcript ⇒ *require cryptographer
      review*; no soundness PASS from a program audit (§0, §1).
- [ ] §1 integration: every public input **absorbed before the challenge**; verifying key is
      canonical/non-swappable; proof bound to tx accounts.
- [ ] §2 cNFT: root-changelog/replay guard · monotonic leaf sequence · domain separation ·
      empty-subtree handling · no root-rotation race.
- [ ] §3 Light: unique **nullifier** derived from spent leaf + **atomic** insert-and-check ·
      proof bound to tx inputs · batched-MT/queue ordering sound.
- [ ] Every High/Critical here passes **Rule 5b** with a cited replay/rollback/forgery path — or
      is downgraded / marked `[UNCONFIRMED]` pending specialist review.
- [ ] Validator-consensus / slashing / TEE classes (§4): **awareness note + specialist
      recommendation**, not a program-audit verdict.
