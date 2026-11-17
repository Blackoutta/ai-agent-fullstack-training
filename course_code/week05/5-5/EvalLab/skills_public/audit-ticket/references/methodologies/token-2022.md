# Methodology — Token-2022 / Token-Extensions (Downstream-Integration Audit Checks)

> **Load when:** a protocol **accepts, holds, or moves Token-2022 mints** is detected — grep markers:
> `token_2022` · `TokenInterface` · `transfer_hook` · `TransferFee` · `PermanentDelegate` · `ConfidentialTransfer` · `get_extension` · `spl_token_2022`
> (also: `token_interface`, `InterfaceAccount`, `Interface<'info, TokenInterface>`, `transfer_checked`,
> `StateWithExtensions`, `ExtensionType`, `TransferHook`, `ExtraAccountMetaList`, `DefaultAccountState`,
> `InterestBearing`, `ScaledUiAmount`, `MintCloseAuthority`, `CpiGuard`; **Token ACL / SRFC-37:** `token_acl`,
> `TACLkU6`, `MINT_CFG`, `gating_program`, `thaw_permissionless`, `can_thaw_permissionless`).
>
> **Purpose:** protocol-specific checks for **downstream integrators** — a DeFi protocol, vault, AMM,
> lending market, perp, bridge, wallet, staking system, or indexer that handles tokens issued under the
> Token Extensions Program (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). **The scope is NOT the
> Token-2022 program itself** (that is reviewed across 15+ third-party engagements). The scope is the
> integration: which extensions a given mint has enabled, and whether *your* code behaves correctly. These
> sit **on top of** the language-agnostic checklists (`checklists/01`–`06`); where a generic check covers the
> base case the note says *"beyond `<ID>`, also verify…"*. The confidential-transfer / ZK surface overlaps
> `references/vuln-classes/zk-and-compression.md` — cross-linked, not duplicated.
>
> **How to use:** each section is an auditor check — *safe shape*, *failure mode*, *grep*. PASS = safe
> shape enforced *in code*; FAIL = failure mode reachable.
>
> **Why this surface is dense:** "we support Token-2022" is not one claim — it is a **per-extension** claim,
> and protocols routinely pass ten extensions and fail one. Token-2022 is a strict **superset** of SPL Token
> that stitches opt-in *extensions* onto mints and accounts, mutating what `transfer`, `mint_to`, `burn`, and
> **balance reads** mean. The single most-reported integration finding is **fee-blind accounting** (crediting
> the requested `amount` instead of the received delta on a TransferFee mint); the highest-severity is a
> **PermanentDelegate** mint accepted into a vault (a third party can seize custodied funds). The whitehat ZK
> ElGamal soundness disclosures (2025, Fiat-Shamir transcript gaps) are the reminder that confidential
> extensions ride on a proof program that is itself a trust root. Extension semantics are public program
> documentation.

---

## 0. Read the mint's extension set FIRST — every downstream check branches on it

Two layers of extensions exist: **mint extensions** (configured on the mint, affect every account of that
mint) and **account extensions** (configured on a token account — the integrator's own vault accounts are
the relevant ones). The first action against any accepted mint is to parse its extension set with the
**official accessor** and branch on the full tuple — never hand-roll TLV walking, never branch on one flag
in isolation.

```rust
use spl_token_2022::extension::{StateWithExtensions, ExtensionType, BaseStateWithExtensions};
use spl_token_2022::state::Mint;

let mint_data = mint_account.try_borrow_data()?;
let mint = StateWithExtensions::<Mint>::unpack(&mint_data)?;   // official parser; do NOT hand-roll TLV
let extensions = mint.get_extension_types()?;                  // branch on the FULL set, not one flag
```

```
grep -rn -E "token_2022|spl_token_2022|TokenInterface|token_interface|get_extension|StateWithExtensions" programs/
grep -rn -E "transfer_hook|TransferFee|PermanentDelegate|ConfidentialTransfer|DefaultAccountState|InterestBearing|ScaledUiAmount|MintCloseAuthority|CpiGuard" programs/
```

---

## 1. Per-extension bug / defense table

Each row: what the extension does → the bug it introduces downstream → the canonical defense. This is the
core of the methodology; the invariants (§2), coexistence matrix (§3), and allowlist tiers (§4) operationalize it.

