# 04 — CPI & PDA Safety Checklist

> Domain: On-chain Solana Program  
> Severity if missed: CRITICAL  
> References: Neodyme "Arbitrary Signed Program Invocation", Sealevel Attacks, QEDGen CPI properties

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 4.1 — CPI Target Validation

- [ ] **CPI-001**: Every `CpiContext::new()` first argument is a `Pubkey` (Anchor 1.0), NOT `.to_account_info()` (Anchor 0.x pattern)
- [ ] **CPI-002**: Every `CpiContext::new_with_signer()` first argument is a `Pubkey` (Anchor 1.0)
- [ ] **CPI-003**: Every CPI to SPL Token Program — the token_program account is validated as `spl_token::ID` or `Program<'info, Token>`
- [ ] **CPI-004**: Every CPI to System Program — the system_program account is validated as `system_program::ID` or `Program<'info, System>`
- [ ] **CPI-005**: Every CPI to Associated Token Program — validated as `associated_token::ID` or typed `Program<'info, AssociatedToken>`
- [ ] **CPI-006**: Every CPI to a DEX aggregator (Jupiter, etc.) — program ID is validated via `require_keys_eq!` against hardcoded known ID
- [ ] **CPI-007**: Every CPI to Metaplex — program ID validated against hardcoded `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`
- [ ] **CPI-008**: No CPI uses an `UncheckedAccount` as the program to invoke — the program account MUST be validated
- [ ] **CPI-009**: If remaining_accounts are passed through to a CPI, the target program ID is still validated
- [ ] **CPI-010**: For `invoke_signed` (raw Solana CPI), the program_id in the Instruction is validated before invocation

## 4.2 — CPI Parameter Validation

- [ ] **CPI-011**: `token::transfer` CPI — `from` account is the expected source (vault or user account)
- [ ] **CPI-012**: `token::transfer` CPI — `to` account is the expected destination (not attacker-controlled)
- [ ] **CPI-013**: `token::transfer` CPI — `authority` is the correct PDA or signer
- [ ] **CPI-014**: `token::transfer` CPI — `amount` is calculated correctly and matches expected value
- [ ] **CPI-015**: `token::mint_to` CPI — `mint` is the fund's shares mint (not an attacker-supplied mint)
- [ ] **CPI-016**: `token::mint_to` CPI — `to` is the investor's correct token account
- [ ] **CPI-017**: `token::mint_to` CPI — `authority` is the fund PDA (mint authority)
- [ ] **CPI-018**: `token::mint_to` CPI — `amount` matches calculated shares (not attacker-controlled)
- [ ] **CPI-019**: `token::burn` CPI — `from` is the investor's token account with their shares
- [ ] **CPI-020**: `token::burn` CPI — `authority` is the investor (they authorized the burn)
- [ ] **CPI-021**: `token::burn` CPI — `amount` matches the intended burn amount
- [ ] **CPI-022**: `token::close_account` CPI — `destination` is constrained to known recipients (fund PDA, investor, or treasury)
- [ ] **CPI-023**: `token::close_account` CPI — `authority` is the correct entity
- [ ] **CPI-024**: `token::close_account` CPI — the closed account is NOT the main vault (catastrophic if vault is closed)
- [ ] **CPI-025**: `system_program::transfer` CPI — source and destination are validated
- [ ] **CPI-026**: `token::approve` CPI — delegate and amount are validated, not granting unlimited approval
- [ ] **CPI-027**: `token::revoke` CPI — actually revokes the correct delegation

## 4.3 — PDA Derivation Safety

