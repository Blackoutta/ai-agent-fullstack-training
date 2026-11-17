//! `audit-scan <path> [--out FILE] [--pretty]`
//!
//! Recursively parses `*.rs` files under `<path>` and prints one JSON object
//! describing the risky audit surface to stdout (or `--out`).

use std::path::PathBuf;

use anyhow::{Context, Result};
use auditor_tools::scan;
use clap::Parser;

#[derive(Parser, Debug)]
#[command(
    name = "audit-scan",
    about = "Enumerate the risky surface of a Solana/Anchor Rust codebase as JSON."
)]
struct Cli {
    /// Root path to scan (directory or single .rs file's directory).
    path: PathBuf,

    /// Write the JSON to this file instead of stdout.
    #[arg(long)]
    out: Option<PathBuf>,

    /// Pretty-print the JSON.
    #[arg(long)]
    pretty: bool,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let report = scan::scan_path(&cli.path);

    let json = if cli.pretty {
        serde_json::to_string_pretty(&report)?
    } else {
        serde_json::to_string(&report)?
    };

    match &cli.out {
        Some(path) => {
            std::fs::write(path, json.as_bytes())
                .with_context(|| format!("failed to write output to {}", path.display()))?;
        }
        None => {
            println!("{}", json);
        }
    }

    Ok(())
}
