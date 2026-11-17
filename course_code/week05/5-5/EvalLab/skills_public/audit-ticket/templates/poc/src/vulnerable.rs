//! {FINDING_ID} — vulnerable arm.
//!
//! This processor reproduces the flaw in the SMALLEST form that still lets the
//! exploit land. It is not the target's real code — it is the target's real *bug*,
//! stripped of everything the attack does not touch.
//!
//! Authoring contract:
//!   - Reproduce the exact missing/incorrect check the finding cites — nothing more.
//!     A signer check that is absent stays absent; a bound that is unchecked stays
//!     unchecked. Do NOT add unrelated guards: extra validation here can mask the
//!     flaw and make `tests/exploit.rs` fail to reproduce.
//!   - The only difference between this file and `fixed.rs` must be the cited
//!     guard/bound. That single-line delta IS the finding, and it is also what the
//!     patch transplants (see `templates/patch/patch.md`).
//!   - Mirror the target's real control flow enough that the attacker narrative in
//!     README.md maps 1:1 onto these lines.

use crate::State;
use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();

    // Pull the accounts the exploit needs, in the target's order. Rename/extend
    // to match the instruction under review.
    let state_account = next_account_info(iter)?;
    let _authority = next_account_info(iter)?;

    // Keep any checks that are genuinely PRESENT in the target and that the attack
    // legitimately satisfies (e.g. an owner check the attacker passes honestly).
    if state_account.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    let _state = State::try_from_slice(&state_account.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;

    // {MINIMIZED_REPRO_OF_THE_FLAW}
    // ───────────────────────────────────────────────────────────────────────────
    // Put the bug HERE, and only here. Examples of the shape this takes:
    //   • missing signer:   compare `authority.key == state.authority` but never
    //                       check `authority.is_signer` — so an unsigned public key
    //                       is accepted.
    //   • unchecked math:   `state.balance += amount;` with no `checked_add`, so a
    //                       crafted `amount` overflows/underflows the bound.
    //   • missing owner:    read fields off `state_account` without confirming its
    //                       `owner`, so an attacker-forged account is trusted.
    //   • unvalidated CPI:  invoke `*callee.key` with no program-id pin, so control
    //                       routes to attacker bytecode.
    // The privileged effect the attacker gains goes below (state write, transfer,
    // CPI). `tests/exploit.rs` asserts this path returns Ok for the crafted input.
    // ───────────────────────────────────────────────────────────────────────────

    Ok(())
}
