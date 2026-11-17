# Methodology — SPL Governance & Realms (Audit Checks)

> **Load when:** on-chain DAO voting is detected — grep markers: `spl-governance`,
> `spl_governance`, `realm`, `token_owner_record`, `proposal`, `vote_record`,
> `voter_weight`, `vsr`, `governance`, `proposal_transaction`, `hold_up`.
>
> **Purpose:** What to verify in SPL Governance / Realms deployments and custom on-chain
> voting. This file is **DAO-voting-specific** — the vote lifecycle, weight, quorum, and
> proposal-execution surface. It is deliberately **orthogonal to `checklists/07`**, which
> owns the generic upgrade-authority / multisig-threshold / timelock opsec surface. Read
> both; do not duplicate the 07 checks here.
>
> **Cross-reference:** `checklists/07` (opsec/governance — thresholds, timelocks, multisig,
> upgrade authority), `checklists/02` (access control), `checklists/05` (state machine). If
> a proposal can swap an oracle config, `references/methodologies/oracles.md` applies to the
> executed instruction.
>
> **Public exploit provenance:** most catastrophic governance incidents are *configuration*
> failures, not code failures. Credited public incidents: Solend governance crisis
> (emergency proposal to seize a whale account, passed under a captured/low-participation
> quorum) and Saga DAO ($60K, a 1-of-12 multisig threshold). These are public post-mortems,
> not sourced from any private corpus.

---

## 1. Deposit/withdraw atomicity in the voting window — withdraw-to-re-vote

If a voter can **deposit tokens, vote, withdraw, and re-deposit/re-vote** within an active
proposal's window, the same tokens vote more than once (or a flash-loaned position votes and
exits in one block). The `TokenOwnerRecord` must lock or snapshot deposited weight for the
duration a voter has an active vote on a live proposal — withdrawal must be blocked (or the
vote invalidated) while that vote stands.

**Auditor check**
- PASS: withdrawing governing tokens is blocked while the owner has an unrelinquished vote on
  an active proposal; or weight is snapshotted at vote time so a later withdrawal can't free
  tokens to vote again.
- FAIL: deposit and withdraw are unrestricted during voting, letting one balance vote across
  multiple proposals or cycle within one. Cross-link `checklists/05` (state machine).

```
grep -rn -E "token_owner_record|deposit_governing|withdraw_governing|unrelinquished|active_votes" programs/
```

---

## 2. Voter-weight snapshot vs live balance — flash-loan resistance

Voting weight computed from a **current, freely-transferable** balance is flash-loan
vulnerable: borrow tokens, deposit, vote, repay — one block. Weight must derive from an
escrowed/time-locked source (VSR) or a snapshot taken at proposal creation, not the live
balance of a tradeable token.

**Auditor check**
- PASS: a voter-weight plugin that escrows (VSR) or snapshots weight, so borrowed tokens
  can't be converted to voting power in-tx; naive "token haver" (weight from holding, not
  depositing) is avoided.
- FAIL: weight = current balance of a transferable token with no escrow/snapshot — the
  flash-loan-vote primitive. This is the recurring Realms misconfiguration.

```
grep -rn -E "voter_weight|snapshot|VSR|vote_escrow|token_haver|current.*balance" programs/
```

---

## 3. Vote-record double-count across delegation / plugin chains

A `VoteRecord` is per-`(proposal, voter)`. Double-counting arises when weight is aggregated
across a **delegation chain** or a **plugin chain** without deduplication — a delegate's own
tokens plus delegated tokens counted twice, or two voter-weight plugins each contributing the
same underlying tokens. Confirm each unit of underlying weight can back **at most one** vote
on a given proposal.

**Auditor check**
- PASS: delegation and plugin-derived weight are deduplicated; a token delegated to a
  delegate does not also vote in the owner's own record; composed plugins don't stack the same
  underlying.
- FAIL: additive weight across delegation/plugins with no dedup — the same tokens vote
  multiple times. Cross-link `checklists/02`.

```
grep -rn -E "vote_record|delegat|voter_weight_record|aggregate|max_voter_weight" programs/
```

---

## 4. Vote-tipping — `Early` executes before the deadline

`vote_tipping` decides when a proposal resolves. `Early` (or `Disabled`-but-tipping) can
**tip a proposal to Succeeded before the voting deadline** the moment a threshold is
numerically reached — cutting short the window in which opposing voters or the community could
react. For high-impact governances, `Strict` (no tipping; wait for the deadline) is the safe
setting. Absence of a cool-off period after the deadline compounds this.

