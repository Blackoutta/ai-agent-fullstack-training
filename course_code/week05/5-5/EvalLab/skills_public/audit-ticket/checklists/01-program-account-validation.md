# 01 — Account Validation Checklist

> Domain: On-chain Solana Program  
> Severity if missed: CRITICAL to HIGH  
> References: Neodyme "Missing Ownership Check", Sealevel Attacks, Anchor Account Constraints

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

> **Feature-gated sections (advisory load).** The three sub-sections below are feature-specific: if the feature is *provably absent* (empty prescan array or zero grep hits — see `references/orchestration/pre-scan.md`), you may spot-defer the section and render its items `[N/A — feature absent: <marker>]`. Token-efficiency layer only — **every item still gets a verdict per Rule 0**, and the section reopens the instant a manual read surfaces the feature.
>
> | Section | Feature | Markers |
> |---------|---------|---------|
> | §1.8 SPL Token & Token-2022 Extension Safety | Token-2022 extensions | `token_2022` · `spl_token_2022` · `transfer_hook` · `TransferFee` · `get_extension` · `PermanentDelegate` |
> | §1.9 Sysvar & Precompile Account Safety | sysvar / precompile use | `sysvar` · `instructions_sysvar` · `ed25519` · `secp256k1` · `load_instruction_at` |
> | §1.10 Native / Pinocchio (No-Anchor) Program Safety | native / Pinocchio program | `pinocchio` · `p-token` · `no_std` · manual `AccountInfo` validation (absent when Anchor detected) |
>
> §1.1–1.7 and §1.11–1.12 are baseline account safety — evaluated for every on-chain program.

---

## 1.1 — Account Ownership Checks

- [ ] **AV-001**: Every account deserialized from `AccountInfo` has its `owner` field validated against the expected program ID
- [ ] **AV-002**: No account in `#[derive(Accounts)]` uses raw `AccountInfo<'info>` (deprecated in Anchor 1.0) — must use `UncheckedAccount<'info>` or typed `Account<'info, T>`
- [ ] **AV-003**: Every `UncheckedAccount<'info>` has a `/// CHECK:` doc comment that describes the ACTUAL runtime validation performed (not just "safe because...")
- [ ] **AV-004**: Every `/// CHECK:` comment corresponds to real code — grep for the validation logic referenced in the comment
- [ ] **AV-005**: Accounts typed as `Account<'info, T>` automatically check owner + discriminator — verify T matches the expected state struct
- [ ] **AV-006**: Token accounts use `Account<'info, TokenAccount>` or `InterfaceAccount<'info, TokenAccount>` — never raw `AccountInfo`
- [ ] **AV-007**: Mint accounts use `Account<'info, Mint>` — never raw `AccountInfo`
- [ ] **AV-008**: System program, token program, rent sysvar are typed with `Program<'info, System>`, `Program<'info, Token>`, `Sysvar<'info, Rent>` — not `AccountInfo`
- [ ] **AV-009**: No account marked as `Account<'info, T>` where T is a different program's state struct without explicit owner override
- [ ] **AV-010**: The program ID declared in `declare_id!()` matches the deployed program ID and the keypair file

## 1.2 — Account Discriminator & Type Cosplay

- [ ] **AV-011**: Every on-chain account uses Anchor's 8-byte discriminator (automatic with `#[account]` macro) — check no manual serialization bypasses it
- [ ] **AV-012**: No instruction accepts an account typed as struct A where struct B has the same memory layout prefix (type cosplay attack)
- [ ] **AV-013**: If `remaining_accounts` are deserialized manually, verify discriminator is checked (e.g., `AccountDeserialize::try_deserialize()`)
- [ ] **AV-014**: If `remaining_accounts` are deserialized, verify the account address matches the expected PDA derivation — **discriminator checks alone are insufficient**
- [ ] **AV-015**: No account struct reuses the first 8 bytes of another account struct's discriminator (collision check)
- [ ] **AV-016**: Account structs use `#[account]` attribute (not manual `BorshSerialize`/`BorshDeserialize` without discriminator)
- [ ] **AV-017**: If accounts are migrated between versions, old discriminators cannot be confused with new ones

## 1.3 — Account Constraint Validation (Anchor `#[account(...)]`)