| Extension | What it does | Downstream bug | Canonical defense |
|---|---|---|---|
| **TransferFee** | withholds a bps fee on every transfer; receiver gets `amount − fee`, fee accrues on the destination | **fee-blind accounting** — vault credits the *sent* `amount`, double-counting the fee; fees-on-fees geometric decay through wrapper hops | **read post-transfer balance delta** on the destination (`after − before`); credit the delta, never the `amount` arg. `transfer_checked_with_fee` only as a sanity assert, not a replacement (T1) |
| **TransferHook** | invokes a protocol-defined program on every transfer, with `ExtraAccountMetaList`-resolved extra accounts, **inside the transfer CPI** | arbitrary CPI + **remaining-accounts injection** + **reentrancy** (hook calls back into the caller holding unflushed state); recursion (hook re-transfers same mint) hard-errors mid-tx; griefing (hook always reverts → mint untransferable) | **pin the hook program id against an allowlist** at mint registration; validate `ExtraAccountMetaList` derivation; treat the hook as **untrusted CPI**; flush caller state before the transfer; assume the hook reads everything its extra accounts grant (T2) |
| **PermanentDelegate** | mint authority designates an account that can transfer/burn from **any** account of this mint with no holder signature | **third party can seize custodied tokens** — the delegate drains the vault; the protocol's own access control is bypassed entirely | **reject at custody time** — parse `permanent_delegate`; if non-default and not the protocol itself, refuse in the **allowlist**, not the deposit ix (T4) |
| **FreezeAuthority / DefaultAccountState** | new accounts open in a chosen state (usually `Frozen`); freeze authority can freeze any account any time | **freeze DoS** — the vault account itself is frozen mid-flight, halting deposits/withdrawals/liquidations; deposits fail until thaw | prefer null freeze authority on critical paths; else **surface the freeze error clearly** (never swallow-and-retry into a stuck loop); document the trust assumption (T5); if the mint is SRFC-37 / Token ACL-gated (freeze authority delegated to a gate program) apply §9 |
| **ConfidentialTransfer / ConfidentialMintBurn / ConfidentialBalances** | ElGamal-encrypted balances/amounts; transfers carry ZK proofs verified by the ZK ElGamal Proof Program | **opaque amounts break plaintext accounting**; **ZK soundness** is the trust root (Fiat-Shamir gaps were forgeable, 2025); a non-zero `auditor_pubkey` is a **decrypt backdoor** | treat the confidential balance as **opaque** (no plaintext shadow ledger); pin the **post-patch** ZK ElGamal Proof Program id; inspect + disclose `auditor_pubkey`, refuse non-zero unless explicitly accepted; escalate to ZK specialists (T8; cross-ref `references/vuln-classes/zk-and-compression.md`) |
| **InterestBearing / ScaledUiAmount** | UI/display amount = `raw × multiplier` (Scaled) or `raw × (1+r)^t` (Interest); **raw `amount` is unchanged**; multiplier/rate is **mutable** by an authority | **display-vs-raw drift** — protocol quotes/settles in UI units at one boundary and raw at another → double- or under-count; cached multiplier goes stale on update | pick **one accounting layer (raw, internally)**; convert to UI only at the display boundary via the official helpers; **never cache** the multiplier/rate; treat any update as state-invalidating (T9) |
| **MetadataPointer / MintCloseAuthority** | metadata pointer references a (possibly self / external) metadata account, authority can update it; close authority can close the mint account | **spoofing** — stale/attacker-controlled `(name, symbol, uri)`; embedded-metadata re-borrow hazard; **mint revival** — a closed mint account's address can be recreated, and code caching "mint X exists / decimals = d" is fooled | resolve the pointer + validate its owner program at **use-time**; use `spl_token_metadata_interface` to bounds-check embedded metadata; treat a mint with a live close authority as unstable — re-read mint state, don't cache existence/decimals across the close boundary (T7) |
| **CpiGuard** | *account* extension: blocks the account being used as a CPI authority unless the caller owns it | absent CpiGuard, a protocol vault passed into an upstream program can be made to authorize an unintended transfer via authority-chain confusion | **enable CpiGuard on every protocol-owned Token-2022 vault**; disable only via an explicit admin ix + audit trail (T3) |
| **ImmutableOwner** | *account* extension: prevents `owner` change via `set_authority` | a brief window of misconfigured authority permanently reassigns vault ownership, locking out the protocol | **enable on every protocol-owned vault**; ATAs get it by default, manually-created vaults must opt in at init (T3) |
| **Pausable** | global mint-level pause; when paused, `Transfer`/`MintTo`/`Burn` all revert | **liveness** — a paused mint halts liquidations, oracle rebalances, keeper actions; a pause toggled between simulate and execute weaponizes the failure; an insider can sandwich state transitions | treat the pause authority with **freeze/mint-authority-level scrutiny** (diversified, time-locked, multisig); reject hostile/unknown pause authority; surface pause errors clearly (T5/T10) |
| **NonTransferable** | transfers always fail; only mint/burn/close work | **liveness** — code assuming "deposit ⇒ withdraw via transfer" breaks permanently; LP/share wrappers can't redeem | **reject at acceptance** from any flow requiring transfer-out; allow only where mint/burn/close semantics suffice (T5) |
| **GroupPointer / MemberPointer** | Token Group standard — a mint is a group or a member; group authority can add members at will | **identity confusion** — treating "same group" as "same trust domain" inherits the group authority's trust; a hostile mint can be added tomorrow | gate on the conjunction `(group_id, group_authority)`; **snapshot membership** at the decision point; never infer trust transitively from group identity (T10) |

---

## 2. Invariant catalog

For every protocol that integrates Token-2022, the following must hold. Evidence (test / review note) per item.