**Auditor check**
- PASS: high-impact Governances use `VoteTipping::Strict` and a `voting_cool_off_time` that
  admits late votes; tipping-early is reserved for low-stakes parameter changes if at all.
- FAIL: `Early` tipping on a Governance that controls upgrades/treasury/mint — proposals
  resolve before the community can respond. Cross-link `checklists/07`.

```
grep -rn -E "vote_tipping|VoteTipping|Early|Strict|cool_off|cool_?down" programs/
```

---

## 5. Quorum ambiguity — % of max_voter_weight vs % of votes cast

"66% threshold" is ambiguous and the ambiguity is exploitable. Is it 66% of
**max_voter_weight** (total possible), or 66% of **votes cast**? A "% of votes cast" model
with low turnout lets a tiny organized faction pass anything. Confirm the threshold semantics
match documented intent and that a quorum floor exists so low-participation passes are
impossible.

**Auditor check**
- PASS: threshold semantics are explicit and match the docs; a minimum quorum (share of
  max_voter_weight) must be reached regardless of turnout for high-impact actions.
- FAIL: threshold is "% of votes cast" with no quorum floor — capture requires only
  out-participating a sleepy electorate. Cross-link `checklists/07`.

```
grep -rn -E "quorum|max_voter_weight|votes_cast|threshold|YesVotePercentage|participation" programs/
```

---

## 6. Per-ProposalTransaction `hold_up_time` bypass

A Proposal can contain multiple `ProposalTransaction`s, **each with its own execution-delay
timestamp**. The timelock is only as strong as the *shortest* per-transaction hold-up. A
malicious proposal can bundle a benign long-delay transaction with a high-impact
zero/short-delay one, so the dangerous instruction executes before the community's reaction
window. Verify the hold-up is enforced **per executed transaction**, and that no path lets a
transaction execute before its delay.

**Auditor check**
- PASS: every `ProposalTransaction`'s `hold_up_time` is independently enforced at execute
  time; there is a floor on hold-up for high-impact instruction types; no transaction executes
  before `voting_completed_at + hold_up`.
- FAIL: hold-up checked only at the proposal level, or a transaction with a
  shorter-than-policy delay slips execution. Cross-link `checklists/07` (timelock discipline).

```
grep -rn -E "hold_up|hold_up_time|proposal_transaction|execute|delay|min_transaction" programs/
```

---

## 7. Authority scope creep — self-granting proposals

A proposal that grants the executing Governance **new** authority (make itself the upgrade
authority of a previously immutable program, assign itself a treasury/mint authority) lets
governance bootstrap unbounded power over time. Every instruction a Governance can execute
that **changes an authority assignment** deserves a distinct, stricter review path — it is
categorically different from a routine parameter change.

**Auditor check**
- PASS: authority-granting instructions are gated behind a separate high-threshold /
  long-timelock Governance, or explicitly disallowed; a captured lower-tier quorum can't
  escalate its own scope.
- FAIL: a `ParameterChanges`-tier Governance can execute `set_upgrade_authority` /
  `set_authority` / mint-authority assignment — one captured low quorum escalates to total
  control. Cross-link `checklists/02`, `07`.

```
grep -rn -E "set_authority|set_upgrade_authority|assign|grant|self.*authority|MintGovernance|ProgramGovernance" programs/
```

---

## 8. Cross-governance PDA-signing isolation

Under one Realm, multiple Governances each control different authorities (upgrade, treasury,
mint, params). Their signer PDAs must be **derived from distinct seeds** so that executing a
proposal under Governance A cannot produce a signature usable for an action scoped to
Governance B. A shared or collidable signer PDA collapses the intended authority separation.

**Auditor check**
- PASS: each Governance's signing PDA is uniquely seeded (per Governance / per target); an
  approved action under one Governance can't sign for another's scope.
- FAIL: Governances share a signer PDA, or seeds collide, so authority separation is nominal
  only. Cross-link `checklists/04` (PDA), `02`.

```
grep -rn -E "invoke_signed|governance.*pda|seeds|native_treasury|signer.*governance" programs/
```

---

## 9. VSR integrity — lock-duration + NFT collection spoofing

Vote-Escrowed Realms (VSR) derives weight from **lock duration** — longer lock, more power.
Two failure modes:
- **Lock-duration integrity:** a voter must not be able to claim long-lock weight while
  actually able to unlock early (weight and the real lock must be consistent; no reducing the
  lock after voting without losing the weight).
- **NFT collection spoofing:** for NFT-gated weight, the NFT's **collection** must be verified
  (`verified == true` and the expected collection key), not just that the account is *an* NFT.
  An unverified/forged collection field is a weight-forgery primitive.

