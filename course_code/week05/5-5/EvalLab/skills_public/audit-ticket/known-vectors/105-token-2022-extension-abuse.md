---
id: 105
title: "Token-2022 Extension Abuse (Permanent Delegate / Frozen-Default / Transfer-Fee / Confidential / Mint-Close)"
severity: 8
category: crypto
---

### 105 — Token-2022 Extension Abuse

**Severity: 8** | **Real: Emerging 2024+ surface — Token-2022 (Token Extensions) mint configs that break protocol assumptions**

KV-023 covers transfer hooks. Token-2022 ships many other mint/account extensions that a protocol accepting arbitrary mints must reason about. Each can silently break an invariant a program assumed under classic SPL Token:

- **Permanent Delegate** — the mint authority can move/burn ANY holder's tokens at will, including the protocol's vault. A "deposited" balance is not safe.
- **Default Account State = Frozen** — newly created token accounts start frozen; transfers out can be blocked at will (griefing / locked withdrawals).
- **Transfer Fee** — the amount received is less than the amount sent; naive `amount`-based accounting over/under-credits (overlaps KV-018, but config-driven and changeable).
- **Confidential Transfer** — balances/amounts are hidden; on-chain `amount` reads are not the economic truth.
- **Interest-Bearing** — UI amount drifts from raw amount over time; valuation logic that assumes 1:1 raw↔display is wrong.
- **Mint Close Authority** — the mint can be closed and the address potentially reused/repurposed.
- **Metadata / Group Pointer** — pointers can reference attacker-controlled accounts if trusted for display or logic.

#### Verification Procedure

**Step 1: Does the protocol accept arbitrary mints or Token-2022?**
```
grep -rn --include="*.rs" -iE "token_2022|spl_token_2022|InterfaceAccount|token_interface|TokenInterface" programs/
```
- If only a fixed allowlist of classic SPL mints (e.g., USDC/SOL): mostly N/A — confirm the allowlist is enforced (Step 2)
- If arbitrary mints / Token-2022 interface: proceed

**Step 2: Enforce a mint allowlist OR inspect extensions**
- ✅ PASS: Only vetted mints are accepted (`address`/allowlist check), excluding hostile extension configs
- ⚠️/❌: Arbitrary mints accepted without inspecting extensions

**Step 3: Reject or handle dangerous extensions**
```
grep -rn --include="*.rs" -iE "permanent_delegate|default_account_state|transfer_fee|confidential|interest_bearing|close_authority|get_extension" programs/
```
- ✅ PASS: Program reads mint extensions and rejects `PermanentDelegate`, `DefaultAccountState::Frozen`, `MintCloseAuthority`, confidential, and unexpected transfer-fee/interest configs (or explicitly supports them with correct accounting)
- ❌ FAIL: No extension inspection — a hostile mint can drain/freeze/misvalue

**Step 4: Amount accounting uses balance deltas, not declared amounts**
- ✅ PASS: Credited amount = vault balance AFTER − BEFORE (handles transfer fees correctly); uses `transfer_checked` with expected decimals
- ❌ FAIL: Credits the requested `amount`, ignoring fees/extensions

**Step 5: Freeze / permanent-delegate exposure on custody**
- ✅ PASS: Custodied funds cannot be frozen or clawed back by a third-party mint authority (or risk is documented and mint is trusted)
- ❌ FAIL: Vault holdings are subject to permanent delegate / freeze by an untrusted mint authority

**Overall verdict:**
- ✅: Allowlisted mints, or full extension inspection + delta-based accounting + transfer_checked
- ⚠️: Some extensions handled (e.g., transfer fee) but others (permanent delegate / frozen-default) unchecked
- ❌: Arbitrary Token-2022 mints accepted with no extension inspection
- N/A: Only classic SPL Token, allowlist enforced

---

### Deep-Dive Sub-Vectors

Four worked exploitations of the extensions above. Each assumes a protocol that custodies a caller-chosen Token-2022 mint (deposit into a vault, later withdraw). (adapted from safe-solana-builder shared-base §21 / §23)

