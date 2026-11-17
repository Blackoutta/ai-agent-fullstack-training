# auditor-tools

Host-side static-analysis CLI for Solana/Anchor Rust codebases. Two binaries built
from one library:

- **`audit-scan`** — parse a codebase and emit the *risky surface* as one JSON
  object, so the LLM auditor spends tokens on judgment instead of mechanical
  enumeration.
- **`audit-mem`** — a SQLite findings store for cross-audit memory: exact dedup,
  regression detection, false-positive suppression, and warm re-audits.

This is a plain synchronous CLI — no async runtime, no network. Parsing uses `syn`
with `proc-macro2`'s `span-locations` feature, so every finding carries a real
line number (`node.span().start().line`).

## Build

```bash
cd tools/auditor-tools
cargo build --release
# binaries at target/release/audit-scan and target/release/audit-mem
cargo test          # runs tests/scan_fixture.rs and tests/mem_roundtrip.rs
```

The `rusqlite` dependency uses the `bundled` feature — it compiles SQLite from
source (`cc` required), so there is no system-library dependency.

## `audit-scan`

```
audit-scan <path> [--out FILE] [--pretty]
```

Recursively walks `*.rs` files under `<path>` (skipping `target/`, `.git/`,
`node_modules/`), parses each with `syn::parse_file`, and prints one JSON object
to stdout (or to `--out FILE`). `--pretty` uses `serde_json::to_string_pretty`.
Files that fail to parse are skipped (best-effort).

### JSON schema

```jsonc
{
  "root": "string",
  "files_scanned": 0,

  // fns declared directly inside a `#[program]` module. The leading Anchor
  // `Context<..>` parameter is dropped; args are the caller-supplied
  // instruction data.
  "instructions": [
    { "name": "string", "file": "string", "line": 0,
      "args": [ { "name": "string", "ty": "string" } ] }
  ],

  // structs deriving `Accounts`, with each named field's `#[account(...)]`
  // constraints parsed out plus the raw attribute text.
  "accounts_structs": [
    { "name": "string", "file": "string", "line": 0,
      "fields": [
        { "name": "string", "ty": "string", "unchecked": false,
          "constraints": {
            "init": false, "init_if_needed": false, "mut": false, "signer": false,
            "has_one": ["string"],       // each `has_one = X`
            "seeds": ["string"],         // each element of `seeds = [ ... ]`
            "bump": false,
            "close": "string|null",      // `close = X`
            "owner": "string|null",      // `owner = X`
            "token": false,              // any `token::*` (or bare `token`)
            "associated_token": false,   // any `associated_token::*`
            "realloc": false,            // `realloc` or `realloc::*`
            "raw": "the #[account(...)] text"
          } }
      ] }
  ],

  // one entry per field carrying `seeds = [ ... ]`
  "pdas": [
    { "struct": "string", "field": "string", "seeds": ["string"],
      "file": "string", "line": 0 }
  ],

  // RAW binary/compound-assign arithmetic (NOT `.checked_*`). Every site is
  // reported — the auditor decides reachability/guardedness, not the tool.
  "arithmetic_sites": [
    { "file": "string", "line": 0,
      "op": "+|-|*|/|+=|-=|*=|/=", "snippet": "string" }
  ],

  // `.unwrap()`, `.expect(..)`, index exprs `x[y]`, and the
  // `panic!`/`unreachable!`/`unwrap!` macros.
  "panic_sites": [
    { "file": "string", "line": 0, "kind": "unwrap|expect|index|panic",
      "snippet": "string" }
  ],

  "unsafe_blocks": [ { "file": "string", "line": 0 } ],

  // calls to `invoke` / `invoke_signed`, and any use of `CpiContext`.
  "cpi_sites": [
    { "file": "string", "line": 0, "kind": "invoke|invoke_signed|CpiContext",
      "snippet": "string" }
  ],

  // field access on `remaining_accounts` (e.g. ctx.remaining_accounts.get(..)).
  "remaining_accounts_sites": [
    { "file": "string", "line": 0, "snippet": "string" }
  ],

  // every `ItemFn` and `ImplItemFn`.
  "functions": [
    { "name": "string", "file": "string", "line": 0, "pub": false }
  ]
}
```

Snippets are the pretty-printed token stream of the node, whitespace-collapsed and
truncated to ~80 characters.

### Example

```bash
audit-scan ./programs/my-program/src --pretty --out surface.json
```

## `audit-mem`

```
audit-mem [--db PATH] <subcommand>
```

`--db` defaults to `.audit-memory/audit.db` (parent directory auto-created). The
schema is created lazily on any command, so `init` is optional but explicit.

A finding's identity is
`finding_id = sha256(program_id "\n" code_signature "\n" root_cause)` (hex), which
gives exact deduplication across audits.

### Subcommands

| Subcommand | Purpose |
|---|---|
| `init` | Create the schema. |
| `put-finding` | Upsert a finding + append an occurrence. Prints `<STATUS> <finding_id>`, or `REGRESSED <finding_id>` on regression. |
| `set-status` | Set a finding's status (`FIXED` \| `OPEN` \| `ACKNOWLEDGED` \| `DISPUTED`). |
| `rule` | Record a `FALSE_POSITIVE` \| `ACCEPTED_RISK` ruling with a timestamp. |
| `check` | Print `{"suppressed":bool,"ruling":..}`; exit 0 if suppressed by a `FALSE_POSITIVE` ruling, else exit 1. |
| `regressions` | JSON list of findings with status `REGRESSED`. |
| `warm` | JSON `{profile, invariants[], open_fp_rulings[]}` — the warm-start context block for a re-audit. |

**Regression rule:** when `put-finding` re-observes a finding whose stored status
was `FIXED`, the status transitions to `REGRESSED` and the command prints
`REGRESSED <finding_id>`. Brand-new findings start `OPEN`.

### `put-finding` flags

```
--program-id <PID>   --signature <SIG>   --root-cause <RC>   --title <T>   --severity <N>
[--commit <SHA>] [--audit-n <N>] [--file <PATH>] [--line <N>] [--verdict <V>]
```

### Example lifecycle

```bash
audit-mem --db .audit-memory/audit.db init

