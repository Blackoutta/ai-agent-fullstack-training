# Containment playbook — proposed, never executed

*Method credited to anthropics/defending-code-reference-harness (dnr-respond); see ATTRIBUTION.md.*

> **Load when:** writing the containment / recovery / detection sections of a
> `/auditor:respond` plan (`templates/response-plan.md`). Read
> `references/detection-response/README.md` first.

Every action here is a **proposal a human executes**. For each one the track
writes down the action, the query result that supports it, whose signature it
needs, whether it can be undone, and the damage if the proposal turns out to be
mistaken — and then it stops. Carrying it out is never the track's job.

## Rules of engagement (propose-only, made concrete)

- **No signing, sending, or simulating against a public cluster.** No `solana`
  write subcommand of any kind — not even with `--url localhost`, because the CLI
  signs with `~/.config/solana/id.json` and one wrong `--url` lands the signed
  transaction on mainnet. No remote `simulateTransaction`: the exploit payload
  would become visible to the RPC provider, which is a copycat risk.
- **No serialized transactions and no multisig proposals.** The plan describes the
  instruction (program, accounts, args) in prose; it never emits transaction
  bytes, a Squads proposal, or anything a human could blind-sign.
- **No outbound communication.** No mail, chat, posts, issues, PRs, or webhooks,
  even when a connected tool could send them. Coordination is **drafts only**
  (below).
- **Read-only, keyless reads only.** Program bytes and `solana program show` come
  only from `<auditor-skill root>/scripts/dnr/snapshot-program.sh`, and
  `getSignaturesForAddress` / `getTransaction` only from `collect.sh`. Any other
  read — `solana account <address>` (`getAccountInfo`), `solana confirm -v <sig>` —
  uses the throwaway-config recipe in `log-sources.md`, never `--url`: no key in
  argv, no keypair to sign with, and its output piped through the installation's
  `redact.sh` (never a relative `scripts/` path) after `set -o pipefail;`, so a
  key in an error never reaches the transcript and a failed read still fails.
- **No MCP write tool**, no webhook/subscription setup. The `incident-responder`
  agent that does the corpus work has no MCP tools, so it cannot call a signing or
  transfer tool; `/auditor:hunt` and `/auditor:respond` run in your session, where
  every connected MCP server stays callable, and call none. Before a live
  incident, disconnect or deny write-capable MCP servers (for example, tools that
  transfer or stake) — README § "allowed-tools is not a sandbox".
- Building a candidate commit to reproduce follows the run's execution mode
  (`OUTPUT-RULES.md` Rule 11a); a `supply_chain_or_ci` root cause is **never**
  built natively, and its PoC never builds or links the target's crates: it runs
  on the dumped bytes alone.

## The action menu (every row is a proposal)

| Proposed action | When it applies | Who signs | Reversible | Risk if wrong |
|-----------------|-----------------|-----------|-----------|---------------|
| Trigger the program's **pause / emergency-stop** instruction | the program has one (LM-043/044) | the pause authority / multisig | yes (resume) | halts legitimate users; prefer it to an upgrade when it exists |
| **Multisig hotfix upgrade** to the patched build | code flaw, upgradeable program, fix verified (`/auditor:patch`) | upgrade-authority multisig | yes (re-upgrade) | a rushed upgrade can widen the hole; ship the verified diff, not a guess |
| **Freeze** attacker/mule token accounts | the mint has a freeze authority held by the client | freeze authority | yes (thaw) | freezing a wrong account strands an innocent holder; cite the exact accounts |
| **Pausable (Token-2022) pause** of the mint | the mint carries the Pausable extension | pause authority | yes (resume) | halts all holders of that mint, not just the attacker |
| **Rotate the upgrade / mint / config authority** to a fresh multisig | authority may be compromised (`key_compromise`) | current authority | partially | if the current key is already the attacker's, rotation may fail or tip them off; sequence with the pause |
| Propose **market / oracle circuit-breaker or deposit cap** changes | economic / oracle root cause | protocol governance | yes | over-tight limits can cascade liquidations; state the bound |
| Pause the **keeper / relayer / indexer** that acts on program output | off-chain actor is acting on forged events (KV-122) | ops owner | yes | stops legitimate automation; pair with the code fix |
| Rotate a leaked **deploy key / CI secret**, revoke the CI token | `supply_chain_or_ci` / `off_chain` (link #16's `references/vuln-classes/github-actions.md`) | ops / platform owner | partially | breaks running deploys; necessary when a key may be out |

### Do not

- **Never `solana program close`**, and never set the upgrade authority to
  `--final`: both are irreversible, the id cannot be reused after a close, and a
  close strands any program-owned funds. These are not containment.
- Never widen anyone's privileges, and never move funds "to safety" — moving funds
  is a signed transaction, which the track does not do.

## Reading the deploy timeline (read-only)

To place an upgrade or authority change on the incident timeline, read the
program's loader record (no write):

- **Loader-v3 (`BPFLoaderUpgradeab1e…`):** the ProgramData account's 45-byte
  header holds the u32 variant tag, then the last-deployed **slot** at bytes
  `[4..12]`, then an `Option<Pubkey>` upgrade authority at byte `12`. `solana
  program show <id>` prints "Last Deployed In Slot" and the authority directly.
- **Loader-v4 (`LoaderV411…`):** `LoaderV4State` is a 0x30-byte header — slot at
  `[0..8]`, authority-or-next-version pubkey at `[8..40]`, status at `[40..48]` —
  followed by the ELF. `solana program show` refuses such a program ("is not an
  SBF program"); `solana program-v4 show --program-id <id>` prints the same
  "Last Deployed In Slot", authority and status. `snapshot-program.sh` handles
  both loaders.
- **BPFLoader2 / BPFLoader1:** immutable, with no deploy slot or authority; the
  snapshot records `last_deployed_slot=n/a (immutable loader)`.

A last-deployed slot **after** the incident slot means the incident binary is
gone (a hotfix overwrote it); snapshot the current bytes immediately anyway (a
snapshot never replaces an earlier one: `bin/<id>.so` stays the first, a later one
is `bin/<id>@<slot>.so`), and note the provenance gap (`incidents-schema.md` →
`binary_provenance`).

## Coordination (drafts only)

The plan may include **draft** outreach text for a human to send; the agent sends
nothing. Candidates, with the caveat that attribution of an address to a person is
never asserted and any exchange/bridge label must be cited:

- **SEAL 911** via its official Telegram bot (`@seal_911_bot`). Source of truth:
  `github.com/security-alliance/seal-911`. If a purported member reaches out
  first, verify them through the bot using the repo's keyword step —
  impersonators specifically target live incidents.
- The token issuer / stablecoin desk (for a freeze), affected protocols, and —
  with a cited rationale — exchanges and bridges on the fund-flow path.

## Recovery and detection engineering

- **Recovery (proposed):** the specific credentials to rotate — the list your
  queries produced, never a blanket reset — the specific customers to contact (the
  distinct-victim set from the damage query, kept internal), and the signal that
  will show the attacker no longer has a foothold.
- **Detection engineering (proposed):** turn the queries that separated attack from
  noise into standing alerts, mapped to checklist 17 — anomalous withdrawals and
  rapid calls (LM-030), upgrade-authority changes (LM-037), unexpected mint-authority
  use (LM-038), off-chain consumers that trust logs over finalized state (LM-063),
  and stream/reader liveness (LM-065). Note which existing alerts fired and which
  were noise.