- [ ] **AV-018**: Every account that should be mutable is marked `#[account(mut)]`
- [ ] **AV-019**: No account is marked `#[account(mut)]` when it should be read-only (unnecessary mutability)
- [ ] **AV-020**: `has_one = field` constraints are used on accounts that reference other accounts (e.g., `has_one = manager`, `has_one = fund`)
- [ ] **AV-021**: `has_one` constraints are ALSO backed by runtime `require_keys_eq!` checks (defense-in-depth)
- [ ] **AV-022**: `init` accounts use `payer`, `space`, and `seeds` + `bump` correctly
- [ ] **AV-023**: `init_if_needed` is NOT used unless explicitly required — it opens reinitialization vectors
- [ ] **AV-024**: If `init_if_needed` IS used, there is a guard against reinitialization (e.g., checking a version/initialized flag)
- [ ] **AV-025**: `close = destination` constraints send lamports to the correct recipient — check destination is constrained
- [ ] **AV-026**: Closed accounts have their data zeroed (Anchor does this automatically with `close`, verify no manual close bypasses it)
- [ ] **AV-027**: `seeds` constraints use all necessary seed components (prevent PDA collision across different entities)
- [ ] **AV-028**: `bump` values are stored in state and reused (`bump = account.bump`) — not re-derived every time
- [ ] **AV-029**: `constraint = <expr>` custom constraints use proper error types, not generic `ConstraintRaw`
- [ ] **AV-030**: `realloc` constraints include `realloc::payer` and `realloc::zero` appropriately
- [ ] **AV-031**: No duplicate mutable accounts without explicit `#[account(mut, dup)]` opt-in (Anchor 1.0 rejects by default)

## 1.4 — Remaining Accounts Validation

- [ ] **AV-032**: All `remaining_accounts` are iterated and validated before use — no blind pass-through
- [ ] **AV-033**: For each remaining account, owner is verified (`account.owner == expected_program`)
- [ ] **AV-034**: For each remaining account used as a token account, mint and authority are verified
- [ ] **AV-035**: For each remaining account used as a PDA, the address is re-derived and compared
- [ ] **AV-036**: The count of remaining_accounts is validated (not more or fewer than expected)
- [ ] **AV-037**: Remaining accounts passed to external CPI (e.g., Jupiter) are at minimum program-ownership validated
- [ ] **AV-038**: No remaining account can be the same as a named account in the struct (duplicate account confusion)
- [ ] **AV-039**: If remaining accounts represent investor positions, each position's fund field matches the current fund

## 1.5 — Account Size & Rent

- [ ] **AV-040**: All `init` accounts allocate sufficient `space` — calculate manually: 8 (discriminator) + each field size
- [ ] **AV-041**: No account can be created with less than rent-exempt minimum lamports
- [ ] **AV-042**: Variable-length fields (Vec, String) in account structs have a maximum length enforced
- [ ] **AV-043**: `realloc` operations check the new size doesn't exceed the maximum allowed account size (10 MB)
- [ ] **AV-044**: No instruction allows reducing account size below the minimum required for its data

## 1.6 — Token Account Validation

- [ ] **AV-045**: Every token account used in transfers has its `mint` field validated against expected mint
- [ ] **AV-046**: Every token account used in transfers has its `owner`/`authority` field validated
- [ ] **AV-047**: Vault token accounts are verified as owned by the expected PDA (fund PDA)
- [ ] **AV-048**: Associated Token Accounts are derived correctly — `getAssociatedTokenAddressSync` or `associated_token::` seed derivation
- [ ] **AV-049**: Token accounts with `delegate` field — verify delegate authorization before using delegated_amount
- [ ] **AV-050**: Token accounts are checked for `frozen` state if freeze authority exists
- [ ] **AV-051**: WSOL (wrapped SOL) accounts use the correct native mint address (`So11111111111111111111111111111111111111112`)
- [ ] **AV-052**: Token-2022 accounts are not confused with original Token Program accounts (different program IDs)

## 1.7 — Reinitialization Protection

- [ ] **AV-053**: No instruction can re-initialize an already-initialized account (check `init` vs `init_if_needed`)
- [ ] **AV-054**: If manual initialization is used (not Anchor `init`), an `is_initialized` flag is checked
- [ ] **AV-055**: After account closure, the same PDA seeds cannot be re-derived to create a new account with stale associations
- [ ] **AV-056**: Revival attack: after `close`, can an attacker send lamports to the closed account address to prevent garbage collection and re-use stale data? (see KV-106)
- [ ] **AV-057**: If an account is closed mid-transaction, subsequent instructions in the same transaction cannot access stale data from that account

