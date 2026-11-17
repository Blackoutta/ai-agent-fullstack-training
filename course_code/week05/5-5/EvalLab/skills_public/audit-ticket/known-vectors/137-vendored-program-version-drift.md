---
id: 137
title: "White-Label / Vendored On-Chain Program Version Drift & Inherited Admin Surface"
severity: 8
category: crypto
---

### 137 — White-Label / Vendored On-Chain Program Version Drift & Inherited Admin Surface

**Severity: 8** | **Real: Rain card-infrastructure contract exploit (Aug 28-30, 2026, ~$1.1M across the fleet) — Avici lost $500K across 1,685 user card balances and Tria and other tenants were hit through the same root cause: an outdated deployed version of Rain's white-label Solana contract accepted a crafted `AddCollateralAdmin` signature bundle, granting the attacker collateral-admin rights over 1,100+ user collateral accounts, drained one by one. Rain had already patched upstream; the stale tenant deployments had not been upgraded.**

Many Solana protocols do not write the program they deploy: they run a **white-label vendor codebase** (cards-as-a-service, wallet infrastructure), a **fork** (AMM, launchpad, staking, lending), or they CPI into a vendor's own deployment. This outsources the security lifecycle, and three distinct failure modes ship with it:

- **Version drift.** The upstream vendor fixes a vulnerability, but the tenant's deployed instance keeps running the old build — no advisory subscription, no patch SLA, or a vendor managing N tenant deployments that misses some. From the moment the upstream patch lands, the diff is a public exploit map for every stale instance (the exact Rain/Avici sequence).
- **Fleet blast radius.** Identical bytecode deployed N times means an exploit proven against *any* sibling deployment is a live PoC against yours. Attackers enumerate program IDs sharing the codebase (IDL similarity, instruction layout, `declare_id` lists in the vendor SDK) and replay the attack across the fleet. A tenant that does not monitor sibling incidents learns about its own vulnerability from its own drain.
- **Inherited privileged surface.** Vendor codebases ship admin instructions the tenant never reviewed — authority-grant instructions (`AddCollateralAdmin`-style), emergency withdrawals, fee re-routing — sometimes gated only by an **off-chain-signed message bundle** rather than an on-chain signer. If the signature verification does not bind program ID, instruction, target accounts, expiry and nonce, a crafted bundle grants the attacker the role directly (cross-ref KV-101/KV-102 for the introspection/precompile mechanics).

The class is invisible to dependency scanners: `cargo audit` / `npm audit` see library crates, not *deployed program provenance*. Checklist 11's package checks (SC-001..052) do not fire because the vulnerable artifact is the tenant's own on-chain program.

> Cross-ref: checklist 11 §11.10 (SC-053..058 — vendored-program inventory, drift diff, advisory SLA, fleet monitoring); checklist 02 §2.7 (AC-051..055 — off-chain-signed authority grants); KV-020 / KV-091 (upgrade authority — who can patch, and who can hijack, the deployment); KV-102 (precompile signature-verification bypass); KV-004 (missing access control on the inherited admin surface); KV-089 (unpatched server dependencies — the off-chain ancestor of this vector); `references/audit-lifecycle/threat-model-bootstrap.md` (its collector finds the fork point and lists guard lines the upstream added afterwards — leads for Step 2, not a verdict).

#### Verification Procedure

**Step 1: Establish program provenance — is any in-scope program vendored, white-label or forked?**
```
grep -rn -iE "fork of|forked from|based on|powered by|white.?label|licensed from|upstream" README.md docs/ programs/ 2>/dev/null
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  log --oneline --reverse --no-textconv -- programs/ | head -5   # imported wholesale in one commit? (Rule 11c flags)
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false remote -v
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false config --get-all remote.upstream.url
grep -rn -E "declare_id!" programs/ | sort   # compare against known vendor/upstream program IDs
```
- Record for each program: upstream repo/vendor, the commit or release the deployment was built from, and who operates the upgrade authority (tenant or vendor). Also list vendor programs reached via CPI (cross-ref KV-009).
- If every in-scope program is first-party original code and no vendor program is integrated, this vector is N/A (record this explicitly).

