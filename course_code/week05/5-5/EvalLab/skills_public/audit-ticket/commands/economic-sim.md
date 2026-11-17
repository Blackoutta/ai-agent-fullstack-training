---
name: auditor:economic-sim
description: Quantify a candidate economic finding — compute attack cost vs extractable value and, when possible, reproduce deposit→manipulate→withdraw against a Surfpool mainnet-fork for a real P/L figure.
argument-hint: "<finding-or-instruction>"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# auditor-skill — Economic Simulation

**Arguments:** $ARGUMENTS

1. Model the attack: capital / setup cost, extractable value, atomicity (single-tx / multi-slot), flash-loanable ceilings per venue.
2. Compute whether profit > cost at any manipulation level (e.g. cost to move spot price 1 / 5 / 10 %).
3. If a Surfpool mainnet-fork is available, reproduce the sequence against forked pool state and record the net P/L. The fork fetches that state from its RPC datasource, which receives the program ids and account addresses it reads: record the provider domain (the host's last two DNS labels) for the report's outside-service disclosure (`OUTPUT-RULES.md` Rule 11b), never a URL with a key.
4. Produce the quantified PoC that Rule 5b requires for High / Critical economic findings — dollar figures, not yes/no.
