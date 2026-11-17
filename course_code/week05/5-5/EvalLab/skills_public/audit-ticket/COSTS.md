# Estimated Audit Costs by Model

> Last updated: April 2026
> These are estimates based on actual token consumption from auditing a medium-complexity Solana DeFi monorepo (~46K lines of code across Rust, TypeScript backend, and Next.js frontend).

---

## Token Consumption Breakdown

Every audit consumes tokens in two categories:

> Token figures below use the **~4 chars/token** rule of thumb (measured against the on-disk corpus). "Fixed" means *always loaded, every audit regardless of repo*. Scope-gating and trigger-gating (Rule 0 + SKILL Scope-Gated Loading) moved the checklists, known-vectors, and references out of the fixed floor: only the in-scope subset is ever read.

### Fixed Cost (always-loaded core — same for every repo)
| Component | Tokens | Notes |
|-----------|--------|-------|
| SKILL.md (orchestrator) | ~5K | Read once at start |
| OUTPUT-RULES.md (review-time rules; report-time format lazy-split to `references/report-format.md`) | ~5K | Read once at start |
| FULL-AUDIT.md (execution plan) | ~6K | Read once at start |
| **Fixed total** | **~14–15K** | Same regardless of repo size |

### Variable Cost (scales with repo — only the in-scope subset loads)

**Corpus loaded on demand.** Scope-gated / trigger-gated — a Rust-only repo never loads the Python or TS checklists; a vector loads only when its phase + language/domain trigger fires; a `references/` file loads only when its grep marker matches. The figures are full-corpus upper bounds; a typical single-language audit reads a fraction.

| Component | Tokens (full corpus, upper bound) | Loaded when |
|-----------|-----------------------------------|-------------|
| Checklists (20 files, 1,446 items) | ~50K | per detected language / phase — in-scope only |
| Known vectors (140 procedures) | ~90K | per phase + language/domain trigger — in-scope only |
| References (framework idioms, methodologies, orchestration, report-format) | ~100K | per grep marker — only the matched file |
| Templates + discovery files | ~32K | when a template/discovery step is reached |

**Code + scanning (scales with LOC):**
| Component | Formula | Notes |
|-----------|---------|-------|
| Code reading | ~10 tokens per line of code | Each file read completely |
| Checklist cross-referencing | ~0.3× code tokens | Re-reading checklists per phase |
| grep/terminal outputs | ~0.2× code tokens | Discovery scanning |
| Checkpoint saves/reads | ~0.1× code tokens | Session memory between chunks |
| **Variable multiplier** | **~1.6× code tokens** | |

### Optional: deterministic pre-scan (`audit-scan`)

Running `audit-scan` (built at `<auditor-skill root>/tools/auditor-tools/target/release/audit-scan`, run by that absolute path rather than one relative to the audited repo) first emits the instruction matrix, account-constraint table, PDA-seed catalog, and arithmetic/panic census as one JSON — **deterministically, at ~$0 LLM cost**. The auditor then reasons over that map instead of re-deriving it by reading every file, and can skip full reads of files the scan shows are clean. This collapses the three mechanical multipliers above (checklist cross-ref ~0.3×, discovery scanning ~0.2×, checkpoint re-reads ~0.1×) toward ~0.1× total: on a 50K-line program that removes roughly **200–300K input tokens** (variable multiplier ~1.6× → ~1.0×), e.g. Opus ≈ $32 → ~$20. The tool is optional — without it the auditor falls back to the grep-based walk at the costs above.

### Optional: threat-model bootstrap (`scripts/threat-model/collect.sh`)

Runs only on an explicit `--bootstrap` or when a trigger fires (prior audit or incident in intake, fork provenance, prior audits or incident files next to the target); autonomous runs collect offline. The collector itself costs $0 in LLM tokens (under 5 s on raydium-cp-swap, 51 commits, and orca whirlpools, 962 commits). At the default caps (60 rows per section; keyword commits above 300 changed lines add no ADDED rows) `history.md` adds **~8K input tokens** or less; the saved diffs (≤20 files of ≤400 lines, ~40K tokens if all were read) are opened only for rows cited as evidence.

### Detection & response (`/auditor:hunt`, `/auditor:respond`)

Incident runs are not yet benchmarked; cost scales with ledger rounds × opus, plus the one gated RPC-collection pass (capped).

### Output Tokens (scales with findings)
| Component | Tokens | Notes |
|-----------|--------|-------|
| Per-item verdicts (1,446 items × ~100 tok) | ~120K | 2-4 lines per item |
| Known vectors results (140 × ~800 tok) | ~94K | Evidence per hack |
| Findings + recommendations | ~30K | Depends on issues found |
| Executive summary + tables | ~10K | |
| **Output total** | **~240K** | Relatively stable across repos |

---

## Cost by Repo Size

### Anthropic Models

