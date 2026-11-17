//! Cross-audit findings memory backed by SQLite (bundled `rusqlite`).
//!
//! Provides exact-dedup of findings, regression detection (a `FIXED` finding
//! re-observed becomes `REGRESSED`), false-positive suppression rulings, and a
//! warm-start context block for re-audits.

use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Compute the stable finding id: `sha256(program_id \n code_signature \n root_cause)`.
pub fn finding_id(program_id: &str, code_signature: &str, root_cause: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(program_id.as_bytes());
    hasher.update(b"\n");
    hasher.update(code_signature.as_bytes());
    hasher.update(b"\n");
    hasher.update(root_cause.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

/// Current unix timestamp (seconds) as a string. Fine in a compiled binary.
fn now_ts() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

/// Open (or create) the database at `path` and ensure the schema exists.
pub fn open_db(path: &str) -> Result<Connection> {
    if let Some(parent) = std::path::Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).ok();
        }
    }
    let conn = Connection::open(path)?;
    init_schema(&conn)?;
    Ok(conn)
}

/// Open an in-memory database with the schema applied (used by tests).
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    init_schema(&conn)?;
    Ok(conn)
}

/// Create all tables if they do not already exist. Safe to call repeatedly.
pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS findings (
            finding_id        TEXT PRIMARY KEY,
            program_id        TEXT,
            first_seen_commit TEXT,
            last_seen_commit  TEXT,
            severity          INTEGER,
            root_cause        TEXT,
            code_signature    TEXT,
            title             TEXT,
            status            TEXT,
            first_audit_n     TEXT,
            last_audit_n      TEXT
        );

        CREATE TABLE IF NOT EXISTS occurrences (
            finding_id TEXT,
            audit_n    TEXT,
            commit_sha TEXT,
            file       TEXT,
            line       INTEGER,
            verdict    TEXT,
            rule5b_json TEXT
        );

        CREATE TABLE IF NOT EXISTS fp_rulings (
            ruling_id      INTEGER PRIMARY KEY AUTOINCREMENT,
            program_id     TEXT,
            code_signature TEXT,
            ruling         TEXT,
            rationale      TEXT,
            ruled_by       TEXT,
            ruled_at       TEXT,
            scope          TEXT
        );

        CREATE TABLE IF NOT EXISTS invariants (
            inv_id         INTEGER PRIMARY KEY AUTOINCREMENT,
            program_id     TEXT,
            protocol_class TEXT,
            statement      TEXT,
            source_fn      TEXT,
            cited_line     TEXT,
            status         TEXT
        );

        CREATE TABLE IF NOT EXISTS protocol_profile (
            program_id            TEXT PRIMARY KEY,
            protocol_class        TEXT,
            trust_assumptions_json TEXT,
            oracle_set            TEXT,
            admin_set             TEXT,
            notes                 TEXT
        );
        "#,
    )?;
    Ok(())
}

/// Arguments for [`put_finding`].
pub struct PutFinding<'a> {
    pub program_id: &'a str,
    pub signature: &'a str,
    pub root_cause: &'a str,
    pub title: &'a str,
    pub severity: i64,
    pub commit: Option<&'a str>,
    pub audit_n: Option<&'a str>,
    pub file: Option<&'a str>,
    pub line: Option<i64>,
    pub verdict: Option<&'a str>,
}

/// Outcome of a [`put_finding`] call, for the CLI to report.
pub struct PutOutcome {
    pub finding_id: String,
    pub status: String,
    pub regressed: bool,
}