- [ ] **PDA-001**: Every PDA is derived using all required seed components — no missing seeds that could cause collision
- [ ] **PDA-002**: Fund PDA seeds: `[b"fund", manager.key(), name.as_bytes()]` — verify all three present
- [ ] **PDA-003**: For each PDA in the program, list its seeds and verify all present in derivation
- [ ] **PDA-004**: Verify PDA seed order is consistent between `init` and all subsequent references
- [ ] **PDA-005**: Vault/treasury PDA seeds include parent account key — verify present
- [ ] **PDA-006**: Mint PDA seeds include parent account key — verify present
- [ ] **PDA-007**: Attestation/oracle PDA seeds include parent account key — verify present
- [ ] **PDA-008**: Access-control PDA seeds (whitelist, role, permission) include parent account key — verify present
- [ ] **PDA-009**: All custom PDAs above — verify seeds match in both derivation and usage (no mismatch between init and later references)
- [ ] **PDA-010**: Bump seeds are stored on first derivation and reused — not re-derived each time (saves compute + prevents bump mismatch)
- [ ] **PDA-011**: No PDA seed uses user-controlled variable-length data without length prefix (could cause seed collision)
- [ ] **PDA-012**: Fund name in PDA seeds — is there a max length? Can two funds have names that collide after truncation?
- [ ] **PDA-013**: PDA seeds do not include mutable state that could change (would orphan the PDA)

## 4.4 — invoke_signed Safety

- [ ] **PDA-014**: Every `invoke_signed` call uses the correct signer seeds for the PDA authority
- [ ] **PDA-015**: Signer seeds array matches the PDA derivation exactly (same order, same components)
- [ ] **PDA-016**: Bump seed in `invoke_signed` matches the stored bump (not a different bump)
- [ ] **PDA-017**: `invoke_signed` is used (not bare `invoke`) when PDA is the authority — `invoke` with PDA authority will fail silently or be exploitable
- [ ] **PDA-018**: No instruction uses `invoke` where it should use `invoke_signed` (missing PDA signing)
- [ ] **PDA-019**: The instruction data passed to `invoke_signed` cannot be manipulated by the caller to change the operation
- [ ] **PDA-020**: For Jupiter CPI, the instruction data is either fully constructed by the program or validated
- [ ] **PDA-021**: `realloc` safety — grown bytes are zero-initialized AND the rent for the added space is not funded by the program/vault at an attacker-chosen size. Two sub-checks: **(a)** any `realloc(new_len, false)` (or `AccountInfo::realloc(_, false)`) that *grows* an account leaves the newly-added bytes NON-zeroed, so stale or attacker-influenced heap contents are later read as valid state — grows must zero-init the new region (`realloc(new_len, true)`, Anchor `realloc::zero = true` on a grow-after-shrink, or an explicit `data[old_len..new_len].fill(0)`); **(b)** the `realloc` target length is attacker-controlled AND the added rent is paid by the program or a program-owned vault (`realloc::payer = <program PDA / vault>`) rather than by the requester — an attacker repeatedly grows accounts to drain the vault's rent reserve. (PASS: every grow zero-inits the new bytes, and `realloc::payer`/the lamport top-up is the *requester*, with the size bounded by a `MAX_LEN` constant; FAIL: a `false`/non-zeroing grow whose new bytes are later deserialized, or a program/vault-funded realloc at a caller-chosen size — rent-exhaustion drain. Grep: `grep -rn --include="*.rs" -iE "realloc\(" programs/`)

## 4.5 — External CPI Safety (Jupiter, Metaplex, etc.)

