# Methodology — Wallets, Multisig & Custody (Audit Checks)

> **Load when:** a smart-account / multisig / custody program (or a wallet-integration surface) is detected —
> grep markers: `threshold` · `multisig` · `member` · `propose` · `approve` · `execute_transaction` · `vault` · `guardian` · `recovery` · `spending_limit`
> (also: `add_member`, `remove_member`, `change_threshold`, `transaction_buffer`, `stale_index`,
> `smart_account`, `passkey`, `social_recovery`, `squads`, `time_lock`, `dispute_window`).
>
> **Purpose:** protocol-specific checks for programs that **hold or sign with authority on behalf of a
> distributed signer set** — the Squads-class on-chain smart account (member set + threshold + queued
> transactions), Realms-as-multisig (council-only realm), and passkey / social-recovery smart accounts
> (Swig, Lazorkit, Solana Keychain). Also frames the **off-chain custody surface** (key management,
> telemetry-SDK exfiltration, DNS/frontend, hardware blind-signing, operator/MPC custody) that dominates
> real-world losses here. These sit **on top of** the language-agnostic checklists (`checklists/01`–`07`,
> `11`, `12`); where a generic check covers the base case the note says *"beyond `<ID>`, also verify…"*.
>
> **How to use:** each section is an auditor check — *safe shape*, *failure mode*, *grep*. PASS = safe
> shape enforced *in code*; FAIL = failure mode reachable.
>
> **Why this surface is unusual:** for most categories the program bug is the loss; here **the majority of
> nine-figure-adjacent losses are NOT program bugs.** Slope (2022, ~$4.5M, ~9k wallets) shipped seed
> phrases to a Sentry logging endpoint; `@solana/web3.js` (Dec 2024) was an npm supply-chain backdoor
> exfiltrating keys via a CloudFlare header; DEXX (2024, ~$30M) was operator-side custody compromise of a
> trading-bot platform; the pump.fun-bot npm poisoning (2025) shipped a wallet-drainer through a poisoned
> lockfile. The on-chain smart-account audit is real and dense, but it is **~30% of the custody risk** — the
> rest is supply chain (`checklists/11`), secrets/opsec (`checklists/12`), DNS, and blind-signing. Multisig
> state-machine and threshold mechanics are public smart-account architecture; the incident lessons are
> public post-mortem material.

---

## 0. Classify the custody surface FIRST — the threat model splits on-chain vs off-chain

Two orthogonal questions decide scope: *what holds the authority* and *where the key material lives*. Get
both before scoping — auditing a Squads-style program as if the risk were the Rust, while the operator
runs a compromised npm lockfile, misses the actual attack.

| Variant | Example | Where authority lives | Dominant risk |
|---|---|---|---|
| **On-chain smart account (M-of-N)** | Squads v3/v4, Smart Account Program | program owns vault PDAs, member set + threshold on-chain | member-set mutation authz, threshold-vs-N, stale approvals, buffer replay, vault-seed binding, CPI scope at execute |
| **Council-as-multisig** | Realms council-only realm | SPL-Governance realm with a single council mint | token-weighted-quorum quirks, versioned-tx account substitution — cross-ref `governance.md` |
| **Passkey / social-recovery account** | Swig, Lazorkit, Solana Keychain | program-owned account with key-rotation + guardian recovery | every recovery path is a second authority graph; guardian backdoors; passkey-rotation binding |
| **MPC / threshold-sig custodial** | Fireblocks, Web3Auth, Coinbase WaaS | off-chain, appears as a single on-chain signer | integration only — request-signing flow, policy engine, who can request a signature for what |
| **Wallet-adapter / SDK** | `@solana/web3.js`, `@solana/kit`, wallet-adapter | user's wallet; SDK constructs the tx | supply chain (dep pinning, install scripts, telemetry) — `checklists/11`, `12` |
| **Hardware-wallet integration** | Ledger, Trezor | on-device key | display verification — every signed byte must render human-readable (blind-signing = 9-figure class) |
| **Embedded / smart-account-as-a-service** | Crossmint, Privy, Dynamic | provider-run (often MPC) | trust-boundary + recovery-flow + social-login-to-key binding, account takeover |

