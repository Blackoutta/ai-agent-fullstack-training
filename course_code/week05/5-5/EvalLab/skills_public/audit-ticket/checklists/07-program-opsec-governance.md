# 07 — OpSec & Governance Checklist

> Domain: Operational Security, Program Deployment, Governance  
> Severity if missed: CRITICAL to HIGH  
> References: Solana program upgrade authority, Squads multisig, timelock patterns

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 7.1 — Program Upgrade Authority

- [ ] **OPS-001**: What is the current upgrade authority of the deployed program? (run `solana program show <PROGRAM_ID>`)
- [ ] **OPS-002**: Is the upgrade authority a multisig (e.g., Squads v3/v4)? If it's a single wallet — flag as HIGH
- [ ] **OPS-003**: How many signers are required on the multisig? Verify threshold (e.g., 2/3, 3/5)
- [ ] **OPS-004**: Who are the individual signers on the multisig? Are they different entities?
- [ ] **OPS-005**: Are the multisig signers on hardware wallets (Ledger, etc.) or hot wallets?
- [ ] **OPS-006**: Is there a timelock on program upgrades? How many hours/days?
- [ ] **OPS-007**: If there is a timelock — is it enforced on-chain or just a team policy?
- [ ] **OPS-008**: Recommended minimum timelock: 24 hours for DeFi programs, 72 hours for critical infrastructure
- [ ] **OPS-009**: Can the upgrade authority be changed? Who can change it?
- [ ] **OPS-010**: Is the program set to non-upgradeable (immutable)? If not, should it be? Document reasoning
- [ ] **OPS-011**: If program is upgradeable — can a malicious upgrade drain all funds? (Yes, by definition — hence multisig + timelock)
- [ ] **OPS-012**: Is there a process for emergency upgrades that bypass the timelock? If yes, what are the safeguards?

## 7.2 — Backdoor Detection

- [ ] **OPS-013**: Search for hidden admin instructions — any instruction that accepts a hardcoded admin pubkey (not visible in docs/IDL)
- [ ] **OPS-014**: Search for "god mode" accounts — any account that can bypass all access control checks
- [ ] **OPS-015**: Search for conditional logic based on specific pubkeys: `if account.key() == Pubkey::new_from_array([...])` hidden checks
- [ ] **OPS-016**: Search for unused instruction handlers that could be invoked — dead code that's still callable
- [ ] **OPS-017**: Verify IDL matches the actual program binary — no undisclosed instructions
- [ ] **OPS-018**: Check for instructions that can modify the Treasury pubkey to redirect fees
- [ ] **OPS-019**: Check for instructions that can modify the Jupiter/DEX program ID to redirect swaps
- [ ] **OPS-020**: Check for instructions that can change fund manager without investor consent
- [ ] **OPS-021**: Check for instructions that can mint shares without deposit (share dilution)
- [ ] **OPS-022**: Check for instructions that can burn shares without withdrawal (theft)
- [ ] **OPS-023**: Search for `unsafe` blocks in Rust code — any usage must be documented and justified
- [ ] **OPS-024**: Search for raw pointer manipulation (`*const`, `*mut`) — should not exist in Anchor programs
- [ ] **OPS-025**: Check `declare_id!` matches between code and Anchor.toml — mismatch could mean wrong program
- [ ] **OPS-026**: Verify program binary matches published source code (verifiable builds)

## 7.3 — Key Management