| # | Invariant | Failure = |
|---|-----------|-----------|
| **T1** | **Vault accounting tracks NET received, not GROSS sent** — a credited balance equals the destination's **post-transfer balance delta**, not the transfer's `amount` argument | Fee-on-transfer mint over-credits; share math inflated |
| **T2** | **Transfer hooks are treated as untrusted CPI, configured acyclically** — hook program id is allowlisted, extra accounts are validated, caller state is flushed before the transfer, and a hook that re-transfers the same mint is impossible by construction | Reentrancy / remaining-accounts injection / griefing |
| **T3** | **Protocol-owned Token-2022 vaults have `CpiGuard` + `ImmutableOwner` enabled** — not optional | Upstream authority confusion / ownership hijack |
| **T4** | **PermanentDelegate-bearing mints are rejected at custody time** — inspected in the mint allowlist, refused if the delegate is not the protocol itself | Third party seizes custodied funds |
| **T5** | **Freeze/pause/non-transferable states are handled, not swallowed** — any mint with active freeze authority (incl. `DefaultAccountState=Frozen`, `Pausable`, post-hoc `freeze_account`) or `NonTransferable` produces a clean surfaced error, never a retry loop or a silent success | Freeze/pause DoS wedges the protocol |
| **T6** | **Token-program id is pinned** — `Interface<'info, TokenInterface>` + `token::token_program = token_program`; the program is not whichever was passed | Silent SPL Token vs Token-2022 confusion |
| **T7** | **Decimals read at deserialize; multiplier/rate resolved at use-time** — decimals come from the mint (0–18, never hard-coded `9`); ScaledUiAmount/InterestBearing conversions use the **current** multiplier/rate and are not cached | Amount mis-scaling; stale-conversion drift |
| **T8** | **Confidential balances are opaque; ZK proof program version validated** — no plaintext shadow ledger of encrypted balances; any call into the ZK ElGamal Proof Program targets the **post-patch** deployment; `auditor_pubkey` is inspected and disclosed | Broken accounting; forged proofs; undisclosed decrypt backdoor |
| **T9** | **A single accounting layer is chosen (raw internally)** — the protocol never quotes in UI units at one boundary and settles in raw at another | Double-count / under-count of interest/scaling |
| **T10** | **Authority diversity of every accepted mint is audited** — one key holding mint + freeze + pause + permanent-delegate authority is a total-control vector; group membership is gated on `(group_id, group_authority)` | Single-key total control; transitive-trust injection |
| **T11** | **Mint extension parsing uses the official accessor** — `StateWithExtensions` / `get_extension`, not hand-rolled TLV walking that can skip an unknown extension without honoring its length and mis-parse the rest | Extension mis-parse → wrong code path |
| **T12** | **Permissioned (Token ACL / SRFC-37) semantics are enforced by a verified gate, not assumed** — the gate `can_thaw` / `can_freeze` decisions key on the token account real owner and mint, verify the Token ACL flag context, validate extra-account PDAs, are exact inverses of each other, and protocol-owned accounts have a proven thaw path (§9) | Permissionless freeze griefing / unauthorized thaw / protocol vault DoS |

---

## 3. Coexistence / compatibility matrix (which extensions are safe to accept)

The Token-2022 runtime **rejects illegal combinations at mint init**, so some worry is moot — but downstream
code that branches on individual flags can still take a wrong path when two are present. Verify the matrix
against the `spl-token-2022` version the protocol depends on (it has evolved). `Y` = coexist, `N` = mutually
exclusive (runtime rejects), `~` = coexist with correctness caveats.

|                      | TransferFee | TransferHook | Confidential* | PermanentDelegate | NonTransferable | DefaultAcctState | MetadataPtr | InterestBearing | ScaledUiAmount | Pausable |
|----------------------|:-----------:|:------------:|:-------------:|:-----------------:|:---------------:|:----------------:|:-----------:|:---------------:|:--------------:|:--------:|
| TransferFee          | —           | **N**        | ~             | Y                 | **N**           | Y                | Y           | Y               | Y              | Y        |
| TransferHook         | **N**       | —            | **N**         | Y                 | Y               | Y                | Y           | Y               | Y              | Y        |
| Confidential*        | ~           | **N**        | —             | Y                 | **N**           | Y                | Y           | Y               | ~              | Y        |
| PermanentDelegate    | Y           | Y            | Y             | —                 | Y               | Y                | Y           | Y               | Y              | Y        |
| NonTransferable      | **N**       | Y            | **N**         | Y                 | —               | Y                | Y           | Y               | Y              | Y        |
| DefaultAcctState     | Y           | Y            | Y             | Y                 | Y               | —                | Y           | Y               | Y              | Y        |
| MetadataPtr          | Y           | Y            | Y             | Y                 | Y               | Y                | —           | Y               | Y              | Y        |
| InterestBearing      | Y           | Y            | Y             | Y                 | Y               | Y                | Y           | —               | **N**          | Y        |
| ScaledUiAmount       | Y           | Y            | ~             | Y                 | Y               | Y                | Y           | **N**           | —              | Y        |
| Pausable             | Y           | Y            | Y             | Y                 | Y               | Y                | Y           | Y               | Y              | —        |