**Off-chain items are not re-derived here.** Supply-chain (telemetry exfiltration, lockfile discipline,
install-script auditing, dependency pinning) is owned by `checklists/11` (SC-*); secrets, key material,
DNS, and blind-signing hygiene are owned by `checklists/12` (SEC-*). This methodology **cross-links** to
them (§7) rather than duplicating — an on-chain-only reviewer must still open 11 and 12 for a custody
target.

```
grep -rn -E "threshold|multisig|member|propose|approve|execute_transaction|vault|guardian|recovery|spending_limit" programs/
```

---

## 1. Invariant catalog

Every wallet/multisig/custody audit must produce evidence (test / proof / review note) for each. Numbered
for cross-reference from the worksheets (§2) and the fast-pass checklist.

| # | Invariant | Failure = |
|---|-----------|-----------|
| **W1** | **Threshold integrity** — the on-chain threshold `M`, member count `N`, and member set are mutable **only** by an instruction that itself meets the current `M`-of-`N` quorum (or a documented recovery path with its own quorum + delay). No side path edits them | Attacker lowers threshold / injects a member → unilateral control |
| **W2** | **Threshold ∈ [1, N] preserved across every mutation** — after `add`/`remove`/`swap`/`change_threshold`, `1 ≤ threshold ≤ members.len()`; a `remove` that would leave `threshold > N` either auto-decrements (documented) or rejects — never silently clamps `threshold` to `N` (which quietly weakens quorum) | Quorum silently weakened, or vault bricked (unexecutable) |
| **W3** | **Stale-approval invalidation on member-set change** — any change to the member set or threshold invalidates approvals collected under the old set (via a monotonic `stale_index`/config-version stamped on both the config and each proposal). A removed member's prior approval never counts | Removed/rotated member's approval still counts toward quorum |
| **W4** | **Proposal lifecycle is a sound state machine** — `Draft/Active → Approved → Executed` (with `Cancelled`/`Rejected`/`Expired` terminals); each transition checks the current state as a pre-condition; no skip, no re-entry into a terminal, no re-approval after cancel | Double-execute, re-approve-after-cancel, execute-after-reject |
| **W5** | **Execution replay protection** — the `Executed` flag (or nonce consumption) is set **atomically with** — ideally **before** — the value-moving CPI; a re-run in the same or a later tx is rejected; the flag cannot be cleared | Same approved transaction executed twice |
| **W6** | **Buffer/proposal integrity — approved bytes == executed bytes** — the instruction data, program id, and full account list the members approved are recorded and are exactly what `invoke_signed` runs; no account substitution or arg mutation between approve and execute (incl. via ALT/versioned-tx swaps) | Members approve tx for {A,B,C}, execution runs {A,B,C′} → funds redirected |
| **W7** | **Vault-PDA seed binding** — every vault PDA derived by the program includes the **multisig/account pubkey** in its seeds and uses a **stored canonical bump**; a member of account A can never sign for account B's vault, and no user-supplied seed selects a foreign vault | Cross-account vault drain / shadow-PDA control |
| **W8** | **CPI privilege scope at execute is bounded** — the vault-PDA-signed CPI cannot grant the multisig **new** authorities, cannot mutate the multisig's own config outside the proposal path, and validates the target program id; introspection-gated approval parses defensively | Executed instruction escalates the account's own privileges |
| **W9** | **Recovery / guardian flows require quorum + delay + dispute** — every social-recovery / guardian / key-rotation path needs a guardian quorum (not a single key), a time-delay, and an owner dispute window; the new authority cannot be the recovering guardian; recovery cannot bypass the timelock on in-flight proposals | Single-guardian instant account takeover (backdoor) |
| **W10** | **Spending-limit / policy paths cannot be bypassed** — if a below-threshold "spending limit" (or session/passkey) path exists, its per-period allowance, destination allowlist, mint, and reset window are enforced and the limit account is bound to the multisig; the limit cannot be created/raised outside quorum, and its accounting can't be reset early or double-spent across periods | Below-quorum path drains beyond the intended allowance |
| **W11** | **Signer-set accountability** — every executed transaction is bound to the specific approver set that authorized it, recoverable from on-chain state (proposal account / events) for post-hoc audit | Cannot attribute an execution → no forensic trail |
| **W12** | **Authority-transfer is quorum-gated + delayed** — `set_authority` / `set_config_authority` / upgrade-authority changes require current quorum **and** a time-delay; handing authority to a single key requires explicit acknowledgment (loss of multisig protection) | Silent hand-off of the account (or program) to one key |
| **W13** | **Off-chain key material never crosses an untrusted boundary** — seed phrases, private keys, and signed-tx payloads never enter telemetry / error-reporting / analytics SDKs; keys are pinned-by-hash in the dep chain; hardware flows never ask the user to blind-sign. **The Slope / web3.js / DEXX class.** Owned by `checklists/11`–`12`; asserted here as a first-class invariant | Key exfiltration via SDK/supply-chain/blind-sign |

