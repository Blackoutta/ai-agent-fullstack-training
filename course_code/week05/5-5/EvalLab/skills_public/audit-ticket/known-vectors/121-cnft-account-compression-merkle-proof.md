---
id: 121
title: "cNFT / Account-Compression Merkle Proof Abuse"
severity: 7
category: crypto
---

### 121 — cNFT / Account-Compression Merkle Proof Abuse

**Severity: 7** | **Real: OtterSec account-compression + Metaplex Bubblegum audits (proof/root-lifecycle findings)**

Compressed NFTs (Metaplex **Bubblegum** over **`spl-account-compression`** concurrent Merkle trees) and any program that compresses state into an on-chain root store only the **root** on-chain; leaves live off-chain and are proven with an **inclusion proof** at mutation time. The vulnerable surface is the **proof + root lifecycle**, not the leaf contents. A program that validates the proof loosely can be made to accept a **stale or replayed** proof, **roll a leaf back** to a prior (higher-value or different-owner) state, forge inclusion of a **non-existent** leaf against default/empty subtree padding, or double-apply a mutation across a **root-rotation race**.

Concrete failure modes:
- **Stale / replayed proof acceptance.** A concurrent Merkle tree keeps a **changelog** of recent roots so proofs made against a slightly-old root still validate. If the program does not bound acceptance to the valid changelog window — or lets a proof for an **already-spent / superseded** leaf state be replayed — the same leaf can be acted on twice (duplicate transfer/mint).
- **Missing leaf-index / sequence monotonicity.** cNFT leaf schemas carry a **nonce / sequence** (leaf `nonce`, tree `sequence_number`). Without a **monotonic** progression check, an attacker rolls a leaf back to an earlier state.
- **Domain-separation errors.** Leaf hashing must be **domain-separated** (distinct prefixes for leaf vs. node, and per asset-type) so a value hashed in one position cannot be reinterpreted as a valid hash elsewhere — the compression analogue of type-cosplay.
- **Empty-subtree / canopy handling.** The canonical **empty/zero subtree** constants (and the on-chain **canopy** of cached upper nodes) must be used correctly so a proof cannot exploit default-filled nodes to prove inclusion of a leaf that does not exist. A too-short proof relying on a stale/incorrect canopy is a forgery path.
- **Root-rotation races.** When the root advances (append/`replace_leaf`) concurrently with a mutation, a proof validated against root *R* must not be applied after the tree moved to *R'* in a way that double-applies or resurrects a leaf.

> **Scope note.** The **soundness** of the underlying hashing/Merkle construction is a cryptographer / specialist concern — do not emit a soundness PASS from a program audit. The **integration** surface below (changelog/replay window, monotonic sequence, domain separation, empty-subtree/canopy, root-rotation) *is* program-audit-able and is what this vector checks. See `../references/vuln-classes/zk-and-compression.md` §2.

#### Verification Procedure

**Step 1: Detect account-compression / cNFT usage**
```
grep -rn -E "spl.?account.?compression|ConcurrentMerkleTree|bubblegum|mpl.bubblegum" .
grep -rn -E "verify_leaf|append|replace_leaf|prove|proof|changelog|canopy" .
```
- If no compression / Merkle-proof code: N/A
- If present: proceed

**Step 2: Proof bound to a valid current root (changelog window / replay)**
```
grep -rn -E "changelog|active_index|current_root|root ==|assert.*root|verify_leaf" programs/
```
- ✅ PASS: Proofs are accepted **only** against a root within the valid changelog window, and a proof for an already-spent/superseded leaf state cannot be replayed to act twice
- ❌ FAIL: Proof accepted against an arbitrary/stale root, or a spent leaf's proof can be replayed

**Step 3: Leaf-index / sequence monotonicity**
```
grep -rn -E "nonce|sequence|sequence_number|leaf_index|leaf_nonce|index >|index <|monoton" programs/
```
- ✅ PASS: Leaf `nonce` / tree `sequence_number` progression is enforced monotonic — a leaf cannot be rolled back to a prior state
- ❌ FAIL: No monotonicity check; an older leaf state can be re-proven

**Step 4: Domain separation of leaf hashing**
- ✅ PASS: Leaf vs. node hashing (and per asset-type) uses **distinct domain prefixes**; a value hashed in one position cannot be reinterpreted as valid in another
- ❌ FAIL: Undifferentiated hashing that permits cross-position reinterpretation (compression type-cosplay)

**Step 5: Empty-subtree / canopy handling**
- ✅ PASS: Canonical empty/zero-subtree constants are used and the on-chain **canopy** is validated — a proof cannot forge inclusion of a non-existent leaf against default-filled padding, and proof length cannot be truncated using a stale canopy
- ❌ FAIL: Default/empty nodes or an unchecked canopy let inclusion be proven for a leaf that never existed

**Step 6: Root-rotation race**
- ✅ PASS: No window where a proof validated against root *R* is applied after the tree advanced to *R'* in a way that double-applies or resurrects a leaf (mark/consume is bound to the same root state it validated against)
- ❌ FAIL: Concurrent root advance + mutation can double-apply or revive a leaf

**Overall verdict:**
- ✅: Proof bound to current root, sequence-checked (monotonic), domain-separated, correct empty-subtree/canopy handling, no root-rotation race
- ⚠️: Proof/root validation present but one guard (e.g. monotonic sequence or canopy validation) is missing or weak
- ❌: Stale/replayed proofs accepted, leaf rollback possible, missing domain separation, or forgeable inclusion via empty subtrees — route each finding with the concrete replay/rollback/forgery path (duplicate mint, ownership theft)
- N/A: No account-compression / cNFT / Merkle-proof functionality
