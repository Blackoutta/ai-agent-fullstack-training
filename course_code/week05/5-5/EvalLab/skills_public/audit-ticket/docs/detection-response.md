# Detection & Response

*Method credited to anthropics/defending-code-reference-harness (dnr-hunt, dnr-respond); see ATTRIBUTION.md.*

Everything else in auditor-skill is pre-deployment — find the flaw before an
attacker does. This track is for the morning after: a protocol may already have
been attacked, and the evidence is in the chain's transaction history. It ships
two commands, `/auditor:hunt` and `/auditor:respond`, and one agent,
`incident-responder`: the commands keep you in the loop (arguments, approvals, the
collector, results), and the agent does all reading and analysis of the corpus.
Back to the [docs index](README.md).

The normative contract — the hard rules, the verdict ladder, the `incident_<n>/`
layout — is [`references/detection-response/README.md`](../references/detection-response/README.md).
This page is the orientation.

## Not emergency response

If funds are moving **right now**, don't start a write-up. Page your on-call,
trigger the pause/freeze runbook, and open a SEAL 911 ticket through its official
Telegram bot (`@seal_911_bot`). These commands are the after-the-fact workup.

## Which command

| You have | Use |
|----------|-----|
| No alert, just a program you want to check | [`/auditor:hunt [address…]`](commands.md#auditorhunt) |
| A signature, an address, an alert line, or an IOC | [`/auditor:respond <lead>`](commands.md#auditorrespond) |
| A hunt finding to work into a plan | `/auditor:respond INC-<n>.<k>` |

```
/auditor:hunt   →  /auditor:respond  →  /auditor:patch   →  (human runs the plan)
(find it)          (scope + plan)       (fix, verified)
```

## Inputs

- **Your own corpus** (preferred): point `--logs` at a directory of
  `getTransaction` JSONL, a Geyser/indexer export, or service logs.
- **Collected from RPC** (gated): with no `--logs`, the command shows you the
  addresses, window, caps and estimated call count and asks before the one shipped
  collector runs. Set `RPC_URL` in the environment (never on the command line);
  the collector finalizes and passes `maxSupportedTransactionVersion: 1`, which is
  mandatory now that v1 transactions are live on mainnet. Non-interactive runs
  collect only with `--collect`.
- **Source** (`--repo`): needed to confirm a flaw and to reach
  `confirmed_exploited`; without it, findings cap at `suspected`.

## Outputs

Everything lands in a per-run `incident_<n>/` directory whose first file is a
`.gitignore` of `*` — raw corpora and off-chain logs carry PII and are never
committed. Each run makes a new one; an existing one is reused only when git does
not track it, it holds no symbolic links, and you confirm it:

- `bin/` — the step-1 snapshot of each implicated program (`<id>.so` plus its
  `solana program show` output), taken before anything else so a mid-investigation
  hotfix can't erase the incident binary. A snapshot is never overwritten: a later
  one of a redeployed program is `<id>@<slot>.so`.
- `INCIDENTS.json` — the structured result ([schema](../references/detection-response/incidents-schema.md)).
- `INCIDENT_REPORT.md` — executive summary, timeline, per-incident evidence, and
  the full ledger so a reviewer can retrace every step.
- `RESPONSE-INC-<n>.<k>.md` — the proposed containment / remediation / recovery
  plan. Every action in it is a proposal awaiting a person.

## What "confirmed" means

`confirmed_exploited` requires three independent legs — an on-chain effect, the
flaw in the deployed source, and a local PoC on the real program bytes — and
anything short of all three is `suspected`. The ladder, the exact leg definitions
and the stolen-key cap are kept in one place only:
[the verdict ladder](../references/detection-response/README.md#the-verdict-ladder-the-one-normative-copy).

## The method is only as good as your telemetry

Hunting through raw history with no alert to start from is hard, and a quiet run
does not prove nothing happened. Before trusting it on an unknown, test it on a
known: in a throwaway environment, deploy a deliberately flawed program, attack it
with a script, record the resulting history, and check that `/auditor:hunt`
reconstructs the attack from that history alone. A packaged Solana exercise for
this is a planned follow-up; until then, run the same check on incidents you have
already captured.

## Safety and limits

- **Plans only, no actions.** No signing, sending, pausing, freezing, rotating, or
  contacting anyone — the plan is for a human to run
  ([containment playbook](../references/detection-response/containment-playbook.md)).
- **Local reproduction only.** PoCs run against `127.0.0.1`; the track never sends
  to or simulates against a public cluster.
- **MCP servers stay callable in your session.** `/auditor:hunt` and
  `/auditor:respond` hand all reading and analysis of the incident corpus to the
  `incident-responder` agent, whose tool list has no MCP tools, so it cannot call
  a signing or transfer tool. The commands themselves run in your session, where
  every connected MCP server stays callable. They call no MCP tool. Before a live
  incident, disconnect or deny write-capable MCP servers (for example, tools that
  transfer or stake).
- **Not a sandbox.** The commands' `allowed-tools` pre-approve only reading, `Task`
  and edits under `incident_*/`; they are intent, not confinement. No bundled script
  is pre-approved, and neither is `jq` (it can print the environment), so each
  `scripts/dnr/` run and each `jq` query asks for your approval. Real confinement is an isolated run mode
  ([`OUTPUT-RULES.md` Rule 11](../OUTPUT-RULES.md#rule-11-operating-safety)); the
  RPC provider that received your addresses is disclosed under Rule 11b.
- **Recipes:** [`scripts/dnr/`](../scripts/dnr/) — profiling, log-frame attribution,
  and exact balance deltas, each checked against adversarial fixtures by
  `scripts/tests/test-dnr.sh`.
- **Scripts run from the installation, never from the audited repo.** The commands
  invoke them by absolute path, `"<auditor-skill root>/scripts/dnr/…"`, and run
  python as `python3 -I`, so a same-named script, or a `json.py` the repo ships in
  the working directory or on `PYTHONPATH`, never runs in their place.