---

## 2. Per-instruction review worksheets

Each worksheet lists the safe shape. FAIL if any line is missing on any reachable path.

### `create_multisig` / `create_smart_account`
- Members are **deduplicated**; `threshold ∈ [1, N]` (W2); no member carries elevated privilege over others.
- The vault PDA(s) are derived with the multisig pubkey in seeds and the canonical bump is **stored** (W7).
- Initial config is immutable except through the guarded mutators (`change_threshold`/`add_member`/…); no
  post-create backdoor field (e.g. a `config_authority` that can rewrite members without quorum) (W1/W12).
- A `stale_index`/config-version is initialized so future rotations can invalidate stale approvals (W3).

### `create_transaction` / `propose` (queue a transaction / buffer)
- Proposer is a current member (W1). The proposal/buffer has a **unique nonce or index** — replay-safe (W5).
- The proposed instruction(s) — data, program id, **and the full account list** — are recorded byte-for-byte;
  no in-flight mutation after creation (W6).
- The proposal binds the **current** member-set + threshold (or stamps the current `stale_index`) so a later
  rotation is detectable at approve/execute time (W3).
- If a transaction **buffer** is filled incrementally (large tx), the buffer is finalized/sealed and hashed
  before it becomes approvable; a partially-written or post-finalization-appended buffer is rejected, and the
  buffer is bound to its creator + multisig (no cross-multisig buffer reuse, no stale buffer from before a
  member change) (W6).

### `approve` / `reject`
- Approver is a member **at approval time**, and the policy on "member at proposal-creation time vs approval
  time" is explicit and enforced (W1/W3).
- Re-approval by the same member is a **no-op**, not a double-count (W4).
- Approval is rejected if the proposal is `Cancelled`/`Rejected`/`Executed`/`Expired`, or if its stamped
  `stale_index` ≠ the multisig's current `stale_index` (W3/W4).

### `execute_transaction`
- Quorum is met **at execution time** against the proposal's bound member-set/threshold (W1); `stale_index`
  matches (W3).
- Proposal state is `Approved`; the `Executed` flag is flipped **before** the CPI and the instruction rejects
  if already executed (W5).
- The accounts + data + program id passed to `invoke_signed` **exactly match** the approved record (W6).
- The vault PDA signs via `invoke_signed` with seeds including the multisig pubkey + stored bump (W7); the CPI
  cannot grant the account new authority or rewrite its own config (W8).
- If the executed inner instruction targets this program's own config, it is rejected (config changes must go
  through the guarded mutators, not a self-CPI) (W8).

### `cancel_transaction`
- Cancellation requires proposer **or** quorum (per documented policy); a cancelled proposal can never be
  re-approved or executed (W4).

### `change_threshold`
- Requires current quorum (W1). Post-change `threshold ∈ [1, N]` (W2). Pending proposals are re-snapshotted or
  expired via `stale_index` bump — documented choice (W3).

### `add_member`
- Requires current quorum (W1); member is not a duplicate; `threshold ≤ new N` still holds (W2). The vault PDA
  **does not change** (else funds are stranded) (W7). `stale_index` bumped so pending approvals re-evaluate (W3).

### `remove_member`
- Requires current quorum (W1). After removal `threshold ≤ N`; if not, auto-decrement (documented) **or reject**
  — never silently treat `threshold` as `N` (W2). The removed member's pending approvals are invalidated via
  `stale_index` bump (W3).

### `swap_member`
- Atomic remove+add under the same quorum + all `add`/`remove` invariants; `stale_index` bumped once (W2/W3).

### `create_spending_limit` / `use_spending_limit` (below-quorum path, if present)
- Creation/raise requires **current quorum** (W1/W10). The limit account is bound to the multisig pubkey (W7).
- Each use enforces: per-period amount, destination allowlist, mint, and a monotonic reset window; the used
  amount is checked with checked arithmetic and cannot be reset early or double-counted across periods (W10).