- [ ] **OPS-027**: Deploy keypair — is it on a hardware wallet for mainnet?
- [ ] **OPS-028**: Deploy keypair — is it stored securely (not in repo, not on dev machine in plaintext)?
- [ ] **OPS-029**: Manager wallets — are they on hardware wallets or multisig for mainnet?
- [ ] **OPS-030**: Backend server wallet (if exists) — is it the minimum-privilege wallet?
- [ ] **OPS-031**: Backend server wallet — does it hold significant SOL/tokens? (Should only hold gas)
- [ ] **OPS-032**: API keys (Helius, Jupiter, etc.) — are they rotated regularly?
- [ ] **OPS-033**: API keys — are they scoped to minimum required permissions?
- [ ] **OPS-034**: RPC endpoint — is it a dedicated RPC (Helius/Triton) not the public endpoint?
- [ ] **OPS-035**: RPC endpoint — is the API key exposed in frontend code?
- [ ] **OPS-036**: Has any key ever been committed to git? Check `GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false log --all --oneline --no-textconv --no-ext-diff -S "secret_string"` patterns (OUTPUT-RULES Rule 11c flags)

## 7.4 — Multisig Configuration

- [ ] **OPS-037**: Is a multisig used for on-chain operations? Which platform? (Squads, Goki, Marinade, custom)
- [ ] **OPS-038**: Multisig threshold — is it > 50% of total signers? (e.g., 2/3 minimum)
- [ ] **OPS-039**: Multisig — does any single signer have disproportionate power?
- [ ] **OPS-040**: Multisig — are there backup signers in case one is compromised or unavailable?
- [ ] **OPS-041**: Multisig — can a single compromised signer change the threshold to 1/N?
- [ ] **OPS-042**: Multisig — is there a proposal expiry? Can old proposals be executed weeks later?
- [ ] **OPS-043**: Multisig — are executed transactions logged and auditable?

## 7.5 — Incident Response

- [ ] **OPS-044**: Is there a documented incident response plan?
- [ ] **OPS-045**: Can the program be paused in an emergency? By whom? How quickly?
- [ ] **OPS-046**: Is there a bug bounty program? (Immunefi, HackerOne, or self-hosted)
- [ ] **OPS-047**: Is there a security contact (security@domain.com, SECURITY.md in repo)?
- [ ] **OPS-048**: Are there monitoring alerts for large value movements from fund PDAs?
- [ ] **OPS-049**: Are there monitoring alerts for program upgrade transactions?
- [ ] **OPS-050**: Are there monitoring alerts for unusual transaction patterns (many withdrawals, large swaps)?
- [ ] **OPS-051**: Is there a war room process? Who needs to be contacted and in what order?
- [ ] **OPS-052**: Post-incident: is there a process for post-mortem analysis?

## 7.6 — Timelock Analysis

- [ ] **OPS-053**: List ALL actions that are time-locked and their durations
- [ ] **OPS-054**: Program upgrades — timelock duration: _____ hours/days
- [ ] **OPS-055**: Fee changes — timelock duration: _____ hours/days (or "none" — flag if none)
- [ ] **OPS-056**: Manager changes — timelock duration: _____ hours/days (or "none")
- [ ] **OPS-057**: Whitelist changes — timelock duration: _____ hours/days (or "none")
- [ ] **OPS-058**: Treasury address changes — timelock duration: _____ hours/days (should be "immutable")
- [ ] **OPS-059**: Emergency bypass for timelock — what triggers it? How many signers?
- [ ] **OPS-060**: Transaction cancellation — can a time-locked transaction be cancelled before execution?
- [ ] **OPS-061**: Users notified of pending time-locked changes? (On-chain event, frontend alert, Discord)

## 7.7 — Access Segregation

- [ ] **OPS-062**: Dev, staging, and production environments use completely separate keys
- [ ] **OPS-063**: No developer has production deploy access from their personal machine
- [ ] **OPS-064**: CI/CD pipeline — does it auto-deploy? If yes, what are the safeguards?
- [ ] **OPS-065**: Server access — SSH keys rotated, 2FA enabled, access logging
- [ ] **OPS-066**: Database access — separate credentials per environment, no shared passwords
- [ ] **OPS-067**: Wallet private keys — never in CI/CD environment variables in plaintext
- [ ] **OPS-068**: Secret manager used? (AWS Secrets Manager, Vault, doppler, etc.)

## 7.8 — Source Code Integrity

