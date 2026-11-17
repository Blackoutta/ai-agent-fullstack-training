# Checklist 16 — Formal Verification & Testing Quality

> **Items:** 72  |  **IDs:** FV-001 → FV-072  
> **Applies to:** All languages, all repository types  
> **Sources:** CertiK formal verification methodology, EY QA/processing integrity, OWASP A06 (Insecure Design), OWASP A10 (Mishandling of Exceptional Conditions)

---

## 16.1 Formal Verification & Property Testing (FV-001 → FV-012)

| ID | Check | Severity |
|----|-------|----------|
| FV-001 | Critical state invariants are documented (e.g. "total shares == sum of all investor shares") | 7 |
| FV-002 | Invariant properties are encoded as assertions or property-based tests | 7 |
| FV-003 | Every arithmetic identity the protocol relies on has a proof or exhaustive test | 8 |
| FV-004 | State transition properties are specified: from every valid state, only valid transitions can occur | 7 |
| FV-005 | No reachable state violates documented invariants (tested via model checking or fuzzing) | 8 |
| FV-006 | Token conservation property verified: tokens in == tokens out across all instruction paths | 9 |
| FV-007 | Authority properties verified: only authorized signers can reach privileged instructions | 8 |
| FV-008 | Liveness properties checked: every initiated process can reach completion (no deadlocks) | 6 |
| FV-009 | Formal specs (if any) are kept in sync with code — spec drift is tracked | 5 |
| FV-010 | Mathematical proofs are machine-checked (Coq, Lean, SMT solver) when claiming "proven" | 6 |
| FV-011 | Custom formal verification properties are documented alongside the code they verify | 4 |
| FV-012 | Verification results are included in audit reports with pass/fail status | 3 |

---

## 16.2 Static Analysis (FV-013 → FV-022)

| ID | Check | Severity |
|----|-------|----------|
| FV-013 | At least one static analysis tool runs in CI (e.g. Clippy, ESLint security rules, Semgrep, Slither) | 5 |
| FV-014 | Static analysis findings are triaged — no unreviewed suppressions | 5 |
| FV-015 | Custom lint rules enforce project conventions (e.g. no `any`, no `unwrap` in production) | 4 |
| FV-016 | Compiler/linter warnings are treated as errors in CI — zero-warning policy | 4 |
| FV-017 | Security-focused rulesets are enabled (e.g. `clippy::pedantic`, `eslint-plugin-security`) | 5 |
| FV-018 | Dead code detection is enforced — unused functions/imports are flagged | 3 |
| FV-019 | Dependency vulnerability scanning runs in CI (e.g. `cargo audit`, `npm audit`, `safety`) | 6 |
| FV-020 | SAST (Static Application Security Testing) covers all production languages in the repo | 5 |
| FV-021 | No static analysis suppression comments without a justification comment | 4 |
| FV-022 | Static analysis config files are version-controlled and reviewed on change | 3 |

---

## 16.3 Fuzz Testing (FV-023 → FV-032)

| ID | Check | Severity |
|----|-------|----------|
| FV-023 | Fuzz testing is implemented for all parsing/deserialization functions | 6 |
| FV-024 | On-chain instruction handlers have fuzz targets covering malicious inputs | 7 |
| FV-025 | Fuzz corpus is persisted and grows over time (not regenerated from scratch each run) | 4 |
| FV-026 | Fuzz campaigns have run for meaningful duration (not just quick smoke tests) | 5 |
| FV-027 | Crashes found by fuzzing are triaged, fixed, and regression tests added | 7 |
| FV-028 | Differential fuzzing is used where two implementations should agree (e.g. old vs new version) | 5 |
| FV-029 | Fuzz testing covers arithmetic edge cases: MAX, MIN, 0, 1, near-overflow values | 6 |
| FV-030 | API endpoints are fuzzed with malformed/oversized/unexpected payloads | 6 |
| FV-031 | Serialization round-trip fuzz: encode → decode → re-encode produces identical bytes | 5 |
| FV-032 | Fuzz testing infrastructure is documented and reproducible | 3 |

---

## 16.4 Test Coverage & Quality (FV-033 → FV-046)

| ID | Check | Severity |
|----|-------|----------|
| FV-033 | Test coverage is measured and reported (line coverage, branch coverage) | 4 |
| FV-034 | Critical paths (fund creation, deposit, withdrawal, swap) have ≥ 90% branch coverage | 6 |
| FV-035 | Unit tests exist for every public function/instruction | 5 |
| FV-036 | Integration tests cover multi-step workflows (e.g. create → deposit → swap → withdraw) | 6 |
| FV-037 | Edge case tests: zero amounts, max amounts, empty collections, boundary values | 6 |
| FV-038 | Negative tests: unauthorized callers, invalid states, rejected transactions | 7 |
| FV-039 | Regression tests exist for every previously-found bug | 5 |
| FV-040 | Tests run in CI on every PR — no merge without green tests | 6 |
| FV-041 | Test environment mirrors production config (same runtime version, same flags) | 4 |
| FV-042 | Flaky tests are tracked and fixed — no tests in permanent skip/ignore state without justification | 3 |
| FV-043 | Mutation testing has been run at least once to validate test suite effectiveness | 3 |
| FV-044 | Performance/load tests exist for critical endpoints to prevent DoS via expensive operations | 5 |
| FV-045 | Tests do not use hardcoded secrets, private keys, or real credentials | 7 |
| FV-046 | Test data is deterministic or seeded — tests are reproducible across environments | 3 |

---

## 16.5 Error Handling as Security Boundary (FV-047 → FV-058)

> **Source:** OWASP A10:2025 — Mishandling of Exceptional Conditions

