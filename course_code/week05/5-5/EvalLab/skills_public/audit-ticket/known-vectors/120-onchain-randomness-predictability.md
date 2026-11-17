---
id: 120
title: "On-Chain Randomness Predictability & VRF Misbinding"
severity: 7
category: crypto
---

### 120 — On-Chain Randomness Predictability & VRF Misbinding

**Severity: 7** | **Real: ToB Pyth Entropy audit (blockhash-zero → 2-outcome grind, reorg re-grinding); Zenith MagicBlock Ephemeral VRF (same-slot hash reuse)**

On-chain programs that derive "randomness" from validator-observable or user-supplied entropy are predictable or grindable. `Clock` (unix_timestamp/slot), `recent_blockhashes` / `SlotHashes`, and caller-supplied seeds are all known to the transaction producer at build time — a lottery/NFT-mint/game program that picks a winner or trait from them lets the attacker only submit when the outcome favors them (or re-grind across a reorg). VRF integrations fail the same way when the returned randomness is not cryptographically bound to the specific consuming instruction/request (allowing result reuse across slots or callers) or is consumed without a staleness check. Commit-reveal schemes fail when the last revealer can compute the final value and abort (reveal-abort grinding) or when there is no economic penalty for non-reveal.

> This is the on-chain class. KV-095 covers the distinct web/off-chain case (`Math.random()` for session tokens/nonces). A program can be perfectly clean off-chain and still be exploitable here.

#### Verification Procedure

**Step 1: Find on-chain entropy sources used as randomness**
```
grep -rn --include="*.rs" -iE "recent_blockhashes|RecentBlockhashes|SlotHashes|slot_hashes|unix_timestamp|Clock::get|\.slot\b" programs/*/src/
```
- Record every use feeding a winner-selection, trait roll, mint order, shuffle, or reward draw

**Step 2: Classify each usage (grindable vs bound)**
```
# For each hit: is the value known to the tx producer before/at submission?
grep -rn --include="*.rs" -iE "lottery|winner|jackpot|raffle|random|roll|shuffle|draw|pick|mint.*trait|rarity" programs/*/src/
```
- ✅ PASS: selection uses a VRF result or a penalized commit-reveal — never raw slot/blockhash/Clock
- ❌ FAIL: outcome derived from `recent_blockhashes`/`slot`/`unix_timestamp`/user seed (attacker submits only on favorable outcomes; reorg lets re-grind)

**Step 3: If a VRF is used, verify request-binding + staleness**
```
grep -rn --include="*.rs" -iE "switchboard|orao|vrf|randomness|reveal|consume_randomness" programs/*/src/
```
- ✅ PASS: Switchboard/ORAO VRF result is bound to THIS request (request account/seed tied to the consuming instruction), fulfilled after the request slot, and rejected if stale/reused
- ❌ FAIL: VRF result not bound to the request (reusable across callers/slots), or same-slot fulfillment allowed, or no staleness/one-time-consume guard

**Step 4: If commit-reveal is used, verify anti-grinding economics**
- Confirm the reveal cannot be selectively aborted for advantage, and non-reveal is penalized (forfeited deposit / slashed stake) so the last revealer cannot grind by withholding
- ✅ PASS: commitments are binding, all committers' contributions are required (or non-reveal is economically punished), final value not computable before all reveals
- ❌ FAIL: last revealer can compute the result and abort with no penalty (reveal-abort grinding)

**Overall verdict:**
- ✅: Request-bound VRF (Switchboard/ORAO) with staleness + one-time consume, OR penalized commit-reveal
- ⚠️: VRF/commit-reveal present but missing staleness check or a clear non-reveal penalty
- ❌: Any security- or value-relevant outcome derived from slot/blockhash/Clock/user seed, or a VRF result not bound to its request
- N/A: Program performs no randomness-dependent selection