- The limit is a **capability**, not a bypass of `execute` for arbitrary instructions — it can only move the
  configured mint to the configured destinations (W10).

### `set_authority` / `set_config_authority`
- Requires current quorum **and** a time-delay (W12). A single-key new authority requires explicit
  acknowledgment (documented loss of multisig protection).

### Owner-recovery / guardian / passkey-rotation flows
- `initiate_recovery`: caller is in the **guardian set** (not an arbitrary key); only one recovery in flight;
  records `new_owner`, an approver list, and `earliest_finalize = now + recovery_delay` (W9).
- `finalize_recovery`: guardian **quorum** met; `now ≥ earliest_finalize`; **owner dispute not signaled**; the
  new authority is **not** the recovering guardian; in-flight proposal timelocks are not bypassed (W9).
- Passkey / session-key rotation: the new key is bound to the account, the rotation itself is quorum-or-owner
  authorized, and an old rotated-out key cannot approve after rotation (W3/W9).

---

## 3. High-density surfaces (fastest findings)

- **S1 — Member-set mutation (`add`/`remove`/`swap`/`change_threshold`).** Off-by-one in signer counts,
  `threshold > N` after a remove, silent `threshold := N` clamping, and **removed-member approvals still
  counting**. Stale approvals after a member change are the canonical Squads-class finding. Beyond `AC-*`
  (access control): the additions are the **threshold-vs-N invariant** and **stale-approval invalidation** (W2/W3).
- **S2 — Transaction-buffer / proposal state machine.** Double-execution, re-approval after cancel, execution
  of a **stale buffer after member rotation**, and partially-written buffers becoming approvable. Beyond
  `SM-027`/`SM-043` (reinit / atomic transition): the addition is that the marker must be **config-version-bound**,
  not just locally unique (W4/W5).
- **S3 — Vault-PDA seed derivation.** Seeds missing the multisig pubkey → one account signs for another's
  vault; or a user-supplied seed selecting a foreign vault without canonicalization. Beyond `CPI-*` PDA items
  and `KV-104`: the angle is **vault-to-multisig binding** (W7).
- **S4 — CPI privilege scope at execute.** (a) the executed instruction may CPI into anything, including a
  program that grants the vault new authority; (b) **account substitution** at execution time (approved for
  {A,B,C}, executed with {A,B,C′}). Beyond `CPI-009`/`CPI-010` (validate program id in passed-through /
  `invoke_signed` CPIs): the addition is **approved-bytes == executed-bytes** and **no self-config-escalation** (W6/W8).
- **S5 — Recovery / guardian / passkey flows.** Every recovery path is a **second authority graph** that
  intentionally sidesteps `M`-of-`N`; single-guardian escape hatches, missing delay, missing dispute window.
  Beyond `OPS-*`: the addition is the **guardian quorum + delay + dispute** shape and "new authority ≠
  recovering guardian" (W9).
- **S6 — Instruction introspection in approval logic.** "Only sign an SPL transfer to a whitelisted address"
  is a **parser**, and parsers are bug-dense — under-length reads, wrong offsets, discriminator confusion.
  Cross-ref `KV-102` (introspection) (W8).
- **S7 — Off-chain supply-chain surface.** Dependency pinning, install scripts, telemetry SDKs, build pipeline,
  RPC-endpoint trust. **The dominant loss vector post-2024.** Owned by `checklists/11` (SC-*) — cross-link,
  don't re-derive (§7) (W13).

---

## 4. Attacker goals (frame the review)

Work backward from what an attacker wants; each maps to invariants to break:

1. **Gain unilateral control of the account** — lower the threshold / inject a member outside quorum (W1),
   or exploit a `threshold := N` clamp on removal (W2).
2. **Get a stale/removed key's approval to count** — change the member set and reuse an old approval (W3).
3. **Execute an approved tx twice** — missing/late `Executed` flag (W5).
4. **Redirect an approved transfer** — substitute accounts or mutate args between approve and execute, incl.
   via ALT/versioned-tx (W6).