**Incompatibilities worth memorizing:**
- `TransferHook × TransferFee` and `TransferHook × Confidential*` — runtime rejects (hook wants plaintext
  amounts and to mutate the transfer flow; confidential has no plaintext, fee logic already mutates it).
- `NonTransferable × TransferFee` / `× Confidential*` — there are no transfers to fee or encrypt.
- `InterestBearing × ScaledUiAmount` — two scalar multipliers on the same UI amount is undefined.
- `Confidential* × TransferFee` / `× ScaledUiAmount` (`~`) — they **coexist**, but the fee/scale is applied at
  instruction-construction time **inside the ZK proof**, not on the resulting ciphertext. This combined path
  is one of the **highest-bug-density surfaces** in the whole program — escalate it.

**Downstream branching rule:** branch on the **full extension tuple**, not on individual booleans. Code that
independently checks "hook present?" and "confidential present?" can produce a wrong path when the mint's
real combination is neither of the branches written.

---

## 4. Mint-allowlist tier policy

No serious integrator accepts arbitrary Token-2022 mints. The allowlist is the primary policy lever and must
be **on-chain enforced** (a `mint_registry` / per-mint PDA), not merely documented.

- **Tier 0 — reject Token-2022 entirely.** SPL Token only. The simplest, most defensive posture; appropriate
  for legacy protocols not engineered for extension semantics.
- **Tier 1 — Token-2022 with no extensions.** Accept only mints whose extension set is **empty** (behaves
  identically to SPL Token). Verified at registration.
- **Tier 2 — curated extension allowlist.** Accept only extensions the protocol has explicitly engineered for.
  Typical **safe** set: `MetadataPointer`, `GroupPointer`/`MemberPointer` (gated on authority),
  `InterestBearing`/`ScaledUiAmount` (with raw-amount accounting), `ImmutableOwner` (holder side). Typical
  **refused** set: `PermanentDelegate`, `TransferHook` (unless hook is whitelisted), `NonTransferable`,
  `DefaultAccountState=Frozen`, and hostile/unknown `Pausable` or freeze authority.
- **Tier 3 — full Token-2022 support.** Accept all extensions with explicit per-extension handling —
  fee-aware accounting, hook validation, confidential-amount opacity, pause-tolerant flow, the works. Reserved
  for protocols whose business model **is** Token-2022 (wrapped-asset bridges, issuance platforms).

**Governance flow for adding a mint (Tier 2/3):** read the extension set on-chain and serialize it into the
proposal; enumerate every enabled extension with its risk acknowledgment; list every authority (mint, freeze,
pause, permanent-delegate, fee, withdraw, scale, metadata-pointer); approve at the same threshold as other
treasury-affecting actions; re-approve on any change to the mint's authorities or extension set (off-chain
monitor). Cross-ref `references/methodologies/governance.md`.

---

## 5. Detection recipes

Concrete on-chain reads an auditor (or a static pass) runs against every accepted mint.

**Refuse hostile combinations at integration time:**

```rust
for ext in &extensions {
    match ext {
        ExtensionType::PermanentDelegate  => return Err(ErrorCode::MintHasPermanentDelegate.into()), // T4
        ExtensionType::NonTransferable    => return Err(ErrorCode::MintIsNonTransferable.into()),     // T5
        ExtensionType::DefaultAccountState => { /* allow but flag for freeze-tolerant handling */ }   // T5
        ExtensionType::TransferHook => {
            let hook = mint.get_extension::<TransferHook>()?;                                          // T2
            if !ALLOWLISTED_HOOKS.contains(&hook.program_id) {
                return Err(ErrorCode::HookNotAllowlisted.into());
            }
        }
        ExtensionType::ConfidentialTransferMint
        | ExtensionType::ConfidentialTransferFeeConfig
        | ExtensionType::ConfidentialMintBurn => { /* inspect auditor_pubkey; refuse non-zero unless accepted */ } // T8
        ExtensionType::Pausable => { /* record pause authority for governance review */ }              // T10
        _ => {}
    }
}
```

**Fee-aware deposit — read the destination delta, credit the delta (T1):**

```rust
let before = token_interface::accessor::amount(&ctx.accounts.vault.to_account_info())?;
token_interface::transfer_checked(cpi_ctx, amount, decimals)?;
ctx.accounts.vault.reload()?;                                   // MUST reload after the transfer CPI
let credited = ctx.accounts.vault.amount
    .checked_sub(before)
    .ok_or(ErrorCode::Underflow)?;
// use `credited`, NOT `amount`, for every share / balance / debt calculation
```

**Scaled / interest-bearing quoting — convert at the boundary, never cache (T7/T9):**

```rust
let raw = vault.amount;                                          // protocol accounting stays in raw units
let ui  = spl_token_2022::amount_to_ui_amount(raw, mint.decimals); // helper consults the CURRENT multiplier/rate
// do NOT persist `ui` across instructions; a multiplier/rate update invalidates it
```

