# False Positives — "Vulnerabilities That Aren't" (Triage Catalog)

> **Load when:** triaging a candidate finding, or *before* reporting anything at High+
> severity (N ≥ 6). Read this first if a finding matches an EVM-brain reflex or a pattern that
> *looks* dangerous but is neutralized by the runtime or the framework.
>
> **Purpose:** Over-reporting is the primary failure mode of an AI auditor. This is a catalog
> of patterns that trip pattern-matchers but are **not** bugs on modern Solana — each with the
> concrete reason it's safe. It exists to *cut* false positives, not to excuse skipping work.
>
> **How to use — the gate discipline:** before you report **X**, confirm it is not one of the
> entries below. If it genuinely is that pattern, do **not** report it. If you believe you have
> a real instance anyway, the finding is only valid when the **Rule 5b** validation gate
> (`OUTPUT-RULES.md`) shows the **specific escape** — the concrete code path that defeats the
> protection described here, cited to `file:line`. "It could still be bad" is not an escape.
> A bare High-severity claim that matches an entry here, with no cited escape, must be
> downgraded to `[PARTIAL]` or `[UNCONFIRMED]`.
>
> **Quantify the barrier (symmetric discipline for *rejections*).** The same Rule 5b
> Math/State-Bounds rigor that a *finding* must survive also binds a **downgrade**. When you
> reject or downgrade a candidate on **economic infeasibility** ("not profitable") or a
> **precondition that cannot be met** ("not reachable / not exploitable"), you must show the
> **worked bound** that justifies it — the concrete numbers (capital required vs. maximum
> extractable, cost > gain by how much), or the **specific precondition** and *why* an attacker
> cannot satisfy it (which guard, which state, cited to `file:line`). A bare "not profitable" /
> "not exploitable" / "attacker gains nothing" with no worked math or named blocking precondition
> is **not a valid rejection** — it is exactly the corner AI auditors cut. Treat an
> unquantified dismissal like an unquantified High: it does not clear the gate, so the finding
> stays open (`[PARTIAL]` / `[UNCONFIRMED]`) until the barrier is actually computed. This mirrors
> the Rule 5b worked-case rejection example ("input ≥ 16 and header = 8 ⟹ … cannot underflow").
>
> *(Credit: public Solana security research and publicly disclosed audit findings.
> Re-expressed in our own words; no third-party text copied.)*

---

## How each entry is framed

- **The reflex** — what an auditor (often EVM-trained) is tempted to flag.
- **Why it's not a bug** — the runtime/framework property that neutralizes it.
- **The escape** — the *only* thing that makes it a real finding; what the Rule 5b gate must
  show, cited to `file:line`, before you report it.

---

## FP-1. Solana "reentrancy" is bounded — don't flag EVM-style reentrancy by default

**The reflex.** "There's a CPI before the state write — classic reentrancy, like The DAO."

**Why it's usually not a bug.** Solana's execution model constrains the EVM reentrancy shape:
- **CPI depth is capped at 4.** A call stack cannot recurse arbitrarily deep.
- **Direct self-recursion is restricted** — a program re-entering *itself* via CPI is limited
  by the runtime; the classic "call back into the victim mid-update" primitive is not freely
  available the way it is on the EVM.
- Cross-program callbacks are only dangerous when there is a **real, concrete cross-program
  state path**: program A calls untrusted program B, and B calls back into A *before A has
  committed the state that guards the funds*. Absent that specific interleaving, "CPI before
  write" is not exploitable.

**The escape (report only if all hold).** A named, reachable path where (1) the outer program
invokes an **untrusted / caller-supplied** program, (2) that callee can re-enter a program
whose **security-relevant state has not yet been written**, and (3) the re-entry observes the
stale state to double-spend or bypass a guard. The Rule 5b Reachability block must trace the
callback edge (which instruction of which program the untrusted callee can reach) — not just
note the CPI ordering. See `known-vectors/003` for the true-positive shape (checks-effects
ordering with an *untrusted* callee). If the CPI target is a hardcoded/trusted program with no
callback into vulnerable state, it is **not** a finding.

---

## FP-2. Anchor closed-account discriminator revival — fixed on modern Anchor (≥ 0.30)

**The reflex.** "This account is closed by draining lamports — an attacker can revive it and
the stale discriminator will still deserialize (the classic close/revival bug)."

**Why it's not a bug on modern Anchor.** Anchor's `close = dst` constraint (since **0.30**)
does the safe sequence atomically: it **zeroes the data**, writes the dedicated **`CLOSED`
account discriminator** (`[255; 8]`), drains lamports, and reassigns to the System Program. A
revived account no longer carries the original type's discriminator, so a subsequent
`Account<'info, T>` load **fails the discriminator check**. The historical revival exploit
targeted *manual* close code (or pre-0.30 Anchor) that drained lamports **without** writing the
sentinel discriminator.

