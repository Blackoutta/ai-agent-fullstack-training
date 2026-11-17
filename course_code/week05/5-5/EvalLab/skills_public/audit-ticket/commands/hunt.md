---
name: auditor:hunt
description: "Post-incident threat hunt for when no alert has fired: baseline a Solana program's transaction history and program logs, record each hypothesis and its query in a ledger, check each suspect against the source deployed at the incident slot, replay the attack locally on the real program bytes, and write incident_<n>/INCIDENTS.json and INCIDENT_REPORT.md. Proposes only; never signs, sends, or acts on-chain."
argument-hint: "[<address> ...] [--logs <dir>] [--repo <path>] [--window <fromUnix>..<toUnix>] [--collect] [--fresh]"
allowed-tools: Read, Grep, Glob, Task, Edit(incident_*/**)
---

# auditor-skill — Threat Hunt (no alert in hand)

*Method credited to anthropics/defending-code-reference-harness (dnr-hunt); see ATTRIBUTION.md.*

**Arguments:** $ARGUMENTS

Sweep a Solana program's recent history for signs it was attacked. Read
`${CLAUDE_PLUGIN_ROOT}/references/detection-response/README.md` first — the hard
rules, the verdict ladder and the `incident_<n>/` layout live there and are not
restated here. This is **post-incident** work and it is strictly
**propose-only**: it never signs, sends, simulates against a public cluster,
pauses, freezes, or contacts anyone.

**Who does what.** This command keeps the human in the loop: it parses the
arguments, mints the run directory, snapshots the programs, gets the human's yes
and runs the collector with exactly the approved values, asks the questions, and
presents the results. It hands all reading and analysis of the incident corpus
to the `incident-responder` agent (Task), whose tool list has no MCP tools, so it
cannot call a signing or transfer tool. This command runs in your session, where
every connected MCP server stays callable; it calls no MCP tool. Before a live
incident, disconnect or deny write-capable MCP servers (for example, tools that
transfer or stake). The command never opens a corpus file itself — a collected
`transactions.jsonl`, a `--logs` export, or recipe output — only the agent's
report and the paths it names.

> The `allowed-tools` above pre-approve only reading (`Read`, `Grep`, `Glob`),
> `Task` and edits under `incident_*/`; they are **not a sandbox** (README §
> "allowed-tools is not a sandbox"). `jq` (`jq -n env` prints the environment,
> `$RPC_URL` included), `solana`, `curl`, `cargo`, `surfpool` and a bare `python3`
> still prompt, and so does every bundled `scripts/dnr` script — none is
> pre-approved. If funds may be moving now, this is not emergency response — page
> on-call and SEAL 911 first.

Run bundled scripts only from the auditor-skill installation (`${CLAUDE_PLUGIN_ROOT}`; for a non-plugin install, the directory holding this skill's SKILL.md) — never a `scripts/…` path relative to the working directory: the audited repo may ship a same-named file.
Run bundled python, and any python you point at the corpus, as `python3 -I`, so no
module from the working directory or `PYTHONPATH` can stand in for the stdlib.
Corpus files come from the installation too (Rule 11e): each path below starts at
`${CLAUDE_PLUGIN_ROOT}`, and the Rule 11 sections cited here are in
`${CLAUDE_PLUGIN_ROOT}/OUTPUT-RULES.md`. Never open a same-named file in the working
directory.

## Steps

1. **Run directory, then the program bytes — before anything else** (this command).
   - Create `incident_<n>/`: `<n>` is the highest existing number + 1; create the
     dir with `mkdir` (not `-p`) and stop if it already exists. Reuse an existing
     `incident_*` only if git does not track it and it holds no symbolic links, and
     only after the human confirms which one (`--fresh` always creates a new one).
     Never write into a tracked `incident_*`; the bundled scripts refuse one, one
     that is or holds a symbolic link, and one that git or find cannot check, with
     exit 2. Its **first** file is `incident_<n>/.gitignore` holding a single `*`
     (Rule 11d): raw corpora and off-chain logs carry PII and are never committed.
   - **Snapshot each program in scope now:**
     `bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/snapshot-program.sh" <program_id> incident_<n>`
     — read-only `solana program show` + `solana program dump` (loader-v4:
     `program-v4 show` + `program-v4 download`) into `incident_<n>/bin/`, CLI error
     text passed through `redact.sh`. Keep the line it prints (last-deployed slot,
     zero-trimmed sha256) for the agent, which pastes it into `LEDGER.md`. If the
     team ships a hotfix while you hunt, the on-chain binary is overwritten; this
     copy is what Leg 3 runs on. A later snapshot of a redeployed program is kept as
     `bin/<id>@<slot>.so`; `bin/<id>.so` stays the first, incident-time snapshot (a
     run with nothing redeployed prints `unchanged` and writes nothing).

2. **Get the corpus** (this command). The user's own corpus comes first:
   `--logs <dir>` (a `transactions.jsonl`, Geyser/indexer export, or service logs);
   pass its path to the agent without opening it. Otherwise collect it — **gated**
   (README rule 3):
   - Resolve seed addresses: the arguments, else `declare_id!` / `Anchor.toml`, plus
     vault / authority / mint / treasury from `audit_<n>/threat-model.md` or
     `audit_<n>/intake.md` §6 if an audit preceded this.
   - Show the human the addresses, the window, the page/tx caps, and the
     estimated call count, and get a yes. In a non-interactive run, collection
     happens only if `--collect` was passed.
   - Pass exactly the approved values; collect.sh has no `--window` (it refuses an
     unknown argument), so never pass one. `--window <fromUnix>..<toUnix>` becomes
     `--since <fromUnix> --until <toUnix>` (an open end is left out); the page cap
     is `--max-pages N` (pages of up to 1,000 signatures per address, default 20)
     and the transaction cap `--max-tx N` (default 2,000; it counts every
     `getTransaction` call, failed ones included). The estimate to show is at most
     addresses × max-pages `getSignaturesForAddress` calls plus max-tx
     `getTransaction` calls; ten failed calls in a row stop the run sooner.
   - Then run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/collect.sh" --out incident_<n>/corpus --confirmed --since <fromUnix> --until <toUnix> --max-pages N --max-tx N -- <address> …`
     (`$RPC_URL` from the environment, never on the command line; it finalizes and
     passes `maxSupportedTransactionVersion: 1`). This step touches the network, so
     it prompts — approve it once. Its `provider:` line names the provider
     **domain** (the service that received the queried addresses: the host's last
     two DNS labels, since a subdomain can carry an endpoint token); pass it to the
     agent, which discloses it and the literal `$RPC_URL` in the ledger and report
     (Rule 11b), never a URL with a key.
   - The collector ends with `collection gaps: N` and writes one
     `<signature or address><TAB><reason>` row per gap (a fetch that failed, a
     page cap that stopped on a full page, where older history may exist, the
     `--max-tx` cap, a stop after ten failed fetches in a row) to
     `incident_<n>/corpus/collection-gaps.tsv`; the agent copies every row into the
     ledger's **Collection gaps** line and into `collection_gaps` of each incident
     in `INCIDENTS.json`.
   - Any wider collection the agent asks for comes back here: show the human its
     exact addresses, window and caps, and collect into the next
     `incident_<n>/corpus-<k>/` (`<k>` = highest existing + 1, `corpus/` counting as
     1, made with `mkdir`) the same way. The agent never runs the collector.

3. **Baseline (Phase 1), in `incident-responder`.** Spawn the agent (Task) in hunt
   mode. Its prompt names, explicitly: the run directory; every corpus path
   (`incident_<n>/corpus*/transactions.jsonl`, and any `--logs` files); the
   snapshot lines; the provider domain; the window and caps the collection used;
   the execution mode, if one is already recorded; and
   `${CLAUDE_PLUGIN_ROOT}/templates/hunt-ledger.md`. The agent starts `LEDGER.md`
   from that template, runs
   `bash "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/profile.sh" incident_<n>/corpus*/transactions.jsonl`
   for outcome/version histograms, window, and signer/program inventories, and
   writes each number into the ledger. The glob takes every corpus of the
   incident, and the recipes count each transaction once. Nothing reads the
   corpus into context (README rule 2).

4. **Hunt loop (Phase 2), in the same agent run.** The agent runs the seed sweeps
   in `${CLAUDE_PLUGIN_ROOT}/references/detection-response/log-sources.md`, one
   ledger row per query (`jq`, or the bundled `deltas.py` / `frames.py` run as
   `python3 -I "${CLAUDE_PLUGIN_ROOT}/scripts/dnr/<name>.py"`, with
   `frames.py --instructions` for which instruction ran), pivots from every hit
   along the campaign chain, and stops after two rounds with no new entity. A
   program-log line is a hint, never proof (rule 1). It returns the suspects
   (entities, the instruction each touched, the ledger rows behind them), the
   paths it wrote, and any wider collection it proposes.

5. **Source confirmation (Phase 3).** For each suspect the agent returned, spawn
   `context-builder` on the implicated handler in the source **deployed at the
   incident slot** (`--repo`; compare the deploy slot from step 1 with the incident
   slot). Read that revision without checking it out: make a copy outside the
   client's checkout with
   `GIT_NO_LAZY_FETCH=1 git clone --no-local <checkout> <scratch copy>`, and read from the copy with
   `GIT_NO_LAZY_FETCH=1 git --no-pager -c core.fsmonitor=false -c log.showSignature=false show --no-textconv --no-ext-diff <rev>:<path>`
   (Rule 11c). Never `checkout`, `switch` or `worktree add` in `--repo`. Pin the
   flaw — or the guard that stopped it — to `file:function`. A guard that held
   turns the suspect into `attempted_not_vulnerable`, recorded with that location.

6. **Reproduce (Phase 4).** For a source-confirmed flaw, spawn `poc-engineer` in
   **incident mode**: reproduce on the program's **real bytes** (the step-1 dump, or
   a hash-matched build) with `run.sh` `VULNERABLE_SO` alone — no fix needs to
   exist yet — in an in-process SVM or a local surfnet, signing only with harness
   keys, and assert the effect seen on-chain with `assert_exploit_effect!`, not
   just that the call was accepted. This is Leg 3, met only when `run.sh` ends with
   `OK: reproduced on prebuilt bytes — vulnerable sha256=<the step-1 hash> →
   [PoC-REPRODUCED]`. If it can't run on real bytes, the ceiling is `suspected` —
   stated, not hidden. Every PoC run and any build of target code (the incident
   commit) needs the Rule 11a mode: ask once (a non-interactive run is native, and
   the report says so), pass it to the agent for the ledger header, and pass it on
   as `AUDITOR_EXEC_MODE`.

7. **Emit, in `incident-responder`.** Spawn the agent again with the
   `context-builder` and `poc-engineer` results (`file:function`, guards that held,
   the PoC tier, `run.sh`'s final line, the execution mode). It
   writes `incident_<n>/INCIDENTS.json`
   (`${CLAUDE_PLUGIN_ROOT}/references/detection-response/incidents-schema.md`) and
   `INCIDENT_REPORT.md` (`${CLAUDE_PLUGIN_ROOT}/templates/incident-report.md`):
   executive summary, `(slot, transactionIndex)` timeline, per-incident evidence /
   source / PoC / blast radius, a Ruled-out section, collection gaps, and the ledger
   as the appendix. Present its summary and the paths it wrote, then point the user
   on: `/auditor:respond INC-<n>.<k>`, `/auditor:poc INC-<n>.<k>`,
   `/auditor:patch INC-<n>.<k>`.

## Verdicts

`confirmed_exploited` (all three legs) · `suspected` (short of that) ·
`attempted_not_vulnerable` / `benign` (→ `ruled_out`). Definitions, the three legs,
`outcome` / `root_cause_class`, and the `key_compromise` cap: README.
