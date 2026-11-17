//! `auditor-tools` — host-side static analysis for Solana/Anchor codebases.
//!
//! Two capabilities, exposed as separate binaries but sharing this library:
//!
//! * [`scan`] — parse a codebase and emit the risky surface (instructions,
//!   `#[derive(Accounts)]` structs and their constraints, PDAs, raw arithmetic,
//!   panic sites, unsafe blocks, CPIs, remaining-accounts access, and every
//!   function) as one JSON object.
//! * [`mem`] — a SQLite findings store for cross-audit memory: exact dedup,
//!   regression detection, false-positive suppression, and warm re-audits.
//!
//! This is a plain synchronous CLI library — no async runtime, no network.

pub mod mem;
pub mod scan;

pub use scan::{scan_path, scan_source, ScanReport};
