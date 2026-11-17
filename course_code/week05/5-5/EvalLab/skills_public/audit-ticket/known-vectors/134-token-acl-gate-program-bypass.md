---
id: 134
title: "Token ACL (SRFC-37) Gate-Program Bypass & Permissionless-Freeze Griefing"
severity: 7
category: crypto
---

### 134 — Token ACL (SRFC-37) Gate-Program Bypass & Permissionless-Freeze Griefing

**Severity: 7** | **Real: SRFC-37 "Efficient Allow/Block List Token Standard" — solana-foundation/token-acl (mainnet program `TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP`, reference gates `always-allow` / `always-block` / `token-acl-gate`, 2026); the standard's own security notes on flag-account verification and permission de-escalation describe the bypass class**

SRFC-37 makes a Token-2022 mint *permissioned* without a transfer hook: the mint uses `DefaultAccountState = Frozen` and **delegates its freeze authority to the Token ACL program**. Anyone can then call `thaw_permissionless` / `freeze_permissionless`; Token ACL CPIs into an issuer-chosen **gate program** (`can_thaw_permissionless` / `can_freeze_permissionless`) and, on success, thaws or freezes the account with the delegated authority. The gate — not the mint — now decides *who may hold the token*, and the decision is reachable by any caller. Three distinct failures ship in this design:

- **Gate bypass (unauthorized thaw).** The gate trusts the `token_account_owner` pubkey Token ACL passes instead of re-deriving the owner from the token account, or trusts allowlist-entry accounts from the resolved extra-account-metas without checking they are canonical PDAs of the gate program. An attacker presents an allowlisted pubkey (or a forged allowlist entry) for a token account *they* own and gets it thawed.
- **Permissionless-freeze griefing (DoS).** The gate implements `can_thaw` correctly but `can_freeze` loosely (or as the same predicate): under an allow-list, `can_freeze` must succeed **only for non-allowlisted owners**. If it succeeds for everyone, any stranger freezes any legitimate holder — including a protocol's vault — for the cost of a transaction. Because the call is permissionless by design, there is no signer to blame and no rate limit.
- **Context spoofing / side-effect abuse.** A gate with side effects (one-time allowances, counters, fee collection, events an indexer trusts) that does not verify the Token ACL **flag account** (owned by Token ACL, data `[1]`, 0 lamports) can be driven directly by anyone, outside Token ACL, to burn allowances or emit fake "thawed" events.