#### (a) PermanentDelegate seizure of a custodied vault

**Scenario:** A yield vault accepts any mint via `InterfaceAccount`. The attacker creates a mint with a `PermanentDelegate` set to their own key, lists it, and lures deposits (or just deposits their own tokens to look like a real market). Everyone's deposits land in the program's vault ATA. A permanent delegate can move or burn tokens from ANY account of that mint — so the attacker calls `transfer_checked` / `burn` with themselves as delegate authority and drains the vault directly, bypassing every program-level check. The program's `deposited` balances still show the old numbers; the tokens are gone.

**PASS criterion:** At registration/init the program reads the mint and rejects any mint that has a `PermanentDelegate` extension (`get_extension::<PermanentDelegate>(...)` returns `Some`) unless the mint is on a trusted allowlist. Custodied balances can never be clawed back by a third party.

#### (b) Uncontrolled FreezeAuthority DoS on withdrawals

**Scenario:** The mint has a `FreezeAuthority` (classic or Token-2022) held by an untrusted party — often the same actor who created the mint. Users deposit; the vault ATA fills up. When users try to withdraw, the mint authority calls `freeze_account` on the vault's token account. Frozen accounts cannot transfer out, so `transfer_checked` from the vault reverts permanently. Funds are not stolen but are indefinitely locked — a griefing / ransom DoS. `DefaultAccountState = Frozen` is a variant: freshly created vault ATAs start frozen and outbound transfers fail until (and unless) the authority thaws them.

**PASS criterion:** The program rejects mints whose `FreezeAuthority` is not `None` (or not a trusted/program-controlled key) and rejects `DefaultAccountState::Frozen`, so no external party can freeze the withdrawal path. If a freeze authority is required for compliance, it must be program- or protocol-controlled and documented.

#### (c) TransferHook remaining-accounts omission / reentrancy

**Scenario:** The custodied mint carries a `TransferHook` pointing at program `H`. Two failure modes:
1. **Omission** — the vault builds a `transfer_checked` CPI without resolving the hook's extra accounts (via the transfer-hook interface) and without appending them to `remaining_accounts`. Token-2022 invokes `H`, which can't find its accounts, and the transfer reverts — deposits or withdrawals silently break (DoS), or worse, the developer "fixes" it by disabling checks.
2. **Malicious hook / reentrancy** — `H` is attacker-controlled and unvalidated. During the transfer, `H` runs attacker code with whatever signer/writable accounts were forwarded and can re-enter the calling program (e.g. call `withdraw` again before the first `withdraw` updated state) or manipulate accounts it was handed. This is the Token-2022 analogue of a callback-reentrancy bug (see also KV-023).

**PASS criterion:** The hook program is checked against an allowlist before the transfer, the hook's required accounts are correctly resolved and forwarded as `remaining_accounts`, and state follows checks-effects-interactions (all balance/accounting writes committed BEFORE the transfer CPI) so a re-entrant hook cannot double-spend. Only trusted hook programs are accepted for custodied mints.

#### (d) Transfer-fee balance-delta accounting error

**Scenario:** The mint has a `TransferFee` extension charging, say, 1%. A user deposits `1_000_000`. The vault ATA actually receives `990_000` (fee withheld by Token-2022), but the program credits the declared `amount = 1_000_000` to the user's position. Repeatedly depositing and withdrawing lets the attacker withdraw more than was ever received — each round the vault is short the fee, and the shortfall is covered by other users' principal until the vault is insolvent. The mirror bug on withdrawal over-debits or under-delivers. Because the fee is config-driven and can change, static assumptions about "no fee" are unsafe.

**PASS criterion:** Credited amount is computed as a balance delta — `received = vault.amount_after − vault.amount_before` with `checked_sub` — after calling `reload()` post-CPI, and that `received` value (never the declared `amount`) drives all state updates. All transfers use `transfer_checked` with the expected decimals. Grep:
```
grep -rn --include="*.rs" -iE "reload\(\)|amount_before|balance_before|checked_sub|transfer_checked" programs/
```
