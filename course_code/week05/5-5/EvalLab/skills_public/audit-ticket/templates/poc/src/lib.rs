//! PoC harness entrypoint for finding {FINDING_ID} — {ONE_LINE_TITLE}.
//!
//! Single entrypoint, two feature-selected bodies:
//!   - `vulnerable` → routes to `vulnerable::process`, the minimized flaw.
//!   - `fixed`      → routes to `fixed::process`, the flaw closed.
//! Exactly one must be enabled; enabling neither is a compile error, so a
//! misconfigured build fails loudly instead of silently testing nothing.
//!
//! Keep this file THIN. All exploit-relevant logic lives in `vulnerable.rs` /
//! `fixed.rs`. This file only wires the entrypoint, the feature dispatch, and any
//! shared state types both arms deserialize.

use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey,
};

#[cfg(feature = "fixed")]
pub mod fixed;
#[cfg(feature = "vulnerable")]
pub mod vulnerable;

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    #[cfg(feature = "vulnerable")]
    {
        vulnerable::process(program_id, accounts, instruction_data)
    }
    #[cfg(feature = "fixed")]
    {
        fixed::process(program_id, accounts, instruction_data)
    }
    #[cfg(not(any(feature = "vulnerable", feature = "fixed")))]
    {
        compile_error!(
            "{PROGRAM_NAME}: enable exactly one arm — `--features vulnerable` or `--features fixed`"
        );
    }
}

// ── Shared state ────────────────────────────────────────────────────────────
// Reconstruct ONLY the fields the exploit reads or writes — the minimized subset
// of the target's account layout, not a faithful copy. Fewer fields == a clearer
// reproduction. Delete this block if the finding needs no on-chain state.
//
// {MINIMIZED_STATE_LAYOUT} — e.g. the authority the ix compares against, a balance
// the exploit drains, a bump the program should re-derive.

#[derive(borsh::BorshDeserialize, borsh::BorshSerialize, Clone)]
pub struct State {
    // {STATE_FIELDS}
    pub authority: Pubkey,
}

impl State {
    /// Serialized length of the minimized layout above. Keep in sync with the
    /// fields; the tests use it to size the fixture buffer.
    pub const LEN: usize = 32; // {UPDATE_TO_MATCH_STATE_FIELDS}
}