Downstream, integrators inherit a **liveness** surface: every fresh token account of the mint starts frozen, so vault initialization, swap-output ATAs, liquidation payouts and claims must thaw idempotently or surface a clean error; and whoever controls `set_gating_program` (or the gate's upgrade / list-admin key) holds the equivalent of the freeze authority.

> Cross-ref: `references/methodologies/token-2022.md` §9 (G1–G6 gate checks, I1–I4 issuer config, D1–D5 integrator liveness, T12); KV-019 (freeze-authority griefing — the direct-authority ancestor of this vector); KV-023 / KV-105 (transfer-hook and extension abuse — the alternative permissioning design); KV-010 / KV-026 (PDA confusion — forged allowlist entries); KV-107 (fresh ATA assumptions).

#### Verification Procedure

**Step 1: Detect Token ACL usage and the role of this codebase**
```
grep -rn -E "token_acl|token-acl|TACLkU6|MINT_CFG|gating_program|thaw_permissionless|freeze_permissionless|can_thaw_permissionless|can_freeze_permissionless|extra-account-metas|srfc.?37" programs/ apps/ packages/ clients/ 2>/dev/null
grep -rn -E "DefaultAccountState|default_account_state|AccountState::Frozen" programs/ 2>/dev/null
```
- Record: is the codebase a **gate program** (implements `can_*_permissionless`), an **issuer** (creates `MintConfig`, holds `authority`), an **integrator** (accepts / moves an ACL-gated mint), or several. If no marker hits and no accepted mint has `DefaultAccountState=Frozen` with a Token ACL freeze authority, this vector is N/A.

**Step 2 (gate): Flag-account context is verified before any trusted effect**
```
grep -rn -B3 -A12 -E "can_thaw_permissionless|can_freeze_permissionless" programs/ | grep -iE "flag|owner *==|\[1\]|lamports"
```
- ✅ PASS: the handler asserts `flag_account.owner == TOKEN_ACL_PROGRAM_ID` and `flag_account.data == [1]` (and 0 lamports) before returning success, and any side effect (allowance consumed, counter, event) is gated on that check
- ❌ FAIL: no flag check, or the check is done only for logging; a direct call to the gate with a forged flag consumes allowances or emits events
- N/A: the gate is stateless and side-effect-free **and** its result is consumed only by Token ACL (record this explicitly)

**Step 3 (gate): Owner and mint are re-derived from the token account**
```
grep -rn -B3 -A15 -E "can_thaw_permissionless|can_freeze_permissionless" programs/ | grep -iE "StateWithExtensions|unpack|\.owner|\.mint|token_account_owner"
```
- ✅ PASS: the gate unpacks `token_account` (`StateWithExtensions::<Account>::unpack`) and asserts `account.owner == token_account_owner.key()` and `account.mint == mint.key()`; the allow / block decision keys on that derived owner
- ❌ FAIL: the decision keys on the passed `token_account_owner` pubkey without checking it against the token account data — an allowlisted pubkey can be presented for an attacker-owned account

**Step 4 (gate): Thaw and freeze predicates are exact inverses, and extra accounts are canonical**
```
grep -rn -B2 -A20 -E "fn (can_freeze|process_can_freeze|can_thaw|process_can_thaw)" programs/
grep -rn -E "seeds *= *\[|find_program_address|create_program_address" programs/ | grep -iE "allow|block|list|entry|extra"
```
- ✅ PASS: allow-list — `can_thaw` succeeds only for allowlisted owners **and** `can_freeze` succeeds only for non-allowlisted; block-list — the inverse; both directions are covered by tests. Every allowlist / blocklist entry or config account is validated as a canonical PDA (seeds from `(mint, owner)`, program owner, discriminator); the extra-account-metas PDA is authority-gated on write
- ❌ FAIL: `can_freeze` is unconditional or reuses the thaw predicate (anyone freezes anyone); or entry accounts are trusted by position in `remaining_accounts` (forged entry ⇒ thaw)

**Step 5 (issuer): Configuration actually enforces the policy and its admin surface is governed**
```
grep -rn -E "create_config|set_gating_program|set_authority|forfeit_freeze_authority|enable_permissionless" programs/ apps/ scripts/ clients/ 2>/dev/null
```
- ✅ PASS: the mint has `DefaultAccountState=Frozen` **and** its freeze authority is the Token ACL PDA; `gating_program` is non-default and matches the audited gate; `set_gating_program` / `set_authority` / `forfeit_freeze_authority` are behind multisig / timelock and monitored; for block-lists a keeper (or documented reliance on the public) calls `freeze_permissionless` on newly listed owners
- ❌ FAIL: `MintConfig` exists but freeze authority is held elsewhere (decorative ACL); `gating_program == default` with permissionless thaw enabled (effectively permissionless); a single hot key can swap the gate to `always-allow` or forfeit the authority; no enforcement keeper for the block-list

**Step 6 (integrator): Frozen-by-default liveness is handled on every path**
```
grep -rn -B3 -A10 -iE "fn (initialize|init_vault|deposit|swap|liquidate|claim|withdraw|distribute)" programs/*/src/ | grep -iE "thaw|create_associated_token_account|init_if_needed|frozen|AccountState"
```
- ✅ PASS: protocol-owned accounts of the ACL mint are thawed (idempotently) or issuer-allowlisted before first use, with that status tracked and monitored; paths that create a recipient account (swap output, liquidation payout, claim) include `thaw_permissionless_idempotent` or surface a clean, non-wedging error when the recipient is not permitted; a permissionless re-freeze of a protocol account surfaces cleanly (T5) and `MintConfig` changes feed the mint-authority monitor
- ❌ FAIL: first deposit into a fresh vault fails permanently; a swap / liquidation that creates the recipient ATA cannot complete for non-allowlisted counterparties and leaves state half-updated or bad debt; a re-frozen vault triggers a retry loop; the gate's policy is hardcoded as an assumption

**Overall verdict:**
- ✅: Gate verifies the flag context, re-derives owner / mint from the token account, validates entry PDAs, and implements thaw / freeze as exact inverses; issuer config really delegates freeze authority to Token ACL with a governed admin surface; integrator paths thaw idempotently and surface freezes cleanly
- ⚠️: Gate logic is correct but stateless side effects are unflagged, or the issuer's admin keys are governed but unmonitored, or the integrator handles vault thaw but not recipient-account creation on swap / liquidation paths
- ❌: An attacker can thaw an account the policy forbids (owner not re-derived / forged entry), or can freeze any legitimate holder permissionlessly (`can_freeze` not the inverse of `can_thaw`), or the ACL is decorative (freeze authority elsewhere / default gate), or an integrator path is permanently wedged by frozen-by-default accounts
- N/A: No Token ACL / SRFC-37 mint is created, gated or accepted anywhere in scope
