//! Support crate for auditor-skill proof-of-concept exploit harnesses.
//!
//! Every per-finding PoC crate copied out of `templates/poc/` links against this
//! crate to get three things, kept deliberately small so a reviewer can read the
//! whole surface in one sitting:
//!
//!   1. `mollusk_for` — stand up a Mollusk runner bound to a program id + compiled
//!      `.so`, the one line of setup every Mollusk-based PoC needs. It records which
//!      bytes it loaded.
//!   2. account fixtures — `program_owned_account`, `system_account`,
//!      `attacker_owned_account` — the three account shapes an access-control /
//!      ownership / signer exploit almost always has to construct.
//!   3. the assertion macros that encode the PoC contract — the attack must go
//!      through on the `vulnerable` build and must be turned away on the `fixed`
//!      build:
//!        - `assert_exploit_effect!`: it went through AND left a concrete value in
//!          the account it targets;
//!        - `assert_exploit_rejected_with!`: it was rejected with this exact error;
//!        - `assert_exploit_blocked!`: it failed and left the account unchanged,
//!          while a legitimate call on the same bytes went through and changed it
//!          (a deployed fix whose error is unknown);
//!        - `assert_exploit_succeeds!` / `assert_exploit_rejected!`: any `Ok` / any
//!          error, for an audit-time model only.
//!
//! Each assertion leaves markers (`mark`): `attempted` when it starts, `held` when
//! it holds, and the first three a marker of their own kind; `mollusk_for` leaves a
//! `loaded` marker naming the bytes it loaded. On prebuilt bytes `run.sh` accepts an
//! arm only with its assertion's marker and only when every load names the bytes it
//! placed, so an assertion in a comment, a string or dead code — or one that never
//! ran — does not count, and a test that fails before any assertion ran decides
//! nothing. The markers are a floor, not proof: whoever reads the PoC still checks
//! that the assertion states the finding's effect and the guard's error, and that
//! the program under test is loaded only through `mollusk_for`.
//!
//! This file is authored as reusable template source. It is not built when the
//! skill ships; the user's Solana toolchain builds it at audit time once the PoC
//! crate has been filled in (`cargo build-sbf`, then `cargo test`).

use mollusk_svm::program::loader_keys::LOADER_V3;
use mollusk_svm::result::{InstructionResult, ProgramResult};
use mollusk_svm::Mollusk;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use std::path::PathBuf;

#[doc(hidden)]
pub use mollusk_svm::result::ProgramResult as __ProgramResult;

/// The System program id, surfaced here so a PoC test never has to import the
/// system-interface crate just to describe a system-owned account.
pub const SYSTEM_PROGRAM_ID: Pubkey = solana_system_interface::program::ID;

// ---------------------------------------------------------------------------
// Runner bring-up
// ---------------------------------------------------------------------------

/// Build a Mollusk runner for a program.
///
/// `program_id` is the id the instruction targets. `so_name` is the base name of
/// the compiled shared object (no `.so` suffix, e.g. `"poc_program"`) that
/// `cargo build-sbf` emitted into `SBF_OUT_DIR` / `target/deploy`. The file is
/// looked up where Mollusk looks — `tests/fixtures`, `BPF_OUT_DIR`, `SBF_OUT_DIR`,
/// then the working directory — and a name holding `/` is refused, so no other path
/// can be named. Mollusk loads that bytecode — it does NOT run the `#[test]`
/// binary's own code — so the crate must be built for SBF before the test runs.
/// `run.sh` wires this ordering.
///
/// The file is read once, and those bytes are what Mollusk loads; their path and
/// zero-trimmed sha256 go to the `loaded` marker, which `run.sh` compares with the
/// arm it placed. A refused name, a missing file and bytes the loader rejects fail
/// the test as inconclusive. Load the program under test only here, and never swap
/// it afterwards: what `Mollusk::new` or `add_program` load leaves no marker.
pub fn mollusk_for(program_id: Pubkey, so_name: &str) -> Mollusk {
    let (path, elf) = program_elf(so_name);
    let hash = zero_trimmed_sha256(&elf);
    let mut mollusk = Mollusk::default();
    let added = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        mollusk.add_program_with_loader_and_elf(&program_id, &LOADER_V3, &elf)
    }));
    if let Err(panic) = added {
        let reason = format!(
            "{} (sha256 {hash}) did not load as a program",
            path.display()
        );
        mark("inconclusive", &reason);
        std::panic::resume_unwind(panic);
    }
    mark("loaded", &format!("{hash} {}", path.display()));
    mollusk
}