```
grep -rn -E "\.amount\b|credited|balance_before|balance_after|reload" programs/   # is credit = post-transfer delta?
grep -rn -E "amount_to_ui_amount|ui_amount_to_amount|multiplier|interest_rate"   programs/   # boundary conversion, no cache?
grep -rn -E "auditor|elgamal|ZkE1Gama1Proof|proof_program"                       programs/   # confidential trust root pinned?
```

---

## 6. High-density surfaces (fastest findings)

- **S1 — Fee-blind accounting (T1).** Vault credits `amount` sent instead of the destination balance delta.
  **The single most-reported Token-2022 integration finding**, across deposit/withdraw in every category.
  Beyond `AV-062` (credit from vault delta): confirm the delta is read **after** a `.reload()` and used for
  *all* downstream share/debt math.
- **S2 — Transfer-hook reentrancy + injection (T2).** Hook calls back into the caller mid-transfer while the
  caller holds unflushed in-memory state; or the hook's extra accounts overlap the caller's in an unexpected
  way. Beyond `CPI-009` (validate program id of pass-through CPIs) and `KV-105`: the hook is an **untrusted
  program inside your CPI chain** — allowlist it and flush state before the transfer.
- **S3 — PermanentDelegate accepted at integration (T4).** Deposit succeeds; the delegate drains the vault
  later. Beyond `AV-063`/`AV-064`: the decision must live in the **allowlist**, and must also catch a
  **post-hoc** delegate set on a previously-clean allowlisted mint (re-validate on deposit).
- **S4 — Confidential-transfer ZK soundness + auditor key (T8).** The ZK ElGamal Proof Program is the trust
  root; Fiat-Shamir gaps were forgeable in 2025; a non-zero `auditor_pubkey` silently grants a third party
  decrypt over every transfer on the mint. Cross-ref `references/vuln-classes/zk-and-compression.md`; escalate
  to ZK specialists — not catchable by black-box testing.
- **S5 — ScaledUiAmount / InterestBearing display-vs-raw (T7/T9).** Especially in **oracle adapters** that
  read an on-chain balance and treat it as price-relevant, and in any flow that quotes in UI units but settles
  in raw. Beyond `AV-061` (decimals from mint, normalize before compare): the multiplier/rate is **mutable** —
  resolve at use-time, never cache.
- **S6 — Extension parse skip (T11).** A hand-rolled TLV walker advances past an unknown extension without
  honoring its length and mis-parses everything after it. Use `StateWithExtensions`.
- **S7 — Wrap / unwrap boundary.** For wrapped-asset bridges, extension preservation, fee accounting on the
  wrapped side, and hook re-invocation through the wrapper are the recurring bug cluster — test transfer-fee
  mints specifically. Cross-ref `references/methodologies/bridges.md` (B8).
- **S8 — Mint-close / metadata spoofing (T7).** A live `MintCloseAuthority` makes cached "mint exists /
  decimals = d" unsafe (mint-revival); a mutable metadata pointer makes cached `(name, symbol, uri)` stale.
  Re-read at use-time; validate the pointed account's owner program.

---

## 7. Per-instruction review worksheets

Each worksheet lists the safe shape. FAIL if any line is missing on any reachable path.

### Vault deposit (accepting a Token-2022 mint)
- The mint passed the **allowlist tier** (§4); its extension set was parsed with the official accessor (T11)
  and re-validated for a post-hoc `PermanentDelegate` / authority change (T4).
- Balance read **pre** transfer; `transfer_checked` with current decimals; `.reload()`; balance read **post**;
  **credit = post − pre** (T1). Refuse if the delta is zero or negative.
- Token program pinned via `Interface<TokenInterface>` + `token::token_program` (T6).
- If the mint is hook-bearing, the hook program id is allowlisted and `ExtraAccountMetaList` accounts are
  resolved correctly; caller state is flushed before the CPI (T2).

### Vault withdraw / transfer-out
- Pause/freeze/non-transferable state checked and surfaced cleanly if hit — no retry loop (T5).
- Output computed on the **raw** amount; UI conversion (if ScaledUi/InterestBearing) happens only at display,
  using the current multiplier/rate (T7/T9).
- `transfer_checked` with the mint's actual decimals (T7); token program pinned (T6).

### `transfer_checked` / `transfer_checked_with_fee` (any transfer)
- The `_checked` variant is used (asserts mint + decimals) — never the legacy unchecked `transfer` (T6/T7).
- Fee-aware accounting on the destination (T1). Hook accounts resolved; hook treated as untrusted (T2).

### Confidential-transfer / mint / burn paths
- Proofs verified by the **post-patch** ZK ElGamal Proof Program id (T8). The confidential balance is treated
  as opaque — no plaintext shadow ledger (T8). Pending balance flushed before reading available balance.
  `auditor_pubkey` disclosed and, if non-zero, explicitly accepted per policy. Escalate to ZK specialists.