| ID | Check | Severity |
|----|-------|----------|
| FV-047 | All external calls (network, DB, filesystem, CPI) have explicit error handling | 6 |
| FV-048 | Error messages do not leak internal paths, versions, stack traces, or database schemas | 5 |
| FV-049 | Panics/unhandled exceptions in production code are caught at the boundary and logged | 6 |
| FV-050 | Errors are distinguished: client errors (4xx) vs server errors (5xx) — no catch-all 500 | 4 |
| FV-051 | Resource exhaustion is handled gracefully: OOM, disk full, connection pool exhausted | 5 |
| FV-052 | Timeout handling exists for all external calls — no unbounded waits | 6 |
| FV-053 | Partial failure in multi-step operations is handled (rollback, compensation, or idempotent retry) | 7 |
| FV-054 | Error handling does not silently swallow errors — all catch blocks log or propagate | 5 |
| FV-055 | On-chain programs return specific error codes, not generic "ProgramError" | 4 |
| FV-056 | Error types are exhaustive — match/switch on error kinds covers all variants | 4 |
| FV-057 | Circuit breakers or fallbacks exist for critical external dependencies | 5 |
| FV-058 | Exceptional conditions in financial math (divide-by-zero, negative balances) are blocked, not wrapped | 8 |

---

## 16.6 On-Chain Test-Suite Verification — LiteSVM / Mollusk (FV-059 → FV-070)

> **Source:** LiteSVM / Mollusk in-process SVM testing methodology *(adapted from safe-solana-builder `references/litesvm.md`)*
> **Applies to:** Solana programs (Anchor / native / Pinocchio). Verify the **test suite itself** exercises these paths — a passing suite that never tests the failure side proves nothing.

| ID | Check | Severity |
|----|-------|----------|
| FV-059 | An in-process SVM suite (LiteSVM or Mollusk) exists and loads the actual compiled `.so` (built via `cargo build-sbf`), not a mock | 6 |
| FV-060 | Every time-locked / deadline instruction is tested on **both** sides: a before-deadline path that must fail AND an after-deadline path that must succeed | 8 |
| FV-061 | Time-dependent logic is tested via sysvar/clock control (`set_sysvar(Clock)` / `warp_to_slot`), not by real wall-clock waiting | 6 |
| FV-062 | Account-closure is verified on all three fields after close: `lamports == 0`, `data.len() == 0`, and `owner == system_program` (not just lamports) | 7 |
| FV-063 | Re-initialization is tested: double-initializing an existing account must fail (reinit-guard / `init` semantics proven) | 7 |
| FV-064 | Authorization negatives are tested: a wrong / missing signer causes the transaction to fail | 7 |
| FV-065 | Arithmetic edge cases are tested through the SVM: zero-amount, over-limit, and near-overflow inputs are rejected | 6 |
| FV-066 | Token balances are asserted with explicit `assert_eq!` after every transfer path (not merely "tx succeeded") | 5 |
| FV-067 | CU consumption is profiled and recorded for at least the initialize, primary action, and close instructions (regression baseline) | 4 |
| FV-068 | `expire_blockhash()` (or equivalent blockhash advance) is called after each send in multi-transaction tests — no reliance on a stale blockhash | 4 |
| FV-069 | Failure-path tests do NOT `unwrap()` the send result; they assert `result.is_err()` (and, where relevant, the specific `InstructionError`) | 5 |
| FV-070 | PDA derivations in tests use the same seeds as on-chain (documented in comments), and devnet/mainnet account replay is used only for fixtures — never for security-critical assertions | 4 |

---

## 16.7 Solana-Native Verification Tooling — Is the Suite Appropriate to the Risk? (FV-071 → FV-073)

> **Source:** Solana verification/fuzzing ecosystem. Turns "does a fuzz/FV suite even exist, and is it the right one?" into an actionable check. Verify the suite uses **at least one** tool appropriate to the protocol's risk profile — high-value DeFi math warrants equivalence/invariant proving, not just a unit-test smoke pass.

| ID | Check | Severity |
|----|-------|----------|
| FV-071 | The project uses at least one Solana-appropriate verification/fuzzing tool matched to its risk: **Trident** (stateful/guided fuzzing of instruction sequences), **Crucible** (sBPF invariant fuzzing, no source needed), **Riverguard** (mainnet-transaction mutation replay), **Certora CVL** (equivalence + invariant induction — expected for high-value DeFi math), **Kani** (bounded model-checking proofs), or **Mollusk/LiteSVM** (fast in-process harness). A high-value protocol whose only "verification" is a handful of happy-path unit tests fails this item. | 6 |
| FV-072 | The suite exercises the **current transaction format**: readers / indexers round-trip a fixture block containing a v1 transaction (`maxSupportedTransactionVersion: 1`, `transactionConfig` persisted with correct units); fee sponsors / co-signers are tested with a v1 transaction whose fee lives in the config and which carries no-op ComputeBudget instructions (must be rejected above cap); on-chain programs are run under a runtime with the v1 gate active (`solana-test-validator` ≥ 4.2 / Surfpool ≥ 1.5) so 4,096-byte transactions and no-op budget instructions are covered (see KV-135 / KV-136) | 5 |
| FV-073 | Time-dependent tests model wall-clock, not slot counts: when a test advances time (`warp_to_slot`, `set_sysvar(Clock)`), `unix_timestamp` advances consistently with the live slot duration (200 ms since Oct 2026), and at least one test asserts each security-relevant duration (timelock, cliff, staleness bound, rate-limit window, interest accrued per year) in **seconds** against the documented policy, so the suite cannot pass with a timelock that is half as long on mainnet or an interest constant that accrues 2.5x the configured APR (see KV-138, SM-073, ECON-090) | 6 |
