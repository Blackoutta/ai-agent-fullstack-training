---
id: 26
title: "PDA Seed Collision"
severity: 8
category: crypto
---

### 26 — PDA Seed Collision
**Severity: 8** | **Real: Solana PDA confusion exploits**

Two different logical accounts derive to the same PDA because seeds overlap — attacker exploits the collision.

#### Verification Procedure

**Step 1: Catalog all PDA seed patterns**
```
grep -rn --include="*.rs" "seeds = \[" programs/*/src/instructions/
```
- Record: Every seed pattern with its account type

**Step 2: Verify unique prefix per account type**
```
# Each PDA type should start with a unique string literal
grep -rn --include="*.rs" 'seeds = \[' programs/ | sed 's/.*seeds = \[//' | sed 's/\].*//' | sort
```
- ✅ PASS: Every account type has a unique first seed (e.g., `b"fund"`, `b"position"`, `b"withdrawal"`)
- ❌ FAIL: Two different types share the same seed prefix

**Step 3: Verify variable seeds provide uniqueness**
```
# After the prefix, seeds must include enough identifiers to prevent collision
# Fund: [b"fund", manager, name]
# Position: [b"position", fund, investor]
```
- ✅ PASS: Seeds fully identify the entity (no two valid entities can have the same seeds)
- ❌ FAIL: Seeds are insufficient — two entities could collide

**Step 4: Check bump seed handling**
```
grep -rn --include="*.rs" "bump" programs/*/src/instructions/
```
- ✅ PASS: Stored bump is reused via `bump = entity.bump` (consistent derivation)
- ⚠️ PARTIAL: Bump re-derived each time (wastes CU but not a security issue)
- ❌ FAIL: Bump not stored and `find_program_address` used in instruction (potential inconsistency)

**Overall verdict:**
- ✅: Unique prefixes, sufficient variable seeds, stored bumps
- ⚠️: Unique seeds but bumps re-derived
- ❌: Shared seed prefixes or insufficient seeds allowing collision
