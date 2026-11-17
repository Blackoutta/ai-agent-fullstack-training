//! {FINDING_ID} — the SAME attack MUST be rejected by the `fixed` arm.
//!
//! Compiled and run only under `--features fixed`. This test body is a copy of
//! `tests/exploit.rs`'s crafted instruction — identical accounts, identical data —
//! with the opposite assertion. Keeping the two attacks byte-identical is what makes
//! the pair a proof: only the guard changed between the arms, so the flipped outcome
//! is attributable to the fix and nothing else.
//!
//! When you edit the crafted instruction in `exploit.rs`, mirror the edit here.

#![cfg(feature = "fixed")]

use borsh::BorshSerialize;
use shared_test_utils::{
    assert_exploit_rejected_with, mollusk_for, program_owned_account, random_pubkey, system_account,
};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    program_error::ProgramError,
};
use {PROGRAM_NAME}::State;

#[test]
fn same_attack_rejected_on_fixed() {
    // {PROGRAM_ID}: a fresh key for an audit-time PoC. On real bytes (run.sh
    // FIXED_SO) set this to the REAL deployed program id — an Anchor program whose
    // declare_id! does not match its own id rejects every instruction with
    // Custom(4100), which would masquerade as a "fix".
    let program_id = random_pubkey();
    let mollusk = mollusk_for(program_id, "{PROGRAM_NAME}");

    let legit_authority = random_pubkey();
    let attacker = random_pubkey();

    let mut state_bytes = Vec::with_capacity(State::LEN);
    State {
        authority: legit_authority,
    }
    .serialize(&mut state_bytes)
    .expect("serialize minimized state");

    let state_pk = random_pubkey();
    let state_acct = program_owned_account(program_id, state_bytes);

    // IDENTICAL to tests/exploit.rs — same craft, only the arm differs.
    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(state_pk, false),
            AccountMeta::new_readonly(legit_authority, false),
            AccountMeta::new_readonly(attacker, true),
        ],
        data: vec![],
    };

    let accounts = vec![
        (state_pk, state_acct),
        (legit_authority, system_account(0)),
        (attacker, system_account(1_000_000_000)),
    ];
    let outcome = mollusk.process_instruction(&ix, &accounts);

    // The contract: on the fixed build the restored guard turns the attack away with
    // ITS error, compared with == (a value, never a pattern), so a rejection for an
    // unrelated reason — a wrong program id, a short account list — cannot pass for
    // the fix. run.sh accepts prebuilt bytes only when this assertion ran and held.
    // {GUARD_ERROR}: here the restored is_signer check's error; a custom error is
    // `ProgramError::Custom(<code>)`.
    assert_exploit_rejected_with!(
        outcome,
        ProgramError::MissingRequiredSignature,
        "{WHICH_GUARD_BLOCKS_IT}"
    );

    // A hotfix the team already deployed (run.sh FIXED_SO = a fresh dump of the
    // current bytes) rejects with an error you cannot know in advance. For that check
    // only, replace the assertion above with the lines below, keeping the account and
    // read of tests/exploit.rs. They add a positive control: a legitimate call, on the
    // same bytes and runner, must go through and change that account, or the run is
    // inconclusive — without it, a program that fails every call would pass for a
    // fix. run.sh then reports the fixed arm as "blocked", which never stands for our
    // own fix. If no legitimate call can go through and change the account on these
    // bytes, pin the hotfix's error with assert_exploit_rejected_with! instead.
    //
    //   // {LEGITIMATE_CALL}: the same instruction as the attack, as its rightful
    //   // caller makes it — here the real authority signs and hands over to a new key.
    //   let next_authority = random_pubkey();
    //   let legit_ix = Instruction {
    //       program_id,
    //       accounts: vec![
    //           AccountMeta::new(state_pk, false),
    //           AccountMeta::new_readonly(legit_authority, true), // signs
    //           AccountMeta::new_readonly(next_authority, false),
    //       ],
    //       data: vec![],
    //   };
    //   let legit_accounts = vec![
    //       accounts[0].clone(),
    //       (legit_authority, system_account(1_000_000_000)),
    //       (next_authority, system_account(0)),
    //   ];
    //   let control = mollusk.process_instruction(&legit_ix, &legit_accounts);
    //   shared_test_utils::assert_exploit_blocked!(
    //       outcome,
    //       before: &accounts,
    //       control: control,
    //       control_before: &legit_accounts,
    //       account: state_pk,
    //       read: |a| a.data[0..32].to_vec(),
    //       why: "{WHICH_GUARD_BLOCKS_IT}",
    //   );
}
