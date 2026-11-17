# INCIDENTS.json — the `auditor-incidents/1` shape

*Field vocabulary credited in part to anthropics/defending-code-reference-harness; see ATTRIBUTION.md.*

> **Load when:** writing or reading `incident_<n>/INCIDENTS.json`. The verdict
> ladder, the legs, and `outcome` / `root_cause_class` / `urgency` are defined in
> `references/detection-response/README.md`; this file is only the serialized
> shape.

One file per run directory, written by `/auditor:hunt` and enriched by
`/auditor:respond`. Readers must tolerate unknown extra keys; a breaking change
bumps the `schema` string to `auditor-incidents/2`.

```json
{
  "schema": "auditor-incidents/1",
  "target": "<program name or address, or the logs dir>",
  "incidents": [
    {
      "id": "INC-1.1",
      "title": "<short summary of the incident>",
      "verdict": "confirmed_exploited | suspected",
      "outcome": "succeeded | failed | partial | undetermined",
      "urgency": "immediate | urgent | routine",
      "root_cause_class": "code_flaw | key_compromise | oracle_or_dependency | economic_design | off_chain | supply_chain_or_ci | unknown",
      "vuln": {
        "program": "<program id>",
        "instruction": "<instruction name or discriminator>",
        "file": "<path in the deployed source>",
        "function": "<fn>",
        "line": 0,
        "mechanism": "<the missing/wrong check, one line>",
        "severity": 8,
        "kv": ["KV-020"],
        "checklist": ["AC-052"]
      },
      "attacker": {
        "signers": ["..."],
        "fee_payers": ["..."],
        "programs": ["<attacker-deployed program ids>"],
        "funding_sources": ["..."]
      },
      "transactions": [
        {"signature": "...", "slot": 0, "transaction_index": 0, "err": null, "role": "probe | exploit | cash_out"}
      ],
      "timeline": [{"slot": 0, "ts": "<iso, est>", "event": "..."}],
      "blast_radius": {
        "records": 0,
        "distinct_victims": 0,
        "window": {"from_slot": 0, "to_slot": 0},
        "by_mint": [{"mint": "...", "decimals": 0, "raw_out": "0"}]
      },
      "binary_provenance": "dumped-unchanged | dumped-after-hotfix | rebuilt-hash-match | source-only | none",
      "evidence": ["<file>: <pipeline> -> <result>"],
      "poc": {
        "tier": "PoC-REPRODUCED | PoC-SIM-REPRODUCED | PoC-FUZZ-REPRODUCED | PoC-ATTEMPTED | PoC-PROSE | null",
        "path": "incident_<n>/poc/INC-1.1/",
        "command": "AUDITOR_EXEC_MODE=<isolated|native> VULNERABLE_SO=<incident .so> [FIXED_SO=<fixed .so>] ./run.sh",
        "verified": true,
        "negative": "null | rejected with the pinned error | blocked: failed, account unchanged"
      },
      "collection_gaps": ["<what the corpus could not answer — never a URL>"],
      "response_plan": "RESPONSE-INC-1.1.md"
    }
  ],
  "ruled_out": [
    {"verdict": "attempted_not_vulnerable | benign", "subject": "...",
     "reason": "<guard location as file:function, or why the activity is legitimate>"}
  ]
}
```

## Field rules

- **`id`** is run-qualified `INC-<n>.<k>` (README). `/auditor:poc` and
  `/auditor:patch` resolve this exact string against this run's file.
- **Where entries go.** Only `confirmed_exploited` and `suspected` belong in
  `incidents[]`; `attempted_not_vulnerable` and `benign` are filed in
  `ruled_out[]`. The one subtlety:
  `suspected` + `outcome: failed` + `poc.verified: true` ("a real flaw was
  attacked and has not landed yet") stays in `incidents[]` — it is a live
  exposure, not a non-event.
- **`vuln`** is a Rule 5b finding with its blocks filled from the *observed*
  incident, so a later `/auditor:threat-model --bootstrap` or audit can ingest it
  as a prior vulnerability. `severity` is the 1–10 finding severity;
  `incident.urgency` is the separate response-speed label and never collides with
  it.
- **`binary_provenance`** records which bytes Leg 3 ran against:
  `dumped-unchanged` (on-chain ELF, last-deployed slot earlier than the incident,
  loader checked), `rebuilt-hash-match` (`solana-verify`, SC-054 / KV-137),
  `dumped-after-hotfix` (a later upgrade overwrote the incident binary — dump and
  hash anyway, provenance noted), `source-only` or `none` (Leg 3 unmet → ceiling
  `suspected`).
- **`poc`** records the run as made. `command` carries `AUDITOR_EXEC_MODE` and
  `VULNERABLE_SO`, plus `FIXED_SO` when a fixed arm ran. `verified` is true only
  when `run.sh` ended with `OK: reproduced on prebuilt bytes — vulnerable
  sha256=<hash>`, `<hash>` being the snapshot's. `negative` is how the fixed arm
  held: `rejected with the pinned error` for our patch, `blocked: failed, account
  unchanged` for a deployed hotfix, or null when no fixed arm ran.
- **`evidence`** strings are `"<source file>: <pipeline> -> <result>"` — the query
  that produced each number (hard rule 5). Never a URL, never a secret.
- **`collection_gaps`** holds every row of the collector's
  `corpus*/collection-gaps.tsv`, as `"<signature or address>: <reason>"` (a fetch
  that failed, a page cap that stopped on a full page, where older history may
  exist, the `--max-tx` cap, a stop after ten failed fetches in a row), plus the
  gaps the run found itself (provider retention, a `Log truncated` tail, a sibling
  address not collected). The same rows go into LEDGER.md.
- **Secrets / PII.** No RPC URL anywhere, including `collection_gaps`. Victim and
  attacker wallet lists stay in this file inside `incident_<n>/`, which is
  git-ignored; they are not lifted into any shared report.

## The stable read surface for the threat-model bootstrap and audits

A consumer (the threat-model bootstrap, a later audit) reads only: top-level
`schema` and `incidents[]`; per incident `id`, `verdict`, `outcome`,
`root_cause_class`, `vuln.{program,instruction,file,function,line,mechanism,severity,kv,checklist}`,
`poc.tier`, and optionally `urgency`. The threat-model bootstrap reads that surface
except `vuln.severity` and `urgency`, which it leaves out by design. A consumer never reads `attacker`, `transactions`,
`timeline`, `blast_radius`, `evidence`, `binary_provenance`, `collection_gaps` or
`response_plan`, and never the `ruled_out[]` list. These read fields are stable
across runs within `auditor-incidents/1`.
