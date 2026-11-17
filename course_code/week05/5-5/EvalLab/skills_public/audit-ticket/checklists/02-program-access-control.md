# 02 — Access Control Checklist

> Domain: On-chain Solana Program  
> Severity if missed: CRITICAL to HIGH  
> References: Sealevel "Missing Signer Check", QEDGen AC properties, Anchor Signer type

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 2.1 — Signer Verification

- [ ] **AC-001**: Every instruction that moves tokens, SOL, or lamports has at least one `Signer<'info>` in its accounts struct
- [ ] **AC-002**: Every instruction that modifies on-chain state has at least one `Signer<'info>` — no permissionless state mutation
- [ ] **AC-003**: The signer's pubkey is linked to a state field via `has_one` (e.g., `has_one = manager` on Fund account)
- [ ] **AC-004**: No instruction relies solely on passing an account as `AccountInfo` and checking `is_signer` manually (prefer Anchor `Signer<'info>`)
- [ ] **AC-005**: If manual `is_signer` check is used, it's a hard `require!(account.is_signer, Error)`, not an if-else that silently skips
- [ ] **AC-006**: Admin/manager instructions: `manager: Signer<'info>` AND `fund: Account<'info, Fund>` with `has_one = manager`
- [ ] **AC-007**: Investor instructions: `investor: Signer<'info>` AND position/withdrawal with `has_one = investor`
- [ ] **AC-008**: Delegate instructions: delegate signer is validated against `token_account.delegate == Some(delegate.key())`
- [ ] **AC-009**: No instruction allows a third party to act on behalf of a signer without explicit delegation mechanism
- [ ] **AC-010**: There is no instruction callable by anyone (permissionless) that can move value — if one exists, document why

## 2.2 — Role-Based Access Control

- [ ] **AC-011**: List all roles in the program (manager, investor, delegate, admin, anyone) and map each instruction to exactly one role
- [ ] **AC-012**: No instruction has ambiguous role — "manager OR investor" must be explicitly documented and justified
- [ ] **AC-013**: Role escalation: can a non-manager call a manager instruction by spoofing accounts? Verify each manager instruction
- [ ] **AC-014**: Role escalation: can a non-investor call an investor instruction by spoofing position accounts?
- [ ] **AC-015**: Admin role (if exists): how is admin defined? Hardcoded pubkey? Program authority? Multisig?
- [ ] **AC-016**: If admin role exists, what can admin do? Can admin drain funds? Can admin pause/unpause?
- [ ] **AC-017**: Is there a "superadmin" or "god mode" that bypasses all checks? Document and flag
- [ ] **AC-018**: Fund manager cannot impersonate an investor (manager key ≠ investor key check if needed)
- [ ] **AC-019**: Investor cannot impersonate the manager (investor key ≠ manager key for manager-only operations)

## 2.3 — Permission Boundaries