/// A fresh, unique public key for a fixture. Thin alias over `Pubkey::new_unique`
/// so test bodies read as intent ("the attacker", "the vault") rather than API.
pub fn random_pubkey() -> Pubkey {
    Pubkey::new_unique()
}

/// The `<so_name>.so` that `mollusk_for` loads, and its bytes.
fn program_elf(so_name: &str) -> (PathBuf, Vec<u8>) {
    if so_name.contains('/') {
        inconclusive(&format!(
            "mollusk_for refuses the program name {so_name:?}: a name holding '/' can reach a file outside the search directories"
        ));
    }
    let file = format!("{so_name}.so");
    let mut dirs = vec![PathBuf::from("tests/fixtures")];
    for var in ["BPF_OUT_DIR", "SBF_OUT_DIR"] {
        if let Some(dir) = std::env::var_os(var) {
            dirs.push(dir.into());
        }
    }
    if let Ok(dir) = std::env::current_dir() {
        dirs.push(dir);
    }
    let found = dirs
        .iter()
        .map(|dir| dir.join(&file))
        .find(|path| path.exists());
    let Some(path) = found else {
        inconclusive(&format!(
            "no {file} in tests/fixtures, BPF_OUT_DIR, SBF_OUT_DIR or the working directory"
        ));
    };
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    match std::fs::read(&path) {
        Ok(elf) => (path, elf),
        Err(err) => inconclusive(&format!("cannot read {}: {err}", path.display())),
    }
}

/// The sha256 `run.sh` (and `solana-verify`) name a program by: trailing zero
/// padding is trimmed first.
fn zero_trimmed_sha256(elf: &[u8]) -> String {
    let end = elf
        .iter()
        .rposition(|byte| *byte != 0)
        .map_or(0, |last| last + 1);
    Sha256::digest(&elf[..end])
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

// ---------------------------------------------------------------------------
// Account fixtures
// ---------------------------------------------------------------------------

/// A data account owned by `program_id`, carrying `data` and funded to the
/// rent-exempt minimum for that data length.
///
/// Use this for the account under attack — the config/vault/state PDA whose owner
/// the program checks (or fails to check). Seed `data` with the serialized state
/// the exploit needs the program to read.
pub fn program_owned_account(program_id: Pubkey, data: Vec<u8>) -> Account {
    let lamports = Rent::default().minimum_balance(data.len());
    Account {
        lamports,
        data,
        owner: program_id,
        executable: false,
        rent_epoch: 0,
    }
}

/// A plain System-owned account holding `lamports` and no data.
///
/// Use this for the wallets in the scenario: the fee payer, the attacker's signer,
/// a fresh recipient. Pass `0` for an account that only needs to exist as a key in
/// the accounts list.
pub fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: vec![],
        owner: SYSTEM_PROGRAM_ID,
        executable: false,
        rent_epoch: 0,
    }
}

/// An account the attacker fully controls but that *claims* to be owned by
/// `claimed_owner`, carrying attacker-chosen `data`.
///
/// This is the substitution primitive for owner-confusion / type-confusion /
/// fake-PDA exploits: hand the program an account whose `owner` field and bytes
/// the attacker set, and prove the program trusts them without re-deriving or
/// re-checking. (Mechanically identical to a program-owned account — the point is
/// that the bytes and the claimed owner are adversary-supplied, which the call
/// site name makes explicit at the exploit's construction.)
pub fn attacker_owned_account(claimed_owner: Pubkey, data: Vec<u8>) -> Account {
    program_owned_account(claimed_owner, data)
}

// ---------------------------------------------------------------------------
// PoC contract macros
// ---------------------------------------------------------------------------

/// Assert the exploit went through: the program accepted the crafted instruction.
///
/// Feed it the value returned by `mollusk.process_instruction(...)` and a short
/// reason string describing what the acceptance proves. Any `Ok` passes, so this
/// fits an audit-time model only; on prebuilt bytes `run.sh` accepts the vulnerable
/// arm only on `assert_exploit_effect!`, because a program can accept a call and do
/// no harm.
///
/// ```ignore
/// let outcome = mollusk.process_instruction(&ix, &accounts);
/// assert_exploit_succeeds!(outcome, "no signer check let an unsigned admin key through");
/// ```
#[macro_export]
macro_rules! assert_exploit_succeeds {
    ($outcome:expr, $why:expr $(,)?) => {
        $crate::__assert_succeeds(&$outcome, &$why)
    };
}

