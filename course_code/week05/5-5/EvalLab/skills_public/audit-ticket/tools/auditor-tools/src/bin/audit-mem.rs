//! `audit-mem <cmd>` — SQLite findings store for cross-audit memory.
//!
//! Subcommands: `init`, `put-finding`, `set-status`, `rule`, `check`,
//! `regressions`, `warm`. See the crate README for full usage.

use std::process::ExitCode;

use anyhow::Result;
use auditor_tools::mem;
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "audit-mem",
    about = "Cross-audit findings memory: dedup, regression detection, FP suppression, warm re-audits."
)]
struct Cli {
    /// Path to the SQLite database (created if missing).
    #[arg(long, default_value = ".audit-memory/audit.db", global = true)]
    db: String,

    #[command(subcommand)]
    cmd: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Create the database schema.
    Init,

    /// Upsert a finding and append an occurrence.
    PutFinding {
        #[arg(long)]
        program_id: String,
        #[arg(long)]
        signature: String,
        #[arg(long)]
        root_cause: String,
        #[arg(long)]
        title: String,
        #[arg(long)]
        severity: i64,
        #[arg(long)]
        commit: Option<String>,
        #[arg(long)]
        audit_n: Option<String>,
        #[arg(long)]
        file: Option<String>,
        #[arg(long)]
        line: Option<i64>,
        #[arg(long)]
        verdict: Option<String>,
    },

    /// Update the status of a finding.
    SetStatus {
        #[arg(long)]
        program_id: String,
        #[arg(long)]
        signature: String,
        #[arg(long)]
        root_cause: String,
        /// One of FIXED | OPEN | ACKNOWLEDGED | DISPUTED.
        #[arg(long)]
        status: String,
    },

    /// Record a false-positive / accepted-risk ruling.
    Rule {
        #[arg(long)]
        program_id: String,
        #[arg(long)]
        signature: String,
        /// One of FALSE_POSITIVE | ACCEPTED_RISK.
        #[arg(long)]
        ruling: String,
        #[arg(long)]
        rationale: String,
        #[arg(long)]
        by: String,
        #[arg(long)]
        scope: Option<String>,
    },

    /// Check whether a (program_id, signature) pair is suppressed.
    /// Exit 0 if suppressed, exit 1 otherwise.
    Check {
        #[arg(long)]
        program_id: String,
        #[arg(long)]
        signature: String,
    },

    /// List findings whose status is REGRESSED, as JSON.
    Regressions {
        #[arg(long)]
        program_id: String,
    },

    /// Emit the warm-start context block for a re-audit, as JSON.
    Warm {
        #[arg(long)]
        program_id: String,
    },
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(err) => {
            eprintln!("error: {:#}", err);
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<ExitCode> {
    let cli = Cli::parse();
    let conn = mem::open_db(&cli.db)?;

    match cli.cmd {
        Command::Init => {
            // Schema is created by open_db; make the intent explicit.
            mem::init_schema(&conn)?;
            println!("initialized {}", cli.db);
        }

        Command::PutFinding {
            program_id,
            signature,
            root_cause,
            title,
            severity,
            commit,
            audit_n,
            file,
            line,
            verdict,
        } => {
            let outcome = mem::put_finding(
                &conn,
                &mem::PutFinding {
                    program_id: &program_id,
                    signature: &signature,
                    root_cause: &root_cause,
                    title: &title,
                    severity,
                    commit: commit.as_deref(),
                    audit_n: audit_n.as_deref(),
                    file: file.as_deref(),
                    line,
                    verdict: verdict.as_deref(),
                },
            )?;
            if outcome.regressed {
                println!("REGRESSED {}", outcome.finding_id);
            } else {
                println!("{} {}", outcome.status, outcome.finding_id);
            }
        }

        Command::SetStatus {
            program_id,
            signature,
            root_cause,
            status,
        } => {
            let changed = mem::set_status(&conn, &program_id, &signature, &root_cause, &status)?;
            println!("updated {} row(s) -> {}", changed, status);
        }

        Command::Rule {
            program_id,
            signature,
            ruling,
            rationale,
            by,
            scope,
        } => {
            let id = mem::add_ruling(
                &conn,
                &program_id,
                &signature,
                &ruling,
                &rationale,
                &by,
                scope.as_deref(),
            )?;
            println!("ruling {} recorded ({})", id, ruling);
        }

        Command::Check {
            program_id,
            signature,
        } => {
            let result = mem::check(&conn, &program_id, &signature)?;
            println!("{}", serde_json::to_string(&result)?);
            return Ok(if result.suppressed {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            });
        }

        Command::Regressions { program_id } => {
            let rows = mem::regressions(&conn, &program_id)?;
            println!("{}", serde_json::to_string(&rows)?);
        }

        Command::Warm { program_id } => {
            let ctx = mem::warm(&conn, &program_id)?;
            println!("{}", serde_json::to_string(&ctx)?);
        }
    }

    Ok(ExitCode::SUCCESS)
}