- [ ] **EXT-001**: Jupiter swap CPI — the fund PDA is the authority (signed with invoke_signed)
- [ ] **EXT-002**: Jupiter swap CPI — slippage is enforced (either by Jupiter's internal mechanism or by post-CPI balance check)
- [ ] **EXT-003**: Jupiter swap CPI — returned token account belongs to the fund PDA
- [ ] **EXT-004**: Jupiter swap CPI — remaining_accounts are passed correctly
- [ ] **EXT-005**: After Jupiter CPI — verify fund balances changed as expected (post-condition check)
- [ ] **EXT-006**: Jupiter program ID is validated against known address each time
- [ ] **EXT-007**: Metaplex CPI (if used) — metadata account derived correctly
- [ ] **EXT-008**: Metaplex CPI (if used) — program ID validated
- [ ] **EXT-009**: Protocol CPI (whitelisted programs) — program is in the whitelist before invocation
- [ ] **EXT-010**: Protocol CPI — whitelist is owned by the program and linked to the fund
- [ ] **EXT-011**: No CPI allows the called program to callback into this program with escalated privileges

### Token-2022 / Extensions

> Grep hints:
> ```
> grep -rn --include="*.rs" -iE "transfer_hook|TransferHook|permanent_delegate|PermanentDelegate|freeze_authority|FreezeAuthority|close_authority|MintCloseAuthority|get_extension|transfer_checked|remaining_accounts" programs/
> ```

- [ ] **EXT-012**: If a custodied mint carries a `TransferHook` extension — is the hook program checked against an allowlist AND are its required `remaining_accounts` resolved and forwarded on every `transfer_checked` CPI? (PASS: hook program allowlisted + extra accounts resolved via `spl_transfer_hook_interface` and appended to the CPI; FAIL: hook program unvalidated (arbitrary CPI target) or `remaining_accounts` omitted so the transfer reverts / silently fails. (adapted from safe-solana-builder shared-base §23.1))
- [ ] **EXT-013**: Are custodied mints inspected for `PermanentDelegate`, uncontrolled `FreezeAuthority`, and `MintCloseAuthority`, and rejected unless the mint is on a trusted allowlist? (PASS: `get_extension::<...>()` read at init/registration; `PermanentDelegate` (vault clawback), external `FreezeAuthority` (withdrawal DoS), and `MintCloseAuthority` (address recycle) all rejected or the mint is explicitly trusted; FAIL: extensions never read — a hostile mint authority can seize, freeze, or recycle the vault. (adapted from safe-solana-builder shared-base §23.1))
- [ ] **EXT-014**: Does ALL token movement use `transfer_checked` (mint + decimals supplied) and credit accounting via a balance delta (`vault.amount` AFTER `reload()` − BEFORE) rather than the declared `amount`? (PASS: `transfer_checked` + delta-based credit with checked_sub, so transfer-fee mints are accounted correctly; FAIL: legacy `token::transfer` (breaks on Token-2022) or credits the requested `amount` ignoring the fee. (adapted from safe-solana-builder shared-base §21.6 / §23.1))
- [ ] **EXT-015**: If the program creates a mint, does it claim/initialize that mint's Metaplex (or Token-2022) metadata **atomically at init**, with update authority set to the program or a program-owned PDA — rather than leaving it unclaimed (and attacker-ownable) or stale? (PASS: metadata created in the same flow that creates the mint, update authority = program/PDA, and closed/reset when the mint is retired so it cannot go stale on re-use; FAIL: metadata left unclaimed → an attacker front-runs and sets name/URI/authority, or old metadata is not closed and reappears on a later re-mint/re-burn. Evidence: Zenith MetaDAO, Accretion, OtterSec Orca stale-metadata-on-reburn)

## 4.6 — CPI Reentrancy & Composability

- [ ] **RE-001**: State mutations happen BEFORE external CPIs (checks-effects-interactions pattern)
- [ ] **RE-002**: If state is read after CPI, it's re-loaded (not using stale pre-CPI data)
- [ ] **RE-003**: Account reload after CPI uses `.reload()` which re-validates owner (Anchor 1.0)
- [ ] **RE-004**: No CPI grants approval to an external program that could re-enter
- [ ] **RE-005**: Flash loan resistance: could an attacker borrow tokens, deposit, inflate NAV, and withdraw in one transaction?
- [ ] **RE-006**: CPI callee SOL-spend guard — Solana has no `msg.value`, so a callee can spend SOL from ANY signing account passed into a CPI (not just an explicit "amount" argument). Before an `invoke`/`invoke_signed` to a composed or user-supplied program, the caller records `signer.lamports()` and bounds the post-call drain. (PASS: pre-CPI lamports snapshot taken and a `checked_sub` post-CPI asserts the drain is within an expected bound; FAIL: a signing account is handed to an external CPI with no lamport accounting — the callee can siphon its full balance. (adapted from safe-solana-builder shared-base §5.4))
- [ ] **RE-007**: Post-CPI ownership re-verification — an attacker-controlled callee can invoke System `assign` mid-CPI to steal an account's owner. After any CPI touching a relied-upon account, the caller re-asserts `account.owner == expected`. (PASS: owner re-checked after the CPI — Anchor `.reload()` covers ONLY accounts Anchor itself reloads, so native/Pinocchio/raw-`invoke` paths re-check the owner manually; FAIL: account owner trusted from before the CPI, or `.reload()` assumed to cover a raw-invoke account it never touched. (adapted from safe-solana-builder shared-base §5.5))