/// Upsert a finding and append an occurrence.
///
/// Regression rule: if the finding already existed with status `FIXED` and this
/// call re-observes it, the status transitions to `REGRESSED`. Brand-new
/// findings start `OPEN`.
pub fn put_finding(conn: &Connection, f: &PutFinding) -> Result<PutOutcome> {
    let id = finding_id(f.program_id, f.signature, f.root_cause);
    let commit = f.commit.unwrap_or("");
    let audit_n = f.audit_n.unwrap_or("");

    let existing_status: Option<String> = conn
        .query_row(
            "SELECT status FROM findings WHERE finding_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;

    let (new_status, regressed) = match existing_status.as_deref() {
        None => ("OPEN".to_string(), false),
        Some("FIXED") => ("REGRESSED".to_string(), true),
        Some(other) => (other.to_string(), false),
    };

    if existing_status.is_none() {
        conn.execute(
            "INSERT INTO findings (finding_id, program_id, first_seen_commit, last_seen_commit, \
             severity, root_cause, code_signature, title, status, first_audit_n, last_audit_n) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                f.program_id,
                commit,
                commit,
                f.severity,
                f.root_cause,
                f.signature,
                f.title,
                new_status,
                audit_n,
                audit_n,
            ],
        )?;
    } else {
        conn.execute(
            "UPDATE findings SET last_seen_commit = ?2, last_audit_n = ?3, status = ?4, \
             severity = ?5, title = ?6 WHERE finding_id = ?1",
            params![id, commit, audit_n, new_status, f.severity, f.title],
        )?;
    }

    conn.execute(
        "INSERT INTO occurrences (finding_id, audit_n, commit_sha, file, line, verdict, rule5b_json) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            audit_n,
            commit,
            f.file.unwrap_or(""),
            f.line,
            f.verdict.unwrap_or(""),
            "",
        ],
    )?;

    Ok(PutOutcome {
        finding_id: id,
        status: new_status,
        regressed,
    })
}

/// Update the status of a finding identified by (program_id, signature, root_cause).
/// Returns the number of rows changed.
pub fn set_status(
    conn: &Connection,
    program_id: &str,
    signature: &str,
    root_cause: &str,
    status: &str,
) -> Result<usize> {
    let id = finding_id(program_id, signature, root_cause);
    let changed = conn.execute(
        "UPDATE findings SET status = ?2 WHERE finding_id = ?1",
        params![id, status],
    )?;
    Ok(changed)
}