/// Assert the fix held: the program rejected the same crafted instruction.
///
/// The mirror of `assert_exploit_succeeds!`: any error passes. That fits an
/// audit-time model only. A rejection for an unrelated reason (a wrong account
/// count, the wrong program id) would pass too, so on prebuilt bytes `run.sh`
/// accepts the fixed arm only on `assert_exploit_rejected_with!` or
/// `assert_exploit_blocked!`.
///
/// ```ignore
/// let outcome = mollusk.process_instruction(&ix, &accounts);
/// assert_exploit_rejected!(outcome, "the added is_signer check turned the unsigned key away");
/// ```
#[macro_export]
macro_rules! assert_exploit_rejected {
    ($outcome:expr, $why:expr $(,)?) => {
        $crate::__assert_rejected(&$outcome, &$why)
    };
}

/// Assert the exploit went through AND left its effect: after the attack, `read`
/// gives `expect` for `account`, and before it, it gave something else.
///
/// - `before`: the account list passed to `process_instruction`;
/// - `account`: the account the attack changes;
/// - `read`: pulls the changed field out of that account the way the program stores
///   it (bytes, lamports, a decoded field), as an owned value;
/// - `expect`: the concrete value the attack leaves there.
///
/// This is the vulnerable-arm assertion prebuilt mode requires: on real bytes `Ok`
/// alone proves nothing, because the program may accept the call and do no harm.
///
/// ```ignore
/// let outcome = mollusk.process_instruction(&ix, &accounts);
/// assert_exploit_effect!(
///     outcome,
///     before: &accounts,
///     account: state_pk,
///     read: |a| a.data[0..32].to_vec(),
///     expect: attacker.to_bytes().to_vec(),
///     why: "the attacker now holds the authority",
/// );
/// ```
#[macro_export]
macro_rules! assert_exploit_effect {
    ($outcome:expr, before: $before:expr, account: $account:expr, read: $read:expr,
     expect: $expect:expr, why: $why:expr $(,)?) => {
        $crate::__assert_effect(&$outcome, $before, &$account, $read, $expect, $why)
    };
}

/// Assert the fix held AND turned the attack away with exactly `expected`, the
/// guard's error, compared with `==`.
///
/// `expected` is a value, never a pattern: `ProgramError::MissingRequiredSignature`,
/// `ProgramError::Custom(6000)`. A wildcard or a binding does not compile, and no
/// `Custom(_)` can stand in for the guard: an Anchor program run under the wrong id
/// rejects every call with `Custom(4100)`, which would otherwise pass for a fix.
/// Any other result fails the test. A harness error (`harness_error`) fails it as
/// inconclusive, which `run.sh` reports as a blocker, not as a broken fix.
///
/// Use it for the fix we propose. For a fix the team deployed, whose error is not
/// known in advance, use `assert_exploit_blocked!`.
///
/// ```ignore
/// use solana_sdk::program_error::ProgramError;
/// let outcome = mollusk.process_instruction(&ix, &accounts);
/// assert_exploit_rejected_with!(
///     outcome,
///     ProgramError::MissingRequiredSignature,
///     "the restored is_signer check rejected the unsigned authority"
/// );
/// ```
#[macro_export]
macro_rules! assert_exploit_rejected_with {
    ($outcome:expr, $expected:expr, $why:expr $(,)?) => {
        $crate::__assert_rejected_with(&$outcome, $crate::__ProgramResult::Failure($expected), $why)
    };
}