## 1.8 — SPL Token & Token-2022 Extension Safety

- [ ] **AV-058**: Token program is identified correctly per account — classic `Token` vs `Token-2022` (`token_program` is constrained, not assumed); `InterfaceAccount`/`token_interface` used when both must be supported
- [ ] **AV-059**: Associated Token Accounts are enforced via Anchor `associated_token::mint`, `associated_token::authority` (+ `associated_token::token_program`) — not a bare `Account<TokenAccount>` where the canonical ATA is assumed (see KV-107)
- [ ] **AV-060**: Token transfers use `transfer_checked` / `mint_to_checked` / `burn_checked` (decimals + mint bound at runtime), not the unchecked legacy variants
- [ ] **AV-061**: Token `decimals` are read from the mint account, never hardcoded; cross-mint amounts are normalized before being added or compared (see KV-108)
- [ ] **AV-062**: Credited amounts are computed from vault balance deltas (after − before), so transfer-fee / fee-on-transfer tokens cannot over- or under-credit (see KV-018, KV-105)
- [ ] **AV-063**: If arbitrary mints are accepted, the program inspects Token-2022 mint extensions and rejects (or explicitly handles) `PermanentDelegate`, `DefaultAccountState::Frozen`, `MintCloseAuthority`, transfer-hook, confidential-transfer, and interest-bearing configs (see KV-105, KV-023)
- [ ] **AV-064**: Custodied/vault token balances are not exposed to clawback or freeze by an untrusted mint authority (permanent delegate / freeze authority risk is checked or the mint is allowlisted)
- [ ] **AV-065**: Mint `freeze_authority` and `mint_authority` status is considered for accepted tokens — frozen accounts cannot deadlock withdrawals (see AV-050, KV-019)
- [ ] **AV-066**: A mint allowlist (or explicit per-mint vetting) exists wherever the protocol cannot safely handle every possible mint/extension combination
- [ ] **AV-067**: Token account `close_authority`/`delegate` fields are validated — no unexpected delegate can move vault funds, and close authority cannot be weaponized

## 1.9 — Sysvar & Precompile Account Safety

- [ ] **AV-068**: Clock/Rent/epoch data is obtained via syscalls (`Clock::get()`, `Rent::get()`) — not read from a passed-in account whose contents an attacker controls (see KV-101)
- [ ] **AV-069**: Any sysvar passed as an account is typed `Sysvar<'info, T>` (or its address is asserted equal to the canonical sysvar ID) — never an unchecked `AccountInfo`/`UncheckedAccount`
- [ ] **AV-070**: Time-gated logic (cooldowns, vesting, auctions, oracle staleness windows) cannot be bypassed by a forged Clock account
- [ ] **AV-071**: If signatures are verified via Instructions-sysvar introspection, the precompile program ID (`ed25519_program` / `secp256k1_program`) is asserted (see KV-102)
- [ ] **AV-072**: Introspection-based signature checks bind the exact pubkey, full message, and signature offsets to the current action — not merely "a precompile instruction exists"
- [ ] **AV-073**: Introspected signed messages include a nonce/expiry/slot tied to state so they cannot be replayed across transactions or accounts
- [ ] **AV-074**: Instruction index used in introspection is computed safely (relative or validated) — no fixed-index assumption an attacker can shift by inserting instructions
- [ ] **AV-075**: Privileged accounts (treasury/authority/config) are bound via `has_one` / `seeds` / `address` / `require_keys_eq!` and never trusted by transaction position or ALT-resolved order (see KV-103)
- [ ] **AV-076**: PDA bumps are canonical (`find_program_address` / Anchor canonical bump), stored in state, and reused — no user-supplied bump is fed to `create_program_address` (see KV-104)
- [ ] **AV-089**: No `require!` / branch reads `ComputeBudgetProgram` instructions from the Instructions sysvar (priority-fee floor, CU-limit floor, "budget instruction must be first / only other instruction") — under transaction v1 those instructions are no-ops and the real config lives in the message header, which no sysvar or syscall exposes; such a gate is silently unenforced or rejects every v1 user (see KV-135)
- [ ] **AV-090**: Instruction-introspection loops and positional / count assumptions (`load_instruction_at`, `get_instruction_relative`, "exactly N instructions", `remaining_accounts.len() <= N`) are correct for up to 64 instructions and 64 inline accounts (v1 caps), tolerate the presence of no-op ComputeBudget instructions, and do not rely on address-lookup-table resolution (v1 has none — see KV-103, `references/vuln-classes/transaction-v1.md` V5)