/// Insert a false-positive / accepted-risk ruling with a timestamp.
pub fn add_ruling(
    conn: &Connection,
    program_id: &str,
    signature: &str,
    ruling: &str,
    rationale: &str,
    by: &str,
    scope: Option<&str>,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO fp_rulings (program_id, code_signature, ruling, rationale, ruled_by, ruled_at, scope) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            program_id,
            signature,
            ruling,
            rationale,
            by,
            now_ts(),
            scope.unwrap_or("program"),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Result of a suppression [`check`].
#[derive(Debug, Serialize)]
pub struct CheckResult {
    pub suppressed: bool,
    pub ruling: Option<RulingRow>,
}

#[derive(Debug, Serialize)]
pub struct RulingRow {
    pub ruling_id: i64,
    pub program_id: String,
    pub code_signature: String,
    pub ruling: String,
    pub rationale: String,
    pub ruled_by: String,
    pub ruled_at: String,
    pub scope: String,
}

/// Check whether a (program_id, signature) pair is suppressed by a
/// `FALSE_POSITIVE` ruling. Returns the most recent matching ruling if so.
pub fn check(conn: &Connection, program_id: &str, signature: &str) -> Result<CheckResult> {
    let row = conn
        .query_row(
            "SELECT ruling_id, program_id, code_signature, ruling, rationale, ruled_by, ruled_at, scope \
             FROM fp_rulings \
             WHERE program_id = ?1 AND code_signature = ?2 AND ruling = 'FALSE_POSITIVE' \
             ORDER BY ruling_id DESC LIMIT 1",
            params![program_id, signature],
            |r| {
                Ok(RulingRow {
                    ruling_id: r.get(0)?,
                    program_id: r.get(1)?,
                    code_signature: r.get(2)?,
                    ruling: r.get(3)?,
                    rationale: r.get(4)?,
                    ruled_by: r.get(5)?,
                    ruled_at: r.get(6)?,
                    scope: r.get(7)?,
                })
            },
        )
        .optional()?;

    Ok(CheckResult {
        suppressed: row.is_some(),
        ruling: row,
    })
}

#[derive(Debug, Serialize)]
pub struct FindingRow {
    pub finding_id: String,
    pub program_id: String,
    pub severity: i64,
    pub root_cause: String,
    pub code_signature: String,
    pub title: String,
    pub status: String,
}

/// List findings for a program whose status is `REGRESSED`.
pub fn regressions(conn: &Connection, program_id: &str) -> Result<Vec<FindingRow>> {
    let mut stmt = conn.prepare(
        "SELECT finding_id, program_id, severity, root_cause, code_signature, title, status \
         FROM findings WHERE program_id = ?1 AND status = 'REGRESSED' ORDER BY severity DESC",
    )?;
    let rows = stmt
        .query_map(params![program_id], |r| {
            Ok(FindingRow {
                finding_id: r.get(0)?,
                program_id: r.get(1)?,
                severity: r.get(2)?,
                root_cause: r.get(3)?,
                code_signature: r.get(4)?,
                title: r.get(5)?,
                status: r.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Serialize)]
pub struct ProtocolProfile {
    pub program_id: String,
    pub protocol_class: String,
    pub trust_assumptions_json: String,
    pub oracle_set: String,
    pub admin_set: String,
    pub notes: String,
}

#[derive(Debug, Serialize)]
pub struct InvariantRow {
    pub inv_id: i64,
    pub program_id: String,
    pub protocol_class: String,
    pub statement: String,
    pub source_fn: String,
    pub cited_line: String,
    pub status: String,
}

/// The warm-start context block returned for a re-audit.
#[derive(Debug, Serialize)]
pub struct WarmContext {
    pub profile: Option<ProtocolProfile>,
    pub invariants: Vec<InvariantRow>,
    pub open_fp_rulings: Vec<RulingRow>,
}

/// Assemble the warm-start context for `program_id`: its protocol profile,
/// recorded invariants, and any standing false-positive/accepted-risk rulings.
pub fn warm(conn: &Connection, program_id: &str) -> Result<WarmContext> {
    let profile = conn
        .query_row(
            "SELECT program_id, protocol_class, trust_assumptions_json, oracle_set, admin_set, notes \
             FROM protocol_profile WHERE program_id = ?1",
            params![program_id],
            |r| {
                Ok(ProtocolProfile {
                    program_id: r.get(0)?,
                    protocol_class: r.get(1)?,
                    trust_assumptions_json: r.get(2)?,
                    oracle_set: r.get(3)?,
                    admin_set: r.get(4)?,
                    notes: r.get(5)?,
                })
            },
        )
        .optional()?;

    let mut inv_stmt = conn.prepare(
        "SELECT inv_id, program_id, protocol_class, statement, source_fn, cited_line, status \
         FROM invariants WHERE program_id = ?1 ORDER BY inv_id",
    )?;
    let invariants = inv_stmt
        .query_map(params![program_id], |r| {
            Ok(InvariantRow {
                inv_id: r.get(0)?,
                program_id: r.get(1)?,
                protocol_class: r.get(2)?,
                statement: r.get(3)?,
                source_fn: r.get(4)?,
                cited_line: r.get(5)?,
                status: r.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let mut ruling_stmt = conn.prepare(
        "SELECT ruling_id, program_id, code_signature, ruling, rationale, ruled_by, ruled_at, scope \
         FROM fp_rulings WHERE program_id = ?1 ORDER BY ruling_id DESC",
    )?;
    let open_fp_rulings = ruling_stmt
        .query_map(params![program_id], |r| {
            Ok(RulingRow {
                ruling_id: r.get(0)?,
                program_id: r.get(1)?,
                code_signature: r.get(2)?,
                ruling: r.get(3)?,
                rationale: r.get(4)?,
                ruled_by: r.get(5)?,
                ruled_at: r.get(6)?,
                scope: r.get(7)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(WarmContext {
        profile,
        invariants,
        open_fp_rulings,
    })
}