/// Assert a fix whose error is not known in advance (a hotfix the team deployed)
/// stopped the attack, against a positive control on the same bytes:
///
/// - `control`: the result of a legitimate call — the instruction the finding
///   concerns, with valid accounts and signers — through the same runner, and
///   `control_before` the account list it was given. It must go through AND change
///   what `read` gives for `account`: that shows the harness drives this program
///   and that the read sees the effect the attack is after.
/// - the attack (`outcome`, `before`) must then fail with an error that is not a
///   harness error and leave what `read` gives for `account` unchanged.
///
/// Pass the same `account` and `read` as the vulnerable arm's
/// `assert_exploit_effect!`. A control that fails or changes nothing, and a harness
/// error on the attack, fail the test as inconclusive: without the control, a
/// program that fails every call would pass for a fix. When no legitimate call can
/// go through and change that account on these bytes (the fix turned the
/// instruction off, say), pin the fix's error with `assert_exploit_rejected_with!`
/// instead.
///
/// ```ignore
/// let control = mollusk.process_instruction(&legit_ix, &legit_accounts);
/// let outcome = mollusk.process_instruction(&ix, &accounts);
/// assert_exploit_blocked!(
///     outcome,
///     before: &accounts,
///     control: control,
///     control_before: &legit_accounts,
///     account: state_pk,
///     read: |a| a.data[0..32].to_vec(),
///     why: "the deployed hotfix keeps the authority",
/// );
/// ```
#[macro_export]
macro_rules! assert_exploit_blocked {
    ($outcome:expr, before: $before:expr, control: $control:expr,
     control_before: $control_before:expr, account: $account:expr, read: $read:expr,
     why: $why:expr $(,)?) => {
        $crate::__assert_blocked(
            &$outcome,
            $before,
            &$control,
            $control_before,
            &$account,
            $read,
            $why,
        )
    };
}

// ---------------------------------------------------------------------------
// What the contract macros run
// ---------------------------------------------------------------------------

#[doc(hidden)]
pub fn __assert_succeeds(outcome: &InstructionResult, why: &str) {
    attempt("succeeds", why);
    let result = &outcome.program_result;
    assert!(
        result.is_ok(),
        "exploit was expected to SUCCEED ({why}), but the program rejected it: {result:?}"
    );
    held("succeeds", why);
}

#[doc(hidden)]
pub fn __assert_rejected(outcome: &InstructionResult, why: &str) {
    attempt("rejected", why);
    assert!(
        outcome.program_result.is_err(),
        "attack was expected to be REJECTED ({why}), but the program accepted it"
    );
    held("rejected", why);
}

#[doc(hidden)]
pub fn __assert_effect<T, F>(
    outcome: &InstructionResult,
    before: &[(Pubkey, Account)],
    account: &Pubkey,
    read: F,
    expect: T,
    why: &str,
) where
    T: PartialEq + core::fmt::Debug,
    F: Fn(&Account) -> T,
{
    attempt("effect", why);
    let result = &outcome.program_result;
    assert!(
        result.is_ok(),
        "exploit was expected to SUCCEED and change {account:?} ({why}), but the program returned {result:?}{}",
        harness_note(result),
    );
    let (was, now) = before_and_after(outcome, before, account, &read, why);
    assert!(
        now == expect,
        "after the attack {account:?} reads {now:?}, not {expect:?} ({why})"
    );
    assert!(
        was != expect,
        "{account:?} already read {expect:?} before the attack, so this shows no effect ({why})"
    );
    let line = format!("{account:?}: {was:?} -> {now:?} ({why})");
    mark("effect", &line);
    held("effect", &line);
}

#[doc(hidden)]
pub fn __assert_rejected_with(outcome: &InstructionResult, expected: ProgramResult, why: &str) {
    attempt("rejected_with", why);
    let result = &outcome.program_result;
    if *result != expected {
        inconclusive_if_harness(result, why);
        panic!("attack was expected to be REJECTED with {expected:?} ({why}), but got: {result:?}");
    }
    let line = format!("{result:?} ({why})");
    mark("rejected_with", &line);
    held("rejected_with", &line);
}

#[doc(hidden)]
pub fn __assert_blocked<T, F>(
    outcome: &InstructionResult,
    before: &[(Pubkey, Account)],
    control: &InstructionResult,
    control_before: &[(Pubkey, Account)],
    account: &Pubkey,
    read: F,
    why: &str,
) where
    T: PartialEq + core::fmt::Debug,
    F: Fn(&Account) -> T,
{
    attempt("blocked", why);
    let control_result = &control.program_result;
    if control_result.is_err() {
        inconclusive(&format!(
            "the legitimate call failed on these bytes ({control_result:?}): the harness does not drive this program, or the fix turned the instruction off; pin the fix's error with assert_exploit_rejected_with! instead ({why})"
        ));
    }
    let (control_was, control_now) = before_and_after(control, control_before, account, &read, why);
    if control_was == control_now {
        inconclusive(&format!(
            "the legitimate call went through but left {account:?} at {control_was:?}, so this read cannot show whether the attack was stopped ({why})"
        ));
    }
    let result = &outcome.program_result;
    assert!(
        result.is_err(),
        "attack was expected to be BLOCKED ({why}), but the program accepted it"
    );
    inconclusive_if_harness(result, why);
    let (was, now) = before_and_after(outcome, before, account, &read, why);
    assert!(
        now == was,
        "the attack failed with {result:?}, yet {account:?} changed: {was:?} -> {now:?} ({why})"
    );
    let line = format!(
        "{result:?}; {account:?} unchanged, while the legitimate call changed it: {control_was:?} -> {control_now:?} ({why})"
    );
    mark("blocked", &line);
    held("blocked", &line);
}