### Mint-acceptance / allowlist registration
- Extension set read on-chain; each enabled extension mapped to the tier policy (§4); hostile combinations
  refused; every authority (mint/freeze/pause/permanent-delegate/fee/withdraw/scale/metadata) enumerated and
  its diversity assessed (T10). Governance approval recorded; re-approval wired to an authority/extension-set
  change monitor.

### Protocol-owned vault initialization
- `ImmutableOwner` enabled; `CpiGuard` explicitly enabled (`enable_cpi_guard`) — ATAs get ImmutableOwner by
  default but CpiGuard must be opted in (T3).

---

## 8. Test / PoC strategy

A Token-2022 integration is **not tested** if the suite uses only the bare SPL Token program. Minimum bar:

- **Extension-combination fuzz (T11, §3).** Generate mints across every **legal** combination from the matrix;
  run deposit/swap/withdraw for each; assert correct accounting in every case. Branch on the full tuple.
- **Differential transfer-fee tests (T1) — MANDATORY.** For a deposit of `x` at `y` bps, assert the vault
  credit equals `x − fee(x, y)` — across fee configs including 0, 1, and a high cap, plus a deposit→immediate
  withdraw round trip (the user must not silently double-fee). This is the highest-value negative test.
- **Transfer-hook smoke (T2).** Deploy a **no-op**, a **logging**, a **reverting**, and a **recursive** hook.
  Assert the protocol is correct or reverts **cleanly** for each; the recursive hook must produce a clean error,
  not undefined behavior; the reverting hook must not wedge the protocol.
- **PermanentDelegate refusal (T4).** Register a mint with a permanent delegate → **refused**. Allowlist a
  clean mint, then set its permanent delegate post-hoc and deposit → **detected/refused**.
- **Frozen / paused tolerance (T5).** Deposit into and withdraw from a frozen vault, transfer through a frozen
  intermediate, and pause the mint mid-transaction (validator-level) → each **surfaces cleanly** with the right
  error, never swallowed; resume → state consistent.
- **CpiGuard enforcement (T3).** Use a protocol vault as the authority for a CPI from an unrelated program →
  **blocked**; disabling CpiGuard is explicitly admin-gated.
- **Scaled / interest-bearing accounting (T7/T9).** Change the multiplier/rate after deposit, before withdraw →
  the protocol uses **raw** internally and the user-visible UI amount reflects the new multiplier **without**
  changing bookkeeping.
- **Wrap/unwrap parity (S7).** For wrapped-asset bridges, a wrap→unwrap round trip preserves balance, fee, and
  extension behavior — test transfer-fee mints specifically.
- **ZK escalation (T8).** For any ConfidentialTransfer/MintBurn/Balances integration, escalate the proof-program
  integration to formal verification / ZK-specialist review — the 2025 ElGamal soundness disclosures were **not**
  catchable by black-box testing. Cross-ref `references/vuln-classes/zk-and-compression.md`.

Prefer **LiteSVM** / **Mollusk** for fast deterministic per-extension unit tests; use **Surfpool** forked
mainnet to exercise **real** Token-2022 mints with their actual extension sets.

---

## 9. Permissioned tokens — Token ACL (SRFC-37) and gate programs

> **Load when (additional markers):** `token_acl` · `token-acl` · `TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP` ·
> `MINT_CFG` · `gating_program` · `thaw_permissionless` / `freeze_permissionless` (+ `_idempotent`) ·
> `can_thaw_permissionless` / `can_freeze_permissionless` · `thaw-extra-account-metas` · `srfc37` / `srfc-37`.

**What it is.** SRFC-37 (solana-foundation/token-acl, program `TACLkU6…`) makes a Token-2022 mint *permissioned*
without a transfer hook. The mint sets **`DefaultAccountState = Frozen`** (every new token account starts frozen)
and **delegates its freeze authority to the Token ACL program**. `create_config` writes a `MintConfig` PDA
(`[b"MINT_CFG", mint]`) holding `authority`, `gating_program`, `enable_permissionless_thaw`,
`enable_permissionless_freeze`. Anyone may then call `thaw_permissionless` / `freeze_permissionless` (and the
`_idempotent` variants): Token ACL CPIs into the configured **gate program** (`can_thaw_permissionless` /
`can_freeze_permissionless`, 8-byte discriminators derived from
`efficient-allow-block-list-standard:can-…-permissionless`) with
`[caller, token_account, mint, token_account_owner, flag_account, extra_account_metas]` plus the extra accounts
resolved from `[b"thaw-extra-account-metas", mint]` / `[b"freeze-extra-account-metas", mint]`. Gate **success ⇒**
Token ACL thaws / freezes with its delegated authority; gate **error ⇒** blocked. The issuer keeps authority-signed
`thaw` / `freeze`, `set_authority`, `set_gating_program`, `forfeit_freeze_authority`. A **flag account**
(0 lamports, data `[1]`, owned by Token ACL) is passed so the gate can prove it is being invoked *by Token ACL in
a permissionless context*, and Token ACL **de-escalates** the CPI (no signer / writable privilege of the caller
is forwarded) so a hostile gate cannot use the call for anything else.