5. **Drain another account's vault** — vault-PDA seeds not bound to the multisig (W7).
6. **Escalate via execution** — an executed CPI grants the vault new authority or rewrites its own config (W8).
7. **Take over via recovery** — a single-guardian / no-delay / no-dispute recovery backdoor (W9).
8. **Bypass quorum via a limit/session path** — abuse a below-threshold spending-limit or passkey path (W10).
9. **Exfiltrate the key entirely (off-chain)** — telemetry-SDK leak (Slope), poisoned dependency (web3.js /
   pump.fun-bot), operator compromise (DEXX), DNS/frontend swap, or hardware blind-sign (W13 → `checklists/11`–`12`).

---

## 5. Cross-cutting concerns

- **CC1 — Supply-chain hygiene is first-class, not "ops."** For any custody target, `checklists/11` gates:
  lockfile-only installs (`npm ci` / `--frozen-lockfile`), **dependency pinning by version *and* integrity
  hash**, `cargo audit`/`cargo deny`/`npm audit signatures` in CI, GitHub Actions `uses:` pinned by commit
  SHA (not `@v3`), recently-published-dependency flagging (SC-007–SC-009), and — critically — **telemetry-SDK
  gating**: Sentry/Datadog/LogRocket transports must never receive anything deserializable into a key. The
  Slope failure was exactly a misconfigured Sentry transport shipping plaintext seeds. Cross-ref SC-* and §7.
- **CC2 — Hardware-wallet display verification.** Every transaction sent to Ledger/Trezor must render as
  human-readable text on-device (transfer-display plugins). Any flow that asks a user to sign a **hash** on a
  hardware wallet is a high-severity UX failure — blind-signing has caused nine-figure losses across chains.
  If a custom program has no display plugin, present a parsed summary in the dApp AND document the trust gap.
  Cross-ref `checklists/12`.
- **CC3 — Off-chain key custody & MPC.** For custodians / MPC providers / embedded-wallet services /
  trading-bot operators, define the trust boundary (who can request a signature, what enforces the policy,
  what is logged) and the compromise model (malicious operator blast radius; cloud-account-takeover blast
  radius). The DEXX (~$30M) and noones incidents are the canonical operator-side failures. Cross-ref SEC-*.
- **CC4 — DNS / domain control.** A wallet, multisig UI, or custody dashboard whose DNS is compromised is
  fully compromised — the malicious frontend can build any transaction it wants signed. Require registrar +
  registry lock, DNSSEC, hardware-key 2FA on the registrar (not SMS/TOTP), SRI on third-party scripts, a
  restrictive CSP, and cert-transparency monitoring. Cross-ref `checklists/12`.
- **CC5 — Governance / council overlap.** A Realms-as-multisig or Squads-as-council target overlaps heavily
  with governance; a real treasury audit covers both. Cross-ref `references/methodologies/governance.md`
  (versioned-transaction account substitution, quorum/execution).

---

## 6. Test / PoC strategy

Wallet/multisig programs are **state machines with adversarial members** — testing must reflect that.

- **State-machine unit tests (W4/W5).** Every transition: `propose → approve → execute`, plus every illegal
  edge (approve-after-cancel, execute-twice, execute-below-quorum, re-enter a terminal). Mollusk for
  per-instruction + CU; LiteSVM for multi-instruction sequences.
- **Rotation + stale-approval tests (W2/W3) — MANDATORY.** Each of these **MUST be rejected**:
  - Approve, then remove an approver, then execute → the removed member's approval must **not** count.
  - `remove_member` leaving `threshold > N` → auto-decrement (assert the new threshold) **or** reject; never a
    silent `threshold := N`.
  - Approve under config-version `k`, bump the version, then execute → stale approvals rejected.
  - `add_member` then reuse a pre-rotation approval → rejected.
- **Adversarial-minority simulation (W1).** Scenario tests where `N − M + 1` members collude-malicious; assert
  **no** sequence of hostile-minority approvals executes anything, and rotation invalidates a malicious
  member's pre-rotation approvals.
- **Approve-then-substitute (W6) — MANDATORY.** Approve a transaction for accounts {A,B,C}; at execute pass
  {A,B,C′} (and, separately, mutated instruction data / a different program id, and an ALT that remaps an
  index) → each **must** fail. This is the highest-value negative test in the category.
- **Vault-isolation fuzz (W7).** Property test: attempt to make account A's members sign a withdrawal from
  account B's vault (shared program, different multisig pubkey) → must fail. Trident coverage-guided over
  random `(create, add, remove, propose, approve, execute)` sequences with the property set: never execute
  below threshold, never double-execute, never accept a stale approval, `threshold ≤ N` always holds,
  never sign for a foreign vault.