fn before_and_after<T, F: Fn(&Account) -> T>(
    outcome: &InstructionResult,
    before: &[(Pubkey, Account)],
    account: &Pubkey,
    read: &F,
    why: &str,
) -> (T, T) {
    let Some((_, was)) = before.iter().find(|(key, _)| key == account) else {
        inconclusive(&format!(
            "{account:?} is not in the account list given to the instruction ({why})"
        ));
    };
    let Some(now) = outcome.get_account(account) else {
        inconclusive(&format!(
            "{account:?} is not in the instruction result ({why})"
        ));
    };
    (read(was), read(now))
}

/// Results that show the harness, not a guard, stopped the attack: the attack as
/// written no longer fits the program, or the runtime could not run it. Matched on
/// the printed form, so this crate names no error type and stays correct across
/// solana versions. Custom 3005, 4100, 101 and 102 are Anchor's AccountNotEnoughKeys,
/// DeclaredProgramIdMismatch, InstructionFallbackNotFound and
/// InstructionDidNotDeserialize.
fn harness_error(result: &ProgramResult) -> Option<&'static str> {
    match format!("{result:?}").as_str() {
        "Failure(NotEnoughAccountKeys)"
        | "Failure(Custom(3005))"
        | "UnknownError(MissingAccount)" => {
            Some("the attack's account list does not fit the program")
        }
        "Failure(IncorrectProgramId)" | "Failure(Custom(4100))" => {
            Some("the program runs under the wrong id, or a program account is wrong")
        }
        "Failure(Custom(101))" | "Failure(Custom(102))" => {
            Some("the program does not recognise the instruction or its arguments")
        }
        "UnknownError(UnsupportedProgramId)"
        | "UnknownError(ProgramFailedToCompile)"
        | "UnknownError(ComputationalBudgetExceeded)" => {
            Some("the runtime could not run the instruction as written")
        }
        _ => None,
    }
}

fn harness_note(result: &ProgramResult) -> String {
    harness_error(result)
        .map(|reason| format!(" — a harness error: {reason}"))
        .unwrap_or_default()
}

fn inconclusive_if_harness(result: &ProgramResult, why: &str) {
    if let Some(reason) = harness_error(result) {
        inconclusive(&format!(
            "a harness error, not a guard: {result:?}: {reason} ({why})"
        ));
    }
}

/// Fail the test as inconclusive: the PoC as written cannot decide its arm, which
/// `run.sh` reports as a blocker, never as a verdict.
fn inconclusive(reason: &str) -> ! {
    mark("inconclusive", reason);
    panic!("INCONCLUSIVE: {reason}");
}

/// A contract assertion starts: `run.sh` counts a failed test as a verdict only when
/// an assertion ran and did not hold.
fn attempt(kind: &str, why: &str) {
    mark("attempted", &format!("{kind} ({why})"));
}

/// A contract assertion held. The three that count on prebuilt bytes have also left
/// a marker of their own kind, which `run.sh` reports.
fn held(kind: &str, line: &str) {
    mark("held", &format!("{kind}: {line}"));
}

/// Append a line to the `kind` marker: `attempted` and `held` for every contract
/// assertion, `effect` / `rejected_with` / `blocked` for the three that count on
/// prebuilt bytes, `loaded` for each program `mollusk_for` loads, and
/// `inconclusive` for why a load or an assertion could not decide. `run.sh` points
/// AUDITOR_POC_MARKERS at an empty directory per arm and reads it after the arm's
/// test; nothing is written when it is unset.
fn mark(kind: &str, line: &str) {
    let Some(dir) = std::env::var_os("AUDITOR_POC_MARKERS").filter(|dir| !dir.is_empty()) else {
        return;
    };
    let path = std::path::Path::new(&dir).join(kind);
    let line = format!("{}\n", line.replace('\n', " "));
    let written = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| std::io::Write::write_all(&mut file, line.as_bytes()));
    if let Err(err) = written {
        eprintln!(
            "shared-test-utils: cannot record the {kind} marker in {}: {err}",
            path.display()
        );
    }
}