**Why it matters downstream.** Composability changes shape: a transfer to any *fresh* token account fails until
that account is thawed, the gate — not the mint — decides *who may hold*, and whoever controls the gate (or
`set_gating_program`) holds the equivalent of the freeze authority. Three audit roles apply: the **gate author**,
the **issuer** who configures the mint, and the **downstream integrator** (vault / AMM / lending / wallet).

### 9.1 Gate program (author) — safe shape

| # | Check | Failure mode |
|---|-------|--------------|
| **G1** | The gate asserts `flag_account.owner == TOKEN_ACL_PROGRAM_ID`, `data == [1]` (and 0 lamports) before trusting the context. A gate with *any* side effect (one-time allowance consumed, counter, fee, event an indexer trusts) must only apply it under a verified flag. | Anyone calls `can_thaw_permissionless` directly with a forged flag and burns allowances / spoofs events |
| **G2** | Thaw and freeze semantics are **consistent and inverse**: allow-list ⇒ `can_thaw` passes only allowlisted owners **and** `can_freeze` passes only *non*-allowlisted; block-list ⇒ `can_thaw` fails blocklisted **and** `can_freeze` passes only blocklisted. | Inverted / missing freeze rule ⇒ **anyone freezes any legitimate holder permissionlessly** (griefing DoS) or a blocklisted owner keeps a thawed account |
| **G3** | Identity is **re-derived from the token account**: `token_account.owner == token_account_owner` and `token_account.mint == mint` are checked by the gate itself (unpack with `StateWithExtensions<Account>`), not trusted from the passed pubkey. | Attacker passes an allowlisted pubkey as `token_account_owner` for a token account they own ⇒ unauthorized thaw |
| **G4** | Extra accounts (allowlist / blocklist entry PDAs, config) are validated as **canonical PDAs** — seeds from `(mint, owner)` under the gate program, owner program checked, discriminator checked (cross-ref T2, KV-010, KV-026). The extra-account-metas PDA is populated by the author (SRFC-37 ships no interface instruction for it) and is itself authority-gated. | Forged "allowlist entry" account passed in `remaining_accounts` ⇒ thaw for anyone |
| **G5** | `can_*` handlers are **read-only / idempotent** and demand no signer or writable privilege from `caller` (Token ACL de-escalates; a gate that requires them fails for everyone). | Spam through Token ACL mutates gate state; or the gate is unusable |
| **G6** | Gate list-admin authority and gate **upgrade authority** are treated as freeze-authority-equivalent — multisig / timelocked, enumerated in the mint authority-diversity review (T10). | One key un-permissions or bricks the token |

### 9.2 Issuer configuration — safe shape

- **I1** The mint really is ACL-gated: `DefaultAccountState = Frozen` **and** the mint's freeze authority is the
  Token ACL PDA — an ACL `MintConfig` next to a freeze authority held elsewhere is decorative.
- **I2** `gating_program` is non-default and matches the audited gate; the tuple
  (`gating_program == default`, `enable_permissionless_thaw == true`) is understood — with no gate the token is
  effectively *permissionless* for thaw.
- **I3** `set_gating_program`, `set_authority`, `forfeit_freeze_authority` are governance-gated and **monitored**:
  swapping the gate to an `always-allow` implementation silently removes the permission layer; `forfeit`
  returns raw freeze authority to the issuer key.
- **I4** Enforcement liveness for block-lists: a thawed account stays thawed until someone calls
  `freeze_permissionless` — the issuer runs (or relies on a public) keeper that freezes newly blocklisted
  holders; otherwise the list is advisory.

### 9.3 Downstream integrator — safe shape

- **D1** Every **protocol-owned** account of an ACL mint (vault, escrow, fee, LP-side ATA) starts *frozen*. The
  initialization / first-deposit path thaws it (`thaw_permissionless_idempotent`) **or** the protocol PDA is on
  the issuer's allowlist — and that allowlist status is a tracked config item with a monitor. A protocol PDA the
  gate refuses is a permanent deposit failure (T5).
- **D2** Paths that create a **recipient** token account in the same transaction (swap output ATA, liquidation
  payout, claim, airdrop) include an idempotent thaw for it, and surface a clean error when the recipient is not
  permitted — a liquidator or claimant who cannot be thawed must not wedge the protocol (bad-debt liveness,
  cross-ref `lending.md`).
- **D3** **Re-freeze mid-flight is reachable by anyone** once the gate says an owner should be frozen — including
  the protocol's own vault if the protocol PDA is blocklisted. Handle as T5 (surface, never retry-loop) and
  treat the issuer's gate policy as a trust assumption in the mint allowlist (§4 tier decision).
- **D4** `MintConfig` changes (gate swap, authority change, forfeit) are **mint-authority-level events** for the
  integrator's monitor; the integrator never hardcodes assumptions about the gate's policy.