# first observation -> "OPEN <id>"
audit-mem --db .audit-memory/audit.db put-finding \
  --program-id VaultProg... --signature 'unchecked_sub@vault.balance' \
  --root-cause 'unchecked subtraction can underflow vault balance' \
  --title 'Vault balance underflow' --severity 3 \
  --commit c0ffee1 --audit-n audit-1 --file src/withdraw.rs --line 42 --verdict TRUE_POSITIVE

# after the dev fixes it
audit-mem set-status --program-id VaultProg... --signature 'unchecked_sub@vault.balance' \
  --root-cause 'unchecked subtraction can underflow vault balance' --status FIXED

# next audit re-observes it -> "REGRESSED <id>"
audit-mem put-finding --program-id VaultProg... --signature 'unchecked_sub@vault.balance' \
  --root-cause 'unchecked subtraction can underflow vault balance' \
  --title 'Vault balance underflow' --severity 3 --commit c0ffee3 --audit-n audit-3

# suppress a known false positive, then gate on it
audit-mem rule --program-id VaultProg... --signature 'unchecked_sub@vault.balance' \
  --ruling FALSE_POSITIVE --rationale 'guarded by prior require!' --by auditor
audit-mem check --program-id VaultProg... --signature 'unchecked_sub@vault.balance'
#   -> {"suppressed":true,"ruling":{...}}   (exit 0)
```

### Schema

```
findings(finding_id PK, program_id, first_seen_commit, last_seen_commit,
         severity, root_cause, code_signature, title, status,
         first_audit_n, last_audit_n)
occurrences(finding_id, audit_n, commit_sha, file, line, verdict, rule5b_json)
fp_rulings(ruling_id PK, program_id, code_signature, ruling, rationale,
           ruled_by, ruled_at, scope)
invariants(inv_id PK, program_id, protocol_class, statement, source_fn,
           cited_line, status)
protocol_profile(program_id PK, protocol_class, trust_assumptions_json,
                 oracle_set, admin_set, notes)
```

## How the auditor agents consume this

These tools are an **optional token-efficiency layer**. The audit skill degrades
gracefully — it works without them; they just save context and add memory.

- **`audit-scan` seeds Phase 0 / 0.5.** Run it once against the target codebase and
  feed the JSON to the auditor as the initial map of instructions, account
  constraints, PDAs, arithmetic, panics, and CPIs. The model then reasons about
  reachability and severity instead of grepping the tree.
- **`audit-mem` warm-starts re-audits.** On a repeat audit of the same program,
  `warm --program-id` returns the protocol profile, recorded invariants, and any
  standing false-positive/accepted-risk rulings so prior context is not
  re-derived. `check` auto-suppresses findings previously ruled `FALSE_POSITIVE`,
  and `put-finding` + `regressions` surface anything that was fixed and has since
  regressed.
