---
id: 111
title: "BPF Stack Frame Overflow DoS"
severity: 6
category: dos
---

### 111 — BPF Stack Frame Overflow DoS

**Severity: 6** | **Real: Pattern — BPF 4096-byte stack-frame overrun (fat Anchor contexts / large by-value locals fail at runtime, not compile time)**

The SBF/BPF VM enforces a hard **4096-byte stack frame limit** per function invocation. A single instruction handler whose stack frame exceeds this — a `#[derive(Accounts)]` context with many `Account`/`InterfaceAccount` fields, a large by-value struct or array declared as a local, or a deep call chain that accumulates frame size — triggers an **"Access violation in stack frame N"** at execution time. This is not caught by `cargo build` type-checking; `anchor build` emits it only as a linker-stage warning (`Stack offset of XXXX exceeded max offset of 4096 by YYY bytes`) that is easy to miss. The result is a **complete DoS**: the instruction reverts on every call, with no graceful degradation and no way for users to route around it. If the affected instruction is on the only withdrawal/settlement path, funds can be locked. (Adapted from safe-solana-builder shared-base §25.)

Note: this is a **liveness/DoS** issue, not memory corruption — the VM aborts rather than allowing the overrun. Severity is moderate because it is deterministic and normally surfaces in testing, but a frame that only overflows on a rarely-hit branch (large local inside one `match` arm) can ship undetected.

#### Verification Procedure

**Step 1: Build and grep for the linker-stage stack warning**
```
# builds the target (build.rs, proc-macros): only in the OUTPUT-RULES Rule 11a mode recorded at intake;
# if that mode cannot run it, verdict from Step 2's source checks with a Rule 10 confidence note
anchor build 2>&1 | grep -iE "exceeded max offset of 4096|stack offset of|access violation in stack frame"
cargo build-sbf 2>&1 | grep -iE "exceeded max offset|stack frame"
```
- ✅ PASS: Clean build with zero stack-offset warnings
- ❌ FAIL: Any "exceeded max offset of 4096" line — treat as a hard blocker, not a warning

**Step 2: Find fat Anchor contexts (many account fields on the stack)**
```
grep -rn --include="*.rs" -E "#\[derive\(Accounts\)\]" programs/
# For each flagged struct, count its Account / InterfaceAccount fields
grep -rn --include="*.rs" -cE "Account<|InterfaceAccount<|Box<Account|Box<InterfaceAccount" programs/*/src/**/*.rs
```
- Record: every `Accounts` struct with ~6+ un-`Box`ed typed account fields, especially alongside large custom state accounts
- ✅ PASS: Large / numerous account fields are wrapped in `Box<>` (heap-allocated), keeping the context struct small on the stack
- ❌ FAIL: Many un-boxed `Account`/`InterfaceAccount` fields in one context

**Step 3: Find large by-value locals and array declarations in handlers**
```
grep -rn --include="*.rs" -E "let [a-z_]+: \[[a-zA-Z0-9_]+; [0-9]{3,}\]|\[0u8; [0-9]{4,}\]|= \[.*; [0-9]{3,}\]" programs/
grep -rn --include="*.rs" -E "let (mut )?[a-z_]+ = [A-Z][A-Za-z0-9_]+ \{" programs/
```
- Record: stack-allocated arrays ≥ a few hundred bytes, and large structs constructed/copied by value inside a handler
- ✅ PASS: Large buffers/structs are heap-allocated (`Box::new`, `vec!`) or streamed, not held by value on the stack
- ❌ FAIL: A multi-KB array or large struct lives on the handler's stack frame

**Step 4: Trace deep call chains that accumulate frame size**
```
# Handlers that construct a large context AND call helpers that take it by value
grep -rn --include="*.rs" -E "fn process|pub fn handler|pub fn [a-z_]+\(ctx: Context" programs/
```
- ✅ PASS: Helpers borrow (`&ctx`, `&mut state`) instead of taking large values by move; frame does not grow per call layer
- ❌ FAIL: Large structs passed by value down a call chain, each frame re-materializing them

**Step 5: Check rarely-hit branches for hidden large locals**
- A frame only overflows when the largest local along an executed path is live. A big buffer inside one `match` arm or `if` branch can pass "happy path" tests and fail only on that branch.
- ✅ PASS: No branch introduces a large stack local that the common path avoids; tested with the worst-case branch
- ❌ FAIL: A conditional branch allocates a large local not exercised by existing tests

**Fix:** Wrap large account fields in `Box<>` (`pub vault: Box<Account<'info, VaultState>>`), apply `Box<>` to the biggest types first (`InterfaceAccount<Mint>`, `InterfaceAccount<TokenAccount>`, large custom state). For native/Pinocchio, avoid large local declarations in handlers — move complex structs behind references or `Box`/`Vec` on the heap. Re-run Step 1 until the build is clean.

**Overall verdict:**
- ✅: Build has zero stack-offset warnings; large types are `Box`ed / heap-allocated; every frame stays within 4096 bytes
- ⚠️: No current warning, but a fat context or large conditional local is one added field/branch away from overflow (fragile)
- ❌: Build reports "exceeded max offset of 4096", or an instruction always reverts with an access violation in a stack frame
- N/A: No on-chain Solana program in the codebase