- **D5** When the integrator CPIs Token ACL, the program id is pinned (`TACLkU6…`) and `MintConfig` is derived
  `[b"MINT_CFG", mint]` under it (KV-009 / KV-010).

```
grep -rn -E "token_acl|token-acl|TACLkU6|MINT_CFG|gating_program|thaw_permissionless|freeze_permissionless|can_thaw_permissionless|can_freeze_permissionless|extra-account-metas" programs/ apps/ packages/
grep -rn -E "DefaultAccountState|default_account_state|AccountState::Frozen" programs/
```

### 9.4 Test strategy

- **Gate semantics.** Allow-list: non-allowlisted thaw → fails; allowlisted → succeeds; stranger freezes an
  allowlisted holder → **fails**; freeze after removal → succeeds. Block-list: the inverse. Both directions
  tested, not just thaw (G2).
- **Context spoof.** Call `can_thaw_permissionless` directly with a fake flag account → rejected / no side
  effect (G1). Pass an allowlisted pubkey with a token account owned by someone else → rejected (G3). Pass a
  forged allowlist-entry account → rejected (G4).
- **Integrator liveness.** First deposit into a fresh vault; swap that creates the output ATA; liquidation to a
  non-allowlisted liquidator — each either succeeds via idempotent thaw or surfaces a clean, non-wedging error
  (D1 / D2). Blocklist the protocol PDA on a fork and confirm the failure is surfaced, not looped (D3).
- **Governance drills.** `set_gating_program` → `always-allow` and `forfeit_freeze_authority` on a fork; the
  monitor alerts and the integrator's allowlist review re-opens (I3 / D4).

Use **Surfpool** with the mainnet Token ACL program and the reference `token-acl-gate` for realistic fixtures;
**LiteSVM / Mollusk** for gate unit tests with hand-built flag / extra-meta accounts.

---

## Token-2022 integration checklist (fast pass)

- [ ] Extension set parsed with the official `StateWithExtensions` accessor; branching is on the full tuple, not one flag (T11)
- [ ] Vault credit = post-transfer destination delta (after `.reload()`), never the `amount` arg — fee-aware (T1)
- [ ] Transfer hooks allowlisted + treated as untrusted CPI; extra accounts validated; caller state flushed pre-transfer; recursion impossible (T2)
- [ ] Every protocol-owned vault has `CpiGuard` + `ImmutableOwner` enabled (T3)
- [ ] PermanentDelegate rejected at custody time in the allowlist; post-hoc delegate re-validated on deposit (T4)
- [ ] Freeze / pause / non-transferable states surfaced cleanly — no swallow, no retry loop (T5)
- [ ] Token program pinned via `Interface<TokenInterface>` + `token::token_program`; never assumed (T6)
- [ ] Decimals read from the mint; ScaledUi/InterestBearing multiplier/rate resolved at use-time, never cached (T7)
- [ ] Confidential balances opaque; post-patch ZK ElGamal Proof Program id validated; `auditor_pubkey` disclosed (T8)
- [ ] Single accounting layer (raw internally); never quote-UI-settle-raw (T9)
- [ ] Authority diversity audited per accepted mint; group membership gated on `(group_id, group_authority)` (T10)
- [ ] Mint-allowlist tier chosen (0 reject … 3 full) and on-chain enforced; governance approval + change-monitor wired (§4)
- [ ] Extension-combination fuzz + differential fee tests + hook smoke (no-op/logging/reverting/recursive) pass (§8)
- [ ] Token ACL (SRFC-37) mints: `DefaultAccountState=Frozen` + freeze authority held by the Token ACL PDA; `gating_program` non-default; `set_gating_program` / `set_authority` / `forfeit` governance-gated and monitored (§9 I1–I4)
- [ ] Gate program verifies the flag account, re-derives owner / mint from the token account, validates extra-account-meta PDAs, is side-effect-free, and implements thaw / freeze as exact inverses; protocol-owned accounts have a proven thaw path and swap / liquidation / claim paths thaw idempotently (§9 G1–G5, D1–D3, T12)

*Public incidents referenced: ZK ElGamal Proof Program soundness disclosures (2025, whitehat — Fiat-Shamir
transcripts omitting public values, enabling forged proofs on the confidential-transfer path). Token-2022
extension semantics, the coexistence matrix, and the fee/hook/confidential mechanics are public program
documentation. Cross-refs: `AV-058`/`AV-060`/`AV-061` (token-program pinning, `_checked` variants, decimals
from mint), `AV-062` (credit from vault delta), `AV-063`/`AV-064`/`AV-066` (extension inspection, clawback/
freeze rejection, mint allowlist), `CPI-009` (validate pass-through CPI program id), `KV-105` (Token-2022
extension footguns), `references/vuln-classes/zk-and-compression.md` (confidential-transfer ZK soundness),
`references/methodologies/bridges.md` (B8 wrap/unwrap fee accounting), `references/methodologies/governance.md`
(mint-allowlist approval), `KV-134` (Token ACL gate bypass / permissionless-freeze griefing; SRFC-37 spec and
reference gates in solana-foundation/token-acl).*
