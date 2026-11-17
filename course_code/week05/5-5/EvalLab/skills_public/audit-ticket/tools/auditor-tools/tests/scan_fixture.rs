//! End-to-end scan test against an inline Anchor-style source string.

use auditor_tools::scan;

const FIXTURE: &str = r#"
use anchor_lang::prelude::*;

declare_id!("Fixture1111111111111111111111111111111111");

#[program]
pub mod my_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, amount: u64) -> Result<()> {
        let a: u64 = 10;
        let b: u64 = 20;
        let total = a + b;
        let vault = &mut ctx.accounts.vault;
        vault.balance = total;
        let first = ctx.remaining_accounts.get(0).unwrap();
        let _ = first;
        Ok(())
    }

    pub fn deposit_extra(
        ctx: Context<DepositExtra>,
        _amount: u64,
    ) -> Result<()> {
        let _ = ctx.accounts.extra;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 40,
        seeds = [b"vault", authority.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositExtra<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 8,
        seeds = [b"extra", payer.key().as_ref()],
        bump
    )]
    pub extra: Account<'info, ExtraState>,

    /// CHECK: validated in handler before use
    pub oracle: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub balance: u64,
}

#[account]
pub struct ExtraState {
    pub value: u64,
}
"#;

#[test]
fn scan_fixture_extracts_expected_surface() {
    let report = scan::scan_source("fixture.rs", FIXTURE).expect("fixture should parse");

    // Exactly two instructions (the fns inside the #[program] mod).
    assert_eq!(
        report.instructions.len(),
        2,
        "expected 2 instructions, got {:?}",
        report.instructions
    );
    let ix = report
        .instructions
        .iter()
        .find(|i| i.name == "initialize")
        .expect("initialize instruction should be present");
    assert_eq!(ix.args.len(), 1, "expected 1 typed arg (amount)");
    assert_eq!(ix.args[0].name, "amount");
    assert_eq!(ix.args[0].ty, "u64");

    // At least one Accounts struct.
    assert!(
        !report.accounts_structs.is_empty(),
        "expected >=1 accounts_struct"
    );
    let init_struct = report
        .accounts_structs
        .iter()
        .find(|s| s.name == "Initialize")
        .expect("Initialize struct should be present");

    // The vault field carries init (not init_if_needed) + seeds + bump.
    let vault_field = init_struct
        .fields
        .iter()
        .find(|f| f.name == "vault")
        .expect("vault field should be present");
    assert!(vault_field.constraints.init, "vault should be init");
    assert!(
        !vault_field.constraints.init_if_needed,
        "vault should not be init_if_needed"
    );
    assert!(vault_field.constraints.bump, "vault should have bump");
    assert!(
        !vault_field.constraints.seeds.is_empty(),
        "vault should have seeds"
    );
    assert!(!vault_field.unchecked, "vault should not be unchecked");

    let deposit_struct = report
        .accounts_structs
        .iter()
        .find(|s| s.name == "DepositExtra")
        .expect("DepositExtra struct should be present");

    let extra_field = deposit_struct
        .fields
        .iter()
        .find(|f| f.name == "extra")
        .expect("extra field should be present");
    assert!(!extra_field.constraints.init, "extra should not use init");
    assert!(
        extra_field.constraints.init_if_needed,
        "extra should use init_if_needed"
    );

    let oracle_field = deposit_struct
        .fields
        .iter()
        .find(|f| f.name == "oracle")
        .expect("oracle field should be present");
    assert!(
        oracle_field.unchecked,
        "oracle UncheckedAccount should be flagged unchecked"
    );

    // At least one PDA entry, from the seeds constraint.
    assert!(
        report.pdas.iter().any(|p| p.field == "vault"),
        "expected a PDA entry for vault, got {:?}",
        report.pdas
    );

    // At least one raw arithmetic site (a + b).
    assert!(
        report.arithmetic_sites.iter().any(|s| s.op == "+"),
        "expected a '+' arithmetic site, got {:?}",
        report.arithmetic_sites
    );

    // At least one panic site (.unwrap()).
    assert!(
        report.panic_sites.iter().any(|s| s.kind == "unwrap"),
        "expected an unwrap panic site, got {:?}",
        report.panic_sites
    );

    // remaining_accounts access in initialize.
    assert!(
        report
            .remaining_accounts_sites
            .iter()
            .any(|s| s.snippet.contains("remaining_accounts")),
        "expected a remaining_accounts site, got {:?}",
        report.remaining_accounts_sites
    );

    // Line numbers are real (non-zero) thanks to span-locations.
    assert!(ix.line > 0, "instruction line should be > 0");
    assert!(vault_field.constraints.raw.contains("account"));
}