**Step 2: Diff the deployed version against upstream HEAD and its security history**
```
solana-verify verify-from-repo -um --program-id <PROGRAM_ID> <UPSTREAM_REPO> 2>/dev/null   # or compare build hashes
GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false \
  log --oneline --no-textconv <deployed_commit>..upstream/main -- programs/ | head -40
gh api repos/<upstream>/security-advisories 2>/dev/null; gh release list -R <upstream> | head -10
```
- ✅ PASS: the deployed build corresponds to upstream HEAD or a maintained release branch, and no security-tagged commit / advisory / release note exists after the deployed commit
- ❌ FAIL: upstream contains fix commits, advisories or releases newer than the deployed build — treat every one of those diffs as a live exploit candidate against this deployment and escalate to manual review of each
- ⚠️ PARTIAL: provenance is known but the deployed commit cannot be established (no verifiable build) — the drift is unmeasurable, which is itself a finding

**Step 3: Advisory subscription and patch SLA exist and have fired before**
```
grep -rn -iE "security@|advisory|advisories|dependabot|patch (policy|sla)|upgrade (policy|window)" docs/ SECURITY.md .github/ 2>/dev/null
```
- ✅ PASS: the team subscribes to the vendor's advisory channel (GitHub security advisories, disclosure list, vendor status page), a patch SLA for the deployed program exists, and there is evidence it has been exercised (past upgrade in response to an upstream fix)
- ❌ FAIL: no subscription and no documented path from "upstream patched" to "our deployment upgraded" — the tenant depends on luck or on the vendor remembering them

**Step 4: Inventory the inherited privileged surface — especially authority-grant instructions**
```
grep -rn -iE "fn (add|set|grant|update).*(admin|authority|operator|delegate|owner)" programs/ 2>/dev/null
grep -rn -B3 -A15 -iE "add.*admin|grant.*role|signature.?bundle|ed25519|secp256k1" programs/ | grep -iE "load_instruction_at|get_instruction_relative|verify|nonce|expiry|expires"
```
- ✅ PASS: every instruction that grants or extends privileges requires an existing higher on-chain authority as `Signer`; any off-chain-signed authorization binds program ID, instruction discriminator, target accounts, expiry and a consumed nonce (no replay), and each element of a batch/bundle is individually validated (walk checklist 02 §2.7)
- ❌ FAIL: an authority-grant instruction is reachable with only an off-chain-signed message whose verification omits any of those bindings — the `AddCollateralAdmin` failure: one crafted bundle → admin over the user-collateral fleet
- Also record the blast radius of each admin role: ✅ scoped per account/market; ❌ one credential controls all user collateral accounts

**Step 5: Fleet exposure — sibling deployments and shared vendor keys**
```
# from the vendor SDK / docs / explorer: list other deployments of the same codebase
grep -rn -iE "program.?ids?|deployments|tenants|partners" <vendor-sdk>/ docs/ 2>/dev/null
solana program show <PROGRAM_ID>   # upgrade authority: tenant multisig, vendor hot key, or none?
```
- ✅ PASS: the team knows which sibling deployments share the codebase, monitors security incidents against them (an incident anywhere in the fleet triggers the tenant's own incident response), and the upgrade authority for *their* instance is a governed multisig/timelock (cross-ref KV-020/KV-091) — whether held by tenant or vendor is documented and contracted
- ❌ FAIL: no fleet awareness (the Avici position: the sibling exploit and the upstream patch both predate the drain), or the vendor holds a single hot upgrade key over every tenant deployment (one vendor key compromise = whole-fleet rug, cross-ref KV-008)

**Overall verdict:**
- ✅: Provenance of every deployed/integrated program is documented with a verifiable build; no unapplied upstream security fixes; advisory subscription + patch SLA in place; inherited admin surface reviewed with authority grants properly gated; fleet exposure known and monitored
- ⚠️: Provenance known and current, but no advisory subscription / patch SLA, or the inherited admin surface has never had its own review, or fleet siblings are unknown
- ❌: The deployment runs a version with a known upstream fix it has not applied, or an inherited authority-grant instruction is reachable via an unbound off-chain-signed bundle, or the vendor's single hot key can upgrade the tenant's program
- N/A: All in-scope programs are first-party original code and no vendor program is integrated via CPI