- **Recovery-flow tests (W9).** Single-guardian recovery → rejected; recovery with quorum but before
  `earliest_finalize` → rejected; recovery with an owner dispute signaled → rejected; new-owner == recovering
  guardian → rejected; recovery attempting to bypass an in-flight proposal timelock → rejected.
- **Spending-limit tests (W10).** Over-limit use → rejected; wrong-mint / off-allowlist destination →
  rejected; early reset / cross-period double-spend → rejected; raising the limit without quorum → rejected.
- **Formal verification (W1/W2).** Certora's public Squads v4 effort is the bar: encode the threshold
  invariant and prove no instruction trace violates it. Escalate the threshold + stale-approval invariants to
  FV for high-value custody programs.
- **Supply-chain CI gates as part of the suite (W13).** `cargo audit`, `cargo deny check`, `npm audit
  signatures`, and lockfile-diff review run on every PR and **block merge** — the gate is a test, not "ops."
- **Hardware-wallet display test (W13).** For any Ledger/Trezor flow, generate a representative transaction
  and verify the on-device parse renders correctly. Manual but mandatory pre-release.

---

## Wallets / multisig / custody checklist (fast pass)

- [ ] Custody surface classified (on-chain smart account / council / passkey-recovery / MPC / SDK / hardware / embedded); off-chain items routed to 11 & 12 (§0)
- [ ] Threshold, member count, and member set mutable only under current quorum; no backdoor config field (W1)
- [ ] `threshold ∈ [1, N]` preserved across every add/remove/swap/change; no silent `threshold := N` clamp (W2)
- [ ] Member-set / threshold change invalidates old-set approvals via a monotonic `stale_index`/config-version (W3)
- [ ] Proposal lifecycle sound: pre-condition-checked transitions, no skip / no terminal re-entry / no re-approve-after-cancel (W4)
- [ ] `Executed` flag flipped before the CPI and re-execution rejected — no replay (W5)
- [ ] Approved bytes == executed bytes: data + program id + full account list immutable across approve→execute, incl. ALT/versioned-tx (W6)
- [ ] Every vault PDA seeded with the multisig pubkey + stored canonical bump — no cross-account drain / shadow PDA (W7)
- [ ] Execute-time CPI can't grant new authority or rewrite own config; program id validated; introspection parsed defensively (W8)
- [ ] Recovery/guardian/passkey paths require guardian quorum + delay + dispute; new authority ≠ recovering guardian (W9)
- [ ] Spending-limit / session paths enforce amount + allowlist + mint + reset window, bound to the multisig, quorum-gated to raise (W10)
- [ ] Every execution attributable to its approver set on-chain (W11)
- [ ] `set_authority` / config-authority / upgrade-authority changes quorum-gated + time-delayed; single-key hand-off acknowledged (W12)
- [ ] Off-chain: keys never enter telemetry/analytics SDKs; deps pinned by hash; no hardware blind-signing (W13 → checklists/11, 12)
- [ ] Negative tests reject: stale-approval-after-rotation, approve-then-substitute-accounts, execute-twice, below-quorum, single-guardian-recovery (§6)

*Public incidents referenced: Slope (2022, ~$4.5M, ~9k wallets — Sentry telemetry shipping plaintext seed
phrases), `@solana/web3.js` npm backdoor (Dec 2024 — phished maintainer, key exfiltration via CloudFlare
header), DEXX (2024, ~$30M — trading-bot operator key-custody compromise), solana-pumpfun-bot (2025 — GitHub
release-URL lockfile poisoning shipping a wallet-drainer). Squads-class threshold/state-machine mechanics and
the guardian-recovery pattern are public smart-account architecture; the incident lessons are public
post-mortem material. Cross-refs: `AC-*` (access control), `CPI-009`/`CPI-010` (CPI program-id validation),
`SM-027`/`SM-043` (reinit / atomic transition), `OPS-*` (upgrade authority / multisig / timelock),
`KV-102` (instruction introspection), `KV-104` (PDA seed binding), `checklists/11` (SC-* supply chain),
`checklists/12` (SEC-* secrets / key custody / blind-signing), `references/methodologies/governance.md`.*