## 1.10 — Native / Pinocchio (No-Anchor) Program Safety

> Applies to native, zero-copy, or **Pinocchio**-based programs (incl. **p-token**). Anchor provides owner/discriminator/signer/mut checks automatically; native programs do NOT — each must be verified by hand. (see KV-109)

- [ ] **AV-077**: Detect the framework — if the program is native/Pinocchio (`entrypoint!`, `no_std`, `pinocchio*` deps) rather than Anchor, every guarantee below is manual and must be individually confirmed
- [ ] **AV-078**: Every account that is deserialized or trusted has its `owner` explicitly verified against the expected program ID (no Anchor `Account<T>` auto-check exists here)
- [ ] **AV-079**: Signer authority is asserted via an explicit `is_signer` check on every value-moving / privileged account; mutated accounts assert `is_writable`
- [ ] **AV-080**: The number of passed accounts is validated, and every zero-copy byte-slice read is bounds-checked (`data.len() >= N`) before indexing — no fixed-index access or unchecked slice that can panic / read out of bounds
- [ ] **AV-081**: All `unsafe` blocks (raw pointer arithmetic, `from_raw_parts`, `get_unchecked`) are preceded by an explicit length/alignment guard — no undefined behavior on malformed input
- [ ] **AV-082**: Account type is disambiguated by owner + length + explicit tag — single-byte (or absent) discriminators cannot be confused with another account of similar layout (type cosplay)
- [ ] **AV-083**: If the Pinocchio `unsafe-account-resize` feature is used, the program itself validates the new size stays within permitted bounds (the framework does not)
- [ ] **AV-084**: For p-token / reimplemented SPL Token logic: behavior matches canonical SPL Token on edge cases (zero-amount, frozen account, multisig M-of-N parsing, `transfer_checked` decimals, immutable owner, exact error codes) — no CU optimization dropped a required check (ideally differential-tested against `spl-token`)

## 1.11 — Lamport Donation & Runtime-Level Account Safety

> Lamports can be transferred into any account permissionlessly, and feature-gate activations can demote a writable builtin/sysvar to read-only. Instructions must not assume they control an account's exact balance or writability. (see KV-123)

- [ ] **AV-085**: No instruction assumes an **exact** lamport balance on any account an attacker can donate into (use `>=` sufficiency checks, not `==`) — a donated balance must not force a runtime-rejected RentState transition that permanently bricks the instruction (rent-state bricking / "king-of-the-SOL", see KV-123)
- [ ] **AV-086**: No instruction requires **write access** to a builtin/sysvar/precompile account (or any account it does not actually modify) that a feature-gate may demote to read-only — an unnecessary `#[account(mut)]` on such an account breaks the instruction on demotion (see KV-123)

## 1.12 — Account Pre-Creation DoS & Unsafe Deserialization

> Two distinct integrity gaps observed repeatedly in real reports: (a) an honest `init` that an attacker can front-run by pre-creating the target account, and (b) `unsafe` deserialization that reads uninitialized or out-of-bounds memory. Both differ from the reinitialization angle in AV-023/024 — here the account either already exists (griefing) or its bytes were never fully initialized/validated.

- [ ] **AV-087**: Any instruction that `init`s a user-derivable account (especially an ATA) tolerates the account already existing — via `init_if_needed` plus explicit state validation, or by handling the pre-existing case — so an attacker cannot front-run the account's creation and permanently revert the honest instruction (permissionless pre-creation DoS, distinct from reinit; see KV-127)
- [ ] **AV-088**: `unsafe` deserialization on-chain (`Vec::set_len`, `MaybeUninit::assume_init`, manual/zero-copy flat-slab or `memmove`-based decoders) fully initializes and bounds-checks every byte before it is read — no read-past-initialized memory, no under-length `memmove`, no state corruption from malformed input (cross-ref checklist 20 §20.2)