| Repo Size | Lines | Input Tokens | Output Tokens | **Opus 4** | **Sonnet 4** | **Haiku** |
|-----------|-------|-------------|--------------|------------|-------------|-----------|
| Tiny | 2K | ~150K | ~80K | **$8** | **$2** | **$0.15** |
| Small | 5K | ~200K | ~100K | **$11** | **$2.50** | **$0.20** |
| Medium | 20K | ~430K | ~150K | **$18** | **$4** | **$0.45** |
| Large | 50K | ~910K | ~240K | **$32** | **$7** | **$0.75** |
| Very Large | 100K | ~1.7M | ~350K | **$52** | **$11** | **$1.20** |
| Massive | 500K | ~8.2M | ~800K | **$183** | **$37** | **$4.00** |

> **Pricing used:** Opus 4 ($15/$75 per 1M in/out), Sonnet 4 ($3/$15), Haiku ($0.25/$1.25)
> Opus 4.6 pricing not yet public — estimate 10-30% above Opus 4.

### OpenAI Models

| Repo Size | Lines | Input Tokens | Output Tokens | **o3** | **o4-mini** | **GPT-4.1** |
|-----------|-------|-------------|--------------|--------|------------|-------------|
| Tiny | 2K | ~150K | ~80K | **$5** | **$0.50** | **$1.50** |
| Small | 5K | ~200K | ~100K | **$6** | **$0.65** | **$2** |
| Medium | 20K | ~430K | ~150K | **$10** | **$1.15** | **$4** |
| Large | 50K | ~910K | ~240K | **$19** | **$2** | **$7** |
| Very Large | 100K | ~1.7M | ~350K | **$31** | **$3.50** | **$12** |
| Massive | 500K | ~8.2M | ~800K | **$114** | **$12** | **$45** |

> **Pricing used:** o3 ($10/$40 per 1M in/out), o4-mini ($1.10/$4.40), GPT-4.1 ($2/$8)

---

## Time Estimates

| Model | Tiny (2K) | Small (5K) | Medium (20K) | Large (50K) | Very Large (100K) |
|-------|-----------|------------|--------------|-------------|-------------------|
| Opus 4 (agent) | 10-20 min | 20-35 min | 35-60 min | 60-90 min | 90-150 min |
| Sonnet 4 (agent) | 8-15 min | 15-25 min | 25-45 min | 45-75 min | 75-120 min |
| o3 (agent) | 10-20 min | 20-30 min | 30-50 min | 50-80 min | 80-130 min |
| o4-mini (agent) | 5-12 min | 12-20 min | 20-35 min | 35-55 min | 55-90 min |

> Times assume agent mode with file reading and terminal access. Actual time depends on API rate limits and model response speed.

---

## Quality vs Cost Tradeoffs

| Tier | Recommended Model | Strength | Weakness |
|------|------------------|----------|----------|
| **Maximum depth** | Opus 4 / o3 | Catches subtle logic bugs, economic attack paths, cross-file vulnerabilities | Expensive, slow |
| **Best value** | Sonnet 4 / GPT-4.1 | Good at pattern-matching, grep-based checks, checklist compliance | May miss nuanced semantic bugs |
| **Fast scan** | Haiku / o4-mini | Quick grep-heavy vulnerability scan, CI/CD integration | Will miss logic bugs, weak at reasoning about attack paths |

### Recommended Strategy

For production audits, **two-pass approach**:
1. **Pass 1 (fast/cheap):** Sonnet or o4-mini runs all grep-based checks, known vectors, and checklist items that are pattern-matchable (~70% of items)
2. **Pass 2 (deep/expensive):** Opus or o3 reviews only the code that handles money, auth, and state transitions (~30% of items but highest value)

Estimated cost for two-pass on a 50K-line repo: **~$12-15** (vs $32 for full Opus)

---

## How to Track Actual Costs

Every API response includes token usage. Track per-audit:

```python
# Python example
audit_usage = {"input_tokens": 0, "output_tokens": 0}

for response in audit_chunks:
    audit_usage["input_tokens"] += response.usage.input_tokens
    audit_usage["output_tokens"] += response.usage.output_tokens

cost = (
    audit_usage["input_tokens"] * INPUT_RATE +
    audit_usage["output_tokens"] * OUTPUT_RATE
)
print(f"Audit cost: ${cost:.2f}")
```

```typescript
// TypeScript example
interface AuditUsage {
  inputTokens: number;
  outputTokens: number;
}

function calculateCost(usage: AuditUsage, model: 'opus' | 'sonnet'): number {
  const rates = {
    opus:   { input: 15 / 1e6, output: 75 / 1e6 },
    sonnet: { input: 3 / 1e6,  output: 15 / 1e6 },
  };
  const r = rates[model];
  return usage.inputTokens * r.input + usage.outputTokens * r.output;
}
```

---

## SaaS Pricing Suggestion

If offering as a service:

| Tier | Repo Limit | Model | Your Cost | Suggested Price | Margin |
|------|-----------|-------|-----------|-----------------|--------|
| Free trial | ≤2K lines | Haiku | $0.15 | $0 | Loss leader |
| Basic | ≤10K lines | Sonnet | $3 | $29 | 90% |
| Pro | ≤50K lines | Opus | $32 | $149 | 79% |
| Enterprise | ≤500K lines | Two-pass | $50 | $499 | 90% |

> Add 10-15% for compute/infrastructure overhead (server, queue, storage, bandwidth).