**Auditor check**
- PASS: VSR weight is a faithful function of an enforced lock that can't be shortened
  post-vote for free; NFT-voter checks verified collection membership against the expected
  collection.
- FAIL: lock duration and claimed weight can diverge; NFT weight accepts unverified collection
  metadata. Cross-link `checklists/01` (metadata validation).

```
grep -rn -E "vsr|lockup|lock_duration|deposit_entry|collection|verified|nft_voter" programs/
```

---

## 10. Backdoored proposal — read the instruction, not the prose

A proposal's human-readable description is **not** what executes. The serialized
`ProposalTransaction` instruction data is. A backdoored proposal presents a benign
description while the encoded instruction does something else (drains treasury, grants
authority). The auditor (and voters) must **decode the actual instruction bytes** and confirm
they match the stated intent — never approve on the description alone.

**Auditor check**
- PASS: review decodes each `ProposalTransaction`'s program ID, accounts, and data and
  confirms they match the description; the UI/review process surfaces the decoded instruction.
- FAIL: proposals reviewed by title/description only; a mismatch between prose and encoded
  instruction goes undetected. This is a *review-process* finding as much as a code one.

```
grep -rn -E "proposal_transaction|instruction_data|InstructionData|serialize|accounts" programs/
```

---

## 11. Stale-proposal execution after config change

A proposal drafted and passed under one `GovernanceConfig` may execute after the config has
changed (threshold raised, authority moved, target program upgraded). Executing a stale
proposal can apply an instruction that no longer reflects current policy, or act on an
authority the Governance no longer legitimately holds. Confirm execution re-validates against
current config/authority, or that config changes invalidate in-flight proposals.

**Auditor check**
- PASS: at execute time the proposal is re-checked against the current Governance config and
  the Governance still holds the target authority; a config change either bumps a version that
  invalidates older proposals or is explicitly handled.
- FAIL: a passed proposal executes with no re-validation after a config/authority change —
  stale instructions apply under new rules. Cross-link `checklists/05`.

```
grep -rn -E "config|version|voting_completed|execute|governance_config|stale" programs/
```

---

## 12. ALT mutated between approval and execution

Proposals using a versioned transaction with an **Address Lookup Table** resolve account
indices against the ALT *at execution time*. If the ALT can be mutated (extended / entries
swapped) between when the proposal was reviewed/approved and when it executes, the resolved
accounts differ from what voters approved — a bait-and-switch on the account set. Confirm the
ALT is frozen/immutable, or that resolved accounts are pinned and re-validated at execute
time.

**Auditor check**
- PASS: any ALT referenced by an executable proposal is frozen (deactivated authority) before
  approval, or the execution re-validates that resolved accounts match the approved set.
- FAIL: a mutable ALT feeds a versioned proposal transaction; its owner can rewrite the
  account set post-approval. Cross-link `checklists/04`, `05`.

```
grep -rn -E "lookup_table|address_lookup|ALT|versioned|freeze|deactivate.*lookup" programs/
```

---

## Governance checklist (fast pass — DAO-voting-specific; pair with `checklists/07`)

- [ ] Token withdrawal blocked (or weight snapshotted) while a vote on a live proposal stands — no withdraw-to-re-vote (§1)
- [ ] Voter weight from escrow (VSR) or a proposal-creation snapshot, not a live tradeable balance — flash-loan resistant (§2)
- [ ] Delegation/plugin weight deduplicated; each underlying unit backs ≤ 1 vote per proposal (§3)
- [ ] High-impact Governances use `VoteTipping::Strict` + cool-off; `Early` tipping doesn't cut short the window (§4)
- [ ] Threshold semantics explicit; a quorum floor blocks low-participation capture (§5)
- [ ] Per-`ProposalTransaction` hold-up independently enforced; no short-delay bundling bypass (§6)
- [ ] Authority-granting proposals gated separately/stricter — no self-granting scope creep (§7)
- [ ] Each Governance signs with a uniquely-seeded PDA — cross-governance isolation holds (§8)
- [ ] VSR lock-duration integrity enforced; NFT weight verifies collection membership (§9)
- [ ] Proposals reviewed by decoded instruction bytes, not description — backdoor detection (§10)
- [ ] Execution re-validates against current config/authority — no stale-proposal execution (§11)
- [ ] ALTs backing versioned proposals are frozen or re-validated at execute (§12)
- [ ] Generic threshold / timelock / multisig / upgrade-authority checks per `checklists/07`
- [ ] Oracle-config-changing proposals also pass `references/methodologies/oracles.md`