- [ ] **AC-020**: Manager can only operate on their own fund (not another manager's fund)
- [ ] **AC-021**: Investor can only operate on their own position (not another investor's position)
- [ ] **AC-022**: Manager cannot directly withdraw investor funds (only through fee mechanism)
- [ ] **AC-023**: Manager fee percentage has a maximum cap enforced on-chain
- [ ] **AC-024**: Manager cannot change fee after fund creation (or changes are time-locked)
- [ ] **AC-025**: Treasury address is validated on every fee transfer — cannot be changed to attacker-controlled address
- [ ] **AC-026**: Treasury address is hardcoded or stored in an immutable configuration — not a mutable field
- [ ] **AC-027**: Platform fee minimum is enforced (`admin_fee >= minimum`) — manager cannot set it to zero
- [ ] **AC-028**: No instruction allows transferring fund PDA ownership from one manager to another without governance
- [ ] **AC-029**: Whitelist management (if exists) — only authorized role can add/remove programs

## 2.4 — Freeze & Pause Mechanisms

- [ ] **AC-030**: Is there a pause mechanism? (`fund.paused` flag or similar)
- [ ] **AC-031**: If pause exists, who can trigger it? (Should be restricted to manager/admin)
- [ ] **AC-032**: If pause exists, does it actually prevent all value-moving operations?
- [ ] **AC-033**: If pause exists, can manager still withdraw their own fees while paused? (Should they?)
- [ ] **AC-034**: If pause exists, can investors still withdraw while paused? (Should they — emergency exit?)
- [ ] **AC-035**: If NO pause mechanism exists — flag as LOW/MEDIUM finding (no emergency stop)
- [ ] **AC-036**: Can the program be frozen by Solana (freeze authority on mint)? Is freeze authority set?
- [ ] **AC-037**: Shares mint — who is the mint authority? Is it the fund PDA? Can anyone else mint shares?
- [ ] **AC-038**: Shares mint — is there a freeze authority? If yes, who controls it?

## 2.5 — Anti-Griefing on Access Control

- [ ] **AC-039**: Can an attacker front-run an account creation to claim the PDA first? (Seed collision with attacker-controlled data)
- [ ] **AC-040**: Can an attacker create a position in a fund that doesn't accept their wallet?
- [ ] **AC-041**: Can an attacker block withdrawals by manipulating shared state?
- [ ] **AC-042**: Can an attacker force-close another user's accounts?
- [ ] **AC-043**: Can an attacker trigger instructions on behalf of other users by replaying old transactions? (Solana inherently prevents this via recent_blockhash, but check off-chain replay)
- [ ] **AC-044**: Rate limiting: are there any on-chain rate limits (cooldown periods, minimum intervals)?
- [ ] **AC-045**: Can an attacker spam `init` instructions to fill up PDA space or exhaust payer's SOL?

## 2.6 — Cross-Instruction Authority

- [ ] **AC-046**: In multi-instruction transactions, can instruction N's authority context be exploited by instruction N+1?
- [ ] **AC-047**: After an account is closed in instruction N, can instruction N+1 in the same transaction access the closed account's stale data?
- [ ] **AC-048**: CPI called programs — can they callback into the calling program with elevated privileges?
- [ ] **AC-049**: Re-entrancy: does the program guard against re-entrant calls? (Solana's runtime prevents direct re-entrancy but CPI callbacks can simulate it)
- [ ] **AC-050**: If program uses `invoke_signed`, verify the seeds cannot be guessed/replicated by another program

## 2.7 — Off-Chain-Signed Authority Grants & Admin-Set Mutation

> Real-world: Rain white-label card contract, Aug 2026 — a crafted `AddCollateralAdmin` signature bundle against an outdated deployment granted the attacker admin over 1,100+ user collateral accounts (~$1.1M drained across Avici, Tria and other tenants). Cross-ref KV-137, KV-101/102.

- [ ] **AC-051**: Enumerate every instruction that grants, extends or transfers a privilege (add admin / operator / delegate / collateral-admin, set authority, grant role). Each one requires an existing **higher on-chain authority as `Signer`** — flag any privilege grant reachable with only an off-chain-signed message or "signature bundle"
- [ ] **AC-052**: Where signed-message authorization is used (ed25519/secp256k1 precompile + instructions-sysvar introspection), the signed payload binds ALL of: program ID, instruction discriminator, target account keys, an expiry, and a single-use nonce that is consumed on-chain — a signature missing any binding can be replayed or redirected to other accounts
- [ ] **AC-053**: Batch / bundle admin operations: every element of the bundle is individually validated against the signed payload — one valid signature must never authorize N unverified mutations appended to the same bundle
- [ ] **AC-054**: Membership of every admin/operator set is bounded, revocable, and every addition emits an event that feeds monitoring/alerting — an unexpected admin addition is detected in minutes, not at drain time
- [ ] **AC-055**: Blast-radius check: no single granted credential controls ALL user sub-accounts (collateral accounts, card balances, positions). Admin scopes are per-account, per-market or per-cohort, so one compromised grant bounds the loss