**The escape (report only if one holds).** (a) The program is on **pre-0.30 Anchor**, or (b) it
closes accounts **manually** — draining lamports / zeroing without writing the `CLOSED`
sentinel and reassigning owner (native or hand-rolled Anchor). In native/Pinocchio, this is a
real class: the Rule 5b block must show the close path omits the realloc-to-zero *or* the
sentinel *or* the owner reassignment, and a re-init/revival path that then reads the stale
type. On `close = dst` with modern Anchor, it is **not** a finding. (See `known-vectors/014`
for the reinit shape; that KV's PASS condition is exactly "modern `close`/`init` enforced.")

---

## FP-3. Float non-determinism — sBPF emulates `f64` deterministically

**The reflex.** "This program uses `f64` — floating point is non-deterministic across nodes,
so it's a consensus-divergence bug."

**Why it's not automatically a bug.** The sBPF virtual machine executes floating-point
operations through a **deterministic software emulation**: every validator computes the *same*
bits for the same inputs. IEEE-754 `f64` under sBPF is reproducible, so float use **by itself**
is not a consensus fork risk. (It remains poor practice for *financial* math — rounding,
precision loss, and `NaN`/`Inf` edge cases are real correctness concerns — but those are
accuracy findings, judged on their own merits, not "non-determinism.")

**The escape (report the *right* finding).** Do not report "non-determinism." Report the actual
defect if present: precision loss / rounding in value math that lets an attacker extract funds
or corrupt accounting (quantify it via the Rule 5b Math/State-Bounds block), or an unhandled
`NaN`/`Inf` that reaches a comparison and bypasses a guard. Frame and severity follow the
economic impact, not the mere presence of `f64`.

---

## FP-4. Partial state on failure — Solana reverts the whole transaction atomically

**The reflex.** "If instruction 3 fails after instruction 2 wrote state, the account is left
in an inconsistent half-updated state."

**Why it's not a bug.** A Solana transaction is **atomic**: if *any* instruction in it returns
an error, the **entire transaction is rolled back** and **no** account changes from *any*
instruction in that transaction are committed. There is no "partial commit" of the earlier
instructions' writes. So "state left inconsistent after a failed instruction" is, for
in-transaction failures, a non-issue by construction.

**The escape (report only if it's genuinely cross-transaction).** A real inconsistency requires
state that is *intended* to span **multiple transactions** and can be left half-finished
**between** them — e.g. a multi-tx flow (init in tx A, finalize in tx B) where an attacker can
wedge the object in an exploitable intermediate state, or a griefing DoS that strands funds
until a second tx that an attacker can block. The Rule 5b Reachability block must show the
persistence boundary is a *transaction* boundary, not an instruction boundary. Within a single
tx, do not report it.

---

## FP-5. `init_if_needed` is not always a bug

**The reflex.** "`init_if_needed` is present — reinitialization vulnerability."

**Why it's not automatically a bug.** `init_if_needed` is only dangerous when **re-invoking it
changes security-relevant state** — i.e. an attacker can pre-create (or re-run against) the
account to reset an authority, reset a balance/flag, or otherwise overwrite state the program
later trusts. If the handler **re-validates the pre-existing state** before trusting it (gates
on an `initialized` flag, or asserts the stored authority equals the caller), or if the
"create-or-reuse" is genuinely idempotent and touches no security field, the mere presence of
`init_if_needed` is not an exploit.

**The escape (report only if it changes security-relevant state).** A reachable call where
re-initialization **mutates a field the program relies on for authorization or accounting**
(authority, admin flag, balance, config) **without** a guard proving the account was fresh /
owned by the caller. The Rule 5b block must name the overwritten field and show the missing
guard @ `file:line`. If a reinit guard exists (e.g.
`require!(!state.initialized || state.authority == caller, ...)`), downgrade — it is
defense-present. (Aligns with `known-vectors/014` PARTIAL/PASS conditions and
`framework-idioms/anchor.md` §3.)

---

## FP-6. Duplicate mutable accounts — auto-rejected by Anchor 1.x by default

**The reflex.** "Two `mut` accounts of the same type could be passed the same address — double
-spend / aliasing bug."

**Why it's not a bug on modern Anchor.** **Anchor 0.31+ / 1.x reject duplicate mutable accounts
by default** — passing the same pubkey for two distinct `mut` account slots fails
deserialization unless the developer *opts in* with the `dup` constraint. So on a modern Anchor
program the aliasing footgun is closed by the framework.

**The escape (report only if one holds).** (a) The program is **native or Pinocchio** (no
framework guard — the auditor must confirm a manual distinctness check exists; its absence is a
real finding), or (b) **pre-0.31 Anchor**, or (c) the developer **explicitly used `dup`** to
allow the aliasing and the handler's logic is unsafe under it. The Rule 5b block must show the
two writable accounts can alias *and* that aliasing corrupts accounting / enables a
double-credit. On default modern Anchor with no `dup`, it is **not** a finding.

---

## Triage fast pass (before any N ≥ 6 report)

- [ ] Is this **reentrancy**? Confirm an *untrusted* callee + a callback into *unwritten*
      vulnerable state before flagging (FP-1). CPI depth ≤ 4; ordering alone ≠ bug.
- [ ] Is this a **close/revival** claim? Confirm pre-0.30 Anchor or a *manual* close missing
      the `CLOSED` sentinel / realloc / owner-reassign (FP-2). `close = dst` on ≥0.30 is safe.
- [ ] Is this **float non-determinism**? sBPF `f64` is deterministic — report the real
      precision/`NaN` defect with impact, not "non-determinism" (FP-3).
- [ ] Is this **partial state on failure**? Single-tx failures roll back atomically — only
      report genuine *cross-transaction* half-states (FP-4).
- [ ] Is this **`init_if_needed`**? Only a bug if reinit changes a security-relevant field with
      no fresh-account guard (FP-5).
- [ ] Is this **duplicate-mutable**? Anchor 1.x rejects by default — only real on native/
      Pinocchio, pre-0.31, or explicit `dup` (FP-6).
- [ ] For any survivor: the **Rule 5b gate shows the specific escape**, cited to `file:line`.
      No escape → downgrade to `[PARTIAL]` / `[UNCONFIRMED]`.
- [ ] For any **downgrade on "not profitable / not exploitable": the barrier is quantified** —
      worked numbers (cost vs. gain) or the named blocking precondition @ `file:line`. A bare
      dismissal fails the gate; the finding stays open until the bound is computed.