- [ ] **OPS-069**: Is the program source code open source?
- [ ] **OPS-070**: Does the published source match the deployed binary? (Verifiable builds via `anchor verify`)
- [ ] **OPS-071**: Can the audit check be reproduced? (`anchor build` produces same binary)
- [ ] **OPS-072**: Is the git history clean? (No force-pushes that remove commit history)
- [ ] **OPS-073**: Are there branch protection rules? (No direct push to main, required reviews)
- [ ] **OPS-074**: Is the CI/CD pipeline itself secured? (No PR can modify CI to skip checks)
- [ ] **OPS-075**: Dependencies are version-pinned (no `^` or `~` in Cargo.toml for critical deps)

## 7.9 — Stake & Pre-Signed Governance Safety

- [ ] **OPS-076**: Stake-account **Staker** AND **Withdrawer** authority changes are monitored and allowlisted with **equal severity** — a Staker-only `Authorize` (Withdrawer untouched) must not slip past withdrawal-focused monitoring, and batched authorize instructions are inspected (cross-ref KV-118)
- [ ] **OPS-077**: Admin/governance instructions must NOT be reachable via durable-nonce pre-signed transactions that outlive the authorizing context — privileged paths are recent-blockhash-only (or version/epoch-guarded so a multisig migration invalidates stale pre-signed txs), plus a timelock and an aggregate-outflow circuit breaker (cross-ref KV-119)
- [ ] **OPS-085**: Privileged-instruction legibility at the signing council — are privileged/admin/authority-transfer instructions rendered HUMAN-READABLE at the multisig/governance signing surface (decoded or simulated at approval time, showing the target program, the instruction, and the mutated authority/value), AND is a decoder bot broadcasting the parsed admin action publicly during the timelock window so signers and the community can see what is being approved before it lands? (PASS: the signing UI decodes/simulates the instruction rather than presenting opaque bytes, a timelock separates approval from execution, and a public decode of the pending action is broadcast during that window; no opaque `set_authority`/upgrade path can be approved sight-unseen; FAIL: the council approves raw, unparsed instruction bytes — the proximate enabler of the Drift incident, where an opaque privileged instruction was signed at the council. This is COUNCIL-side blind-signing and is distinct from end-user and autonomous-agent wallet blind-signing (KV-067 / KV-113), which concern a single principal's wallet rather than a multisig approving on behalf of the protocol.)

## 7.10 — Authority Rotation, Treasury & Config Hardening

- [ ] **OPS-078**: Admin authority is rotatable via a two-step `propose_admin`/`accept_admin` handshake backed by a `pending_admin: Option<Pubkey>` field (a single immutable admin is a SPOF), and Critical rotation/action paths are gated by a timelock (SSB §24.2)
- [ ] **OPS-079**: Fee/treasury account is validated at config-time for token-receiving capability (ATA compatibility) AND has a valid access-controlled sweep path — funds are recoverable via an authorized route, not merely pinned to an immutable address with no way out (SSB §31.4)
- [ ] **OPS-080**: Config-update APIs use a tri-state `Patch<T> { Unchanged, Set, Clear }` rather than an `Option<T>` that conflates "not provided" with "clear to zero"; every config write-path validates new values against each other atomically; permissionless init decouples the creator identity from privileged authority and requires explicit authority acceptance (namespace-capture, SSB §29)
- [ ] **OPS-081**: Verify the LIVE on-chain multisig threshold by fetching the account — confirm the actual configured threshold is ≥ ceil(N/2)+1, not just that a threshold field exists in the schema (Saga DAO 1-of-12 misconfig, $60K)

## 7.11 — Admin / Config Parameter Bounds & Interdependencies

> Admin- and governance-set numeric parameters are a recurring high/critical surface: a value with no upper (or lower) bound, interdependent values validated one at a time so a valid-looking pair is mutually inconsistent, and a zero that later becomes a divisor or a degenerate curve. The write is fully authorized — the bug is that the setter accepts a value the rest of the program cannot safely consume. Enumerate every admin/config `set_*`/`update_*` path and its numeric inputs. Grep hints:
> ```
> grep -rn --include="*.rs" -iE "set_|update_config|update_params|admin|governance|fee|weight|rate|ratio|threshold|min_|max_|buffer|require!|assert" programs/
> ```

- [ ] **OPS-082**: Every admin/config numeric has an enforced MIN and MAX — each settable parameter (fee bps, collateral/risk weight, LTV, rate, buffer, threshold, decimals, count) is validated at write-time against both a lower and an upper bound that the downstream math actually tolerates; no parameter is accepted merely because it deserializes. (PASS: `require!(v >= MIN && v <= MAX, ...)` (or a bounded range) on every setter, with the bounds derived from what consumers can safely use; FAIL: a fee/weight/rate with only a one-sided check or none — e.g. a risk weight settable above 1.0 inflates borrowing power. Accretion MarginFi: emode weight settable `> 1.0`.)
- [ ] **OPS-083**: Interdependent config values are cross-validated atomically at write-time — when parameters constrain each other (`min < max`, `cliff <= duration`, `initial_reserve` vs `threshold`, `buffer` vs `sqrt_price`, tier ordering), the setter validates the WHOLE resulting config as a unit against the incoming params in the same instruction, not each field independently or against stale state read later. (PASS: full consistency asserted atomically from the update params before commit; FAIL: fields set/checked piecemeal so an individually-valid write produces a mutually-inconsistent config. Zenith Meteora: sqrt-price buffer relationship; Sec3 Invariant: tick parameter consistency.)
- [ ] **OPS-084**: A zero that would cause div-by-zero or degenerate math is rejected — any config value used as a denominator, a scaling base, a supply, a duration, or a tick/precision unit is validated `!= 0` (and above any minimum that avoids degenerate math) at write-time, so it cannot brick or trivially skew a later instruction. (PASS: explicit non-zero / minimum guard on every parameter that feeds a division or a curve base; FAIL: a settable duration/divisor/tick accepts `0`, panicking (`div-by-zero`) or producing degenerate pricing on the next use. Halborn Raydium: vesting div-by-zero from a zero duration / cliff config.)

## 7.12 — Governance Timelocks & Signing Windows at 200 ms Slots (SIMD-0525)

> The timelock is the control that gives the community time to catch a malicious proposal (BonkDAO, Jul 2026: a hidden treasury transfer inside BIP-76). A timelock stored in slots or epochs silently halved on Oct 9, 2026. The shorter blockhash window (150 blocks ≈ 30 s) also pushes cold-signing flows toward durable nonces, the Drift vector. See KV-138, KV-119.

- [ ] **OPS-086**: Governance, upgrade and treasury timelocks, voting periods and hold-up times denominated in slots or epochs (spl-governance stores seconds; custom programs, forks and Realms plugins often store slots) are converted at 200 ms and compared with the written policy, and the effective delay still gives the community the wall-clock reaction window the policy promises. (PASS: seconds, or slot / epoch values doubled at activation with a governance record; FAIL-8: a 432,000-slot "48 h" timelock that is now 24 h, a direct downgrade of the control that would have exposed a hidden-clause proposal.)
- [ ] **OPS-087**: Multisig, hardware-wallet and air-gapped approval flows that cannot sign and land within the ~30 s blockhash lifetime use a protocol-native proposal / transaction buffer (Squads-style, executed on-chain after approval) rather than pre-signed durable-nonce transactions; where durable nonces are used, the KV-119 controls hold (nonce-authority custody, inventory of outstanding pre-signed transactions, execution timelock, signer verification of the full message). (PASS: buffer-based flow, or nonces with those controls; FAIL: the team's answer to the shorter window was "switch to durable nonces" without them, which recreates the pre-signed admin-transaction setup behind the Drift drain ($285M, Apr 2026).)
