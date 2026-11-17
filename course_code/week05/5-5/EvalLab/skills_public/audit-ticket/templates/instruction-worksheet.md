# Instruction Audit Worksheet

> Copy this template once per instruction in the Solana program.  
> Complete every section. Mark N/A if genuinely not applicable, with a reason.

---

## Instruction: `<!-- instruction_name -->`

| Field | Value |
|---|---|
| **File** | `programs/<program>/src/instructions/<!-- name -->.rs` |
| **Handler** | `pub fn <!-- name -->(ctx: Context<<!-- AccountsStruct -->>) -> Result<()>` |
| **Invoked by** | <!-- manager / investor / anyone / admin --> |
| **Risk tier** | <!-- HIGH (moves funds) / MEDIUM (changes state) / LOW (read-only / view) --> |

---

### 1. Accounts Struct (`#[derive(Accounts)]`)

List every account in the struct:

| # | Account Name | Type | Mutable | Signer | Constraints | Validated? |
|---|---|---|---|---|---|---|
| 1 | | | ☐ | ☐ | | ☐ |
| 2 | | | ☐ | ☐ | | ☐ |
| 3 | | | ☐ | ☐ | | ☐ |
| 4 | | | ☐ | ☐ | | ☐ |
| 5 | | | ☐ | ☐ | | ☐ |

**Questions to answer:**
- [ ] Is every required signer actually declared as `Signer<'info>`?
- [ ] Do all `#[account(mut)]` accounts need to be mutable?
- [ ] Do all token accounts have `token::mint` and `token::authority` constraints?
- [ ] Is there a `has_one` for every linked account?
- [ ] Are there `UncheckedAccount`s? Does each have a `/// CHECK:` + runtime validation?
- [ ] Does `remaining_accounts` exist? Is every element validated before use?
- [ ] Are account sizes correct for `init` accounts (8 + struct size)?
- [ ] Is the payer set correctly for `init` accounts?

---

### 2. Access Control

| Check | Status | Notes |
|---|---|---|
| Primary signer identified | ☐ | |
| Signer role matches instruction purpose | ☐ | |
| `has_one` links signer to correct parent account | ☐ | |
| `require_keys_eq!` used for runtime verification | ☐ | |
| No privilege escalation possible | ☐ | |
| Cannot be called in wrong fund state | ☐ | |

---

### 3. CPI Calls

List every CPI made by this instruction:

| # | Target Program | Operation | Authority | invoke_signed? | Seeds Correct? |
|---|---|---|---|---|---|
| 1 | | | | ☐ | ☐ |
| 2 | | | | ☐ | ☐ |

**Questions to answer:**
- [ ] Is the CPI target verified (not passed as unchecked account)?
- [ ] Is `CpiContext::new()` first arg a `Pubkey` (not `.to_account_info()`)?
- [ ] For PDA authority: is `invoke_signed` / `new_with_signer` used?
- [ ] Are PDA signer seeds correct (all required seeds + bump)?
- [ ] Are transfer destinations constrained (not attacker-controlled)?
- [ ] Is the return value from CPI checked (if applicable)?

---

### 4. PDA Derivation

| PDA Account | Seeds | Bump Source | Verified? |
|---|---|---|---|
| | | ☐ stored / ☐ canonical | ☐ |

**Questions to answer:**
- [ ] Are seeds deterministic and collision-free?
- [ ] Is the bump from `find_program_address` or stored on first init?
- [ ] Could a different set of inputs derive the same PDA (collision)?

---

### 5. Arithmetic

List every arithmetic operation:

| # | Operation | Operands | Method | Overflow Safe? | Division-After-Multiply? |
|---|---|---|---|---|---|
| 1 | | | `checked_*` ☐ / bare ☐ | ☐ | ☐ |
| 2 | | | `checked_*` ☐ / bare ☐ | ☐ | ☐ |
| 3 | | | `checked_*` ☐ / bare ☐ | ☐ | ☐ |

**Questions to answer:**
- [ ] Are ALL arithmetic operations using `checked_*` methods?
- [ ] Is multiplication done before division to preserve precision?
- [ ] Are u128 intermediate values used where u64 could overflow?
- [ ] Does division by zero get handled (denominator could be 0)?
- [ ] Are there rounding issues that favor one party over another?
- [ ] Is `MathOverflow` error returned on failure (not unwrap/panic)?

---

### 6. State Changes

| Field | Account | Old → New | Validated? |
|---|---|---|---|
| | | | ☐ |
| | | | ☐ |

**Questions to answer:**
- [ ] Is the instruction idempotent or does it check pre-conditions?
- [ ] Is the correct state transition being enforced (e.g., Pending → Active)?
- [ ] Are all modified fields set to valid values?
- [ ] Is an event emitted for the state change?
- [ ] Could this be called twice to corrupt state?

---

### 7. Token / SOL Movement

| Direction | Amount Source | From | To | Authority | Validated? |
|---|---|---|---|---|---|
| <!-- in/out --> | | | | | ☐ |

**Questions to answer:**
- [ ] Can the amount be manipulated by the caller?
- [ ] Is slippage protection enforced (min_amount_out)?
- [ ] Does the vault balance stay consistent with share math?
- [ ] Are fees deducted correctly?
- [ ] Could a flash loan manipulate the amount calculation?

---

### 8. Economic Attack Vectors

| Vector | Applicable? | Mitigated? | Notes |
|---|---|---|---|
| Sandwich attack | ☐ | ☐ | |
| Flash loan price manipulation | ☐ | ☐ | |
| First depositor / tiny share attack | ☐ | ☐ | |
| Share dilution | ☐ | ☐ | |
| NAV manipulation | ☐ | ☐ | |
| Fee extraction | ☐ | ☐ | |
| Griefing (DoS) | ☐ | ☐ | |
| Front-running | ☐ | ☐ | |

---

### 9. Findings

| ID | Severity | Title | Checklist Ref |
|---|---|---|---|
| | | | |

---

### 10. Sign-Off

| Check | Status |
|---|---|
| All 9 sections above completed | ☐ |
| All findings recorded with severity | ☐ |
| No sections marked N/A without reason | ☐ |
| Cross-referenced with other instructions that interact with same state | ☐ |

**Reviewer:** <!-- name/agent -->  
**Date:** <!-- YYYY-MM-DD -->
