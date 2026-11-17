# Response plan — INC-{N}.{k}: {title}

<!-- credited to anthropics/defending-code-reference-harness; see ATTRIBUTION.md.
     templates/response-plan.md → incident_<n>/RESPONSE-INC-<n>.<k>.md, written by
     /auditor:respond. One plan per lead; never overwrite another lead's plan.
     Action menu and rules: references/detection-response/containment-playbook.md. -->

> **Every item below is a proposal. None of it has been carried out.** The track
> does not sign, send, pause, freeze, upgrade, rotate, or contact anyone — a human
> reviews each item and executes or rejects it.

> If funds are moving **now**, this write-up is not the response. Page on-call,
> run the pause/freeze runbook, and open a SEAL 911 ticket (`@seal_911_bot`;
> verify any member who contacts you via the bot's keyword step).

## 1. Verdict & summary

{At most three sentences: the event, whether the attacker achieved it, and the
extent. Name the verdict and the single piece of evidence that decides it (read at
`finalized`).}

## 2. Timeline

{The merged `(slot, transactionIndex)` timeline for this incident's entities.}

## 3. Containment (proposed)

Every row carries the query result behind it, the signer it needs, whether it can
be undone, and the cost if the proposal is mistaken. See `containment-playbook.md`
for the menu and the "do not" list (never `program close`, never `--final`).

| Action | Why (evidence) | Who signs | Reversible | Risk if wrong |
|--------|----------------|-----------|-----------|---------------|
| {pause / freeze / rotate / limit} | {query result} | {authority / multisig} | {yes/partial} | {…} |

## 4. Eradication & remediation (proposed)

- **Code fix:** {file:function; the guard to restore}. Hand off as a
  `/auditor:patch INC-{N}.{k}` vuln entry. The stored PoC keeps the incident-time
  bytes as `VULNERABLE_SO`; `FIXED_SO` is **our proposed patch build**. The fix holds
  only on a rejection with the guard's exact error (`assert_exploit_rejected_with!`):
  `run.sh` ends with `… fixed sha256=<our build> (rejected with the pinned error) →
  [PoC-REPRODUCED]`.
- **The team's own hotfix** (if one is already deployed) is a separate check, in a
  copy of the PoC crate whose `tests/fixed_blocked.rs` uses the template's commented
  `assert_exploit_blocked!` and its positive control (their error is not known in
  advance, so a legitimate call must go through on the same bytes and change the
  account): re-run with `FIXED_SO` set to a fresh dump of the **current on-chain**
  bytes. It holds when `run.sh` ends with `… fixed sha256=<that dump> (blocked:
  failed, account unchanged) → [PoC-REPRODUCED]`; exit 3 (no assertion ran, a harness
  error, a control that failed) is inconclusive, not a broken fix. When no legitimate
  call can show the change on the live bytes, pin the hotfix's error with
  `assert_exploit_rejected_with!` instead. Report the two results apart — ours
  proves the proposal, theirs proves what is live.
- **Stop-gap while the code fix is pending:** {the containment row that holds the
  line until then}.

## 5. Recovery (proposed)

- Credentials to rotate: {the queried list — not "everything"}.
- Customers to notify: {the distinct-victim list from the blast-radius query —
  internal; do not publish wallet lists}.
- Confirm-clean signal: {what to watch to know the attacker is out}.

## 6. Coordination & comms (drafts only)

{Draft text for a human to send — SEAL 911, the token issuer/desk for a freeze,
affected protocols, and cited exchanges/bridges on the fund-flow path. The agent
sends nothing. Never attribute an address to a named person.}

## 7. Detection engineering (proposed)

Turn the queries that found this into standing alerts, mapped to checklist 17:
{e.g. LM-030 anomalous withdrawals, LM-037 upgrade-authority change, LM-038
unexpected mint, LM-063 off-chain consumer trusting logs, LM-065 stream liveness}.
Note which existing alerts fired and which were noise.

## 8. Open questions

{Questions the collected data can't resolve: theft vs. authorized use of a key
(chain data can't tell them apart — the reason `key_compromise` caps at
`suspected`), history older than the provider retains, and whether anything taken
was reused on other platforms.}
