# Pre-Audit Questionnaire

> These questions must be answered before running a full audit.
> The auditor agent uses these answers to contextualize findings, skip N/A sections, and calibrate severity.
> Most are multiple-choice or yes/no. Some require short text answers.
>
> **For automated pipelines:** parse this as YAML or collect via form UI.
> **For manual use:** copy this file, fill in your answers, and include it when invoking the audit.

---

## Section 1: Project Overview

### Q1. Project type
What kind of project is this?
- [ ] DeFi protocol (DEX, lending, staking, yield)
- [ ] NFT / digital collectibles
- [ ] DAO / governance
- [ ] Payment / wallet infrastructure
- [ ] Gaming / metaverse
- [ ] Social / identity
- [ ] Infrastructure / tooling
- [ ] Other: _______________

### Q2. Blockchain
Which blockchain(s) does this project target?
- [ ] Solana
- [ ] Ethereum / EVM
- [ ] Multiple chains (cross-chain)
- [ ] None (off-chain only)
- [ ] Other: _______________

### Q3. Smart contract framework
If on-chain code exists, what framework is used?
- [ ] Anchor (Solana)
- [ ] Native Solana (no framework)
- [ ] Solidity / Hardhat / Foundry
- [ ] Rust (non-Solana)
- [ ] Not applicable (no smart contracts)
- [ ] Other: _______________

### Q4. Backend framework
- [ ] Express.js (Node)
- [ ] Fastify
- [ ] NestJS
- [ ] Django / Flask (Python)
- [ ] Go (net/http, Gin, Fiber)
- [ ] Ruby on Rails
- [ ] No backend
- [ ] Other: _________ts______

### Q5. Frontend framework
- [ ] Next.js (React)
- [ ] React (CRA / Vite)
- [ ] Vue / Nuxt
- [ ] Svelte / SvelteKit
- [ ] No frontend
- [ ] Other: _______________

### Q6. Database
- [ ] MongoDB
- [ ] PostgreSQL
- [ ] MySQL
- [ ] Firebase / Firestore
- [ ] Supabase
- [ ] Redis only
- [ ] No database
- [ ] Other: _______________

### Q7. Monorepo structure?
- [ ] Yes — monorepo (Turborepo, Nx, Lerna, or workspace)
- [ ] No — single package
- [ ] Multiple repos (list them): _______________

---

## Section 2: Deployment & Environment

### Q8. Current deployment status
- [ ] Not yet deployed (pre-launch)
- [ ] Deployed on testnet/devnet only
- [ ] Deployed on mainnet (live with real funds)
- [ ] Deprecated / no longer maintained

### Q9. Deployment platform
- [ ] Render
- [ ] Vercel
- [ ] AWS (EC2, ECS, Lambda)
- [ ] GCP (Cloud Run, Cloud SQL, Terraform-managed)
- [ ] Heroku
- [ ] Self-hosted VPS
- [ ] Other: _______________

### Q10. Total Value Locked (TVL) or funds at risk
How much value does the protocol currently manage?
- [ ] $0 (not launched)
- [ ] <$10K
- [ ] $10K–$100K
- [ ] $100K–$1M
- [ ] $1M–$10M
- [ ] >$10M
- [ ] Unknown

> **Why this matters:** Severity calibration. A missing signer check is Severity 10 for a $10M protocol but may be Severity 7 for a $1K testnet deployment.

### Q11. Is the smart contract upgradeable?
- [ ] Yes — upgrade authority is a single wallet
- [ ] Yes — upgrade authority is a multisig
- [ ] Yes — upgrade authority is a DAO/governance
- [ ] No — program is frozen/immutable
- [ ] Not applicable

### Q12. Is the source code public?
- [ ] Yes — fully open source
- [ ] Partially — smart contract public, backend private
- [ ] No — fully private
- [ ] Planning to open source

---

## Section 3: Authentication & Access Control

### Q13. How do users authenticate?
- [ ] Wallet signature (Solana/Ethereum wallet)
- [ ] JWT tokens
- [ ] OAuth (Google, GitHub, etc.)
- [ ] Hosted auth provider (Clerk, Auth0, WorkOS, Supabase Auth)
- [ ] API keys (consumed from a third party)
- [ ] API keys (issued by this project to its own customers)
- [ ] Session cookies
- [ ] No authentication
- [ ] Multiple: _______________

### Q14. Are there different user roles?
- [ ] Yes — admin/manager and regular users
- [ ] Yes — multiple tiers (admin, manager, investor, viewer, etc.)
- [ ] No — all users have equal access
- [ ] Describe roles: _______________

### Q15. Is there an admin panel or admin API?
- [ ] Yes — web-based admin UI
- [ ] Yes — admin API endpoints only
- [ ] No admin functionality
- [ ] Admin is on-chain only (program authority)

### Q16. How are admin actions protected?
- [ ] Wallet signature (same as upgrade authority)
- [ ] Separate admin JWT/session
- [ ] IP allowlist
- [ ] VPN-only access
- [ ] Not protected (❌ this is a finding)
- [ ] Not applicable

---

## Section 4: Financial Operations

### Q17. Does the protocol handle user funds?
- [ ] Yes — users deposit tokens/SOL into protocol-controlled accounts
- [ ] Yes — users approve spending but funds stay in their wallet
- [ ] No — no financial operations

### Q18. What tokens are supported?
- [ ] SOL / WSOL only
- [ ] SOL + specific SPL tokens (list): _______________
- [ ] Any SPL token
- [ ] Token-2022 (token extensions) supported
- [ ] Supported-token set is resolved from a third-party registry / token list at runtime (tokens.xyz, Jupiter list, CoinGecko): _______________
- [ ] ERC-20 tokens
- [ ] Not applicable

### Q19. Does the protocol integrate with DEXes?
- [ ] Yes — Jupiter (Solana)
- [ ] Yes — Raydium
- [ ] Yes — Orca
- [ ] Yes — Uniswap / Sushiswap (EVM)
- [ ] No DEX integration
- [ ] Other: _______________

### Q20. Does the protocol charge fees?
- [ ] Yes — management fee (% of AUM)
- [ ] Yes — performance fee (% of profits)
- [ ] Yes — transaction/swap fee
- [ ] Yes — withdrawal fee
- [ ] No fees
- [ ] Describe fee structure: _______________

### Q21. Is there a withdrawal process?
- [ ] Instant withdrawal
- [ ] Multi-step withdrawal (initiate → wait → finalize)
- [ ] Time-locked withdrawal (cooldown period)
- [ ] Admin-approved withdrawal
- [ ] No withdrawals (one-way deposit)
- [ ] Describe: _______________

---

## Section 5: External Integrations

### Q22. Which external APIs does the protocol use?
- [ ] Jupiter API (swap quotes)
- [ ] Helius (RPC, webhooks)
- [ ] Birdeye (token prices)
- [ ] CoinGecko / CoinMarketCap
- [ ] Token registry / risk API (tokens.xyz, RugCheck, Webacy, GoPlus) — used for: display / listing / collateral / routing: _______________
- [ ] Geyser / Yellowstone gRPC stream or a transaction / block indexer (reads `getTransaction` / `getBlock` / `blockSubscribe`)
- [ ] Fee sponsorship / paymaster / co-signing — this project signs as fee payer or second signer for user-built transactions
- [ ] Chainlink / Pyth (oracles)
- [ ] Stripe / payment processor
- [ ] Analytics (Mixpanel, Amplitude, etc.)
- [ ] Error tracking (Sentry, etc.)
- [ ] None
- [ ] Other: _______________

### Q23. Does the protocol use oracles for pricing?
- [ ] Yes — Pyth Network
- [ ] Yes — Switchboard
- [ ] Yes — Chainlink
- [ ] Yes — custom oracle / API-based pricing
- [ ] No — prices from DEX quotes only
- [ ] No — no price feeds needed

### Q24. Does the protocol use cross-program invocations (CPI)?
- [ ] Yes — Token Program (SPL transfers)
- [ ] Yes — Associated Token Program
- [ ] Yes — DEX program (Jupiter, Raydium, etc.)
- [ ] Yes — Staking program
- [ ] Yes — Other: _______________
- [ ] No CPI
- [ ] Not applicable (no smart contract)

---

## Section 6: Security History

### Q25. Has this code been audited before?
- [ ] Yes — by a professional audit firm (name): _______________
- [ ] Yes — internal review only
- [ ] Yes — automated tools only (name): _______________
- [ ] No — first audit

### Q26. Has the protocol experienced any security incidents?
- [ ] Yes — fund loss (amount): _______________
- [ ] Yes — exploit attempt (blocked successfully)
- [ ] Yes — data breach
- [ ] No known incidents
- [ ] Prefer not to disclose

### Q27. Is there a bug bounty program?
- [ ] Yes — public (platform): _______________
- [ ] Yes — private/invite-only
- [ ] No — planning to create one
- [ ] No

### Q28. Do you have incident response procedures?
- [ ] Yes — documented and tested
- [ ] Yes — documented but untested
- [ ] Informal / ad-hoc
- [ ] No

---

## Section 7: Development Practices

### Q29. How many developers have access to the repository?
- [ ] 1 (solo developer)
- [ ] 2-5
- [ ] 6-20
- [ ] 20+

### Q30. Do you use branch protection?
- [ ] Yes — PRs required, reviews required
- [ ] Yes — PRs required, no mandatory reviews
- [ ] No — anyone can push to main
- [ ] Not applicable (solo dev)

### Q31. Do you have CI/CD?
- [ ] Yes — GitHub Actions
- [ ] Yes — GitLab CI
- [ ] Yes — Other: _______________
- [ ] No CI/CD

### Q32. Do you run automated tests?
- [ ] Yes — unit tests
- [ ] Yes — integration tests
- [ ] Yes — end-to-end tests
- [ ] Yes — Anchor program tests
- [ ] No automated tests

### Q33. Do you use a secret scanner?
- [ ] Yes — GitHub secret scanning
- [ ] Yes — gitleaks / trufflehog / detect-secrets
- [ ] Yes — pre-commit hooks with secret detection
- [ ] No secret scanning

### Q34. What's your dependency update strategy?
- [ ] Dependabot / Renovate (automated PRs)
- [ ] Manual periodic updates
- [ ] Pin exact versions and update carefully
- [ ] No strategy — install once and forget
- [ ] 14-day quarantine rule (never install packages <14 days old)

---

## Section 8: Compliance & Legal (Optional)

### Q35. Which regulatory frameworks apply?
- [ ] None / not sure
- [ ] MiCA (EU crypto regulation)
- [ ] SEC regulations (US)
- [ ] GDPR (EU data privacy)
- [ ] SOC 2
- [ ] DORA (EU digital resilience)
- [ ] Other: _______________

### Q36. Do you collect personally identifiable information (PII)?
- [ ] No — wallet addresses only
- [ ] Yes — email addresses
- [ ] Yes — names / identity documents (KYC)
- [ ] Yes — financial data beyond on-chain
- [ ] Describe: _______________

### Q37. Do you have a privacy policy?
- [ ] Yes — published on website
- [ ] Draft / in progress
- [ ] No

### Q38. Where are your servers located?
- [ ] US
- [ ] EU
- [ ] Asia
- [ ] Multi-region
- [ ] Don't know / managed by cloud provider

---

## Section 9: Scope & Priorities

### Q39. What should this audit focus on?
Select all that apply, or choose "Full":
- [ ] **Full audit** (everything)
- [ ] Smart contract / on-chain program only
- [ ] Backend API only
- [ ] Frontend only
- [ ] DevOps / infrastructure only
- [ ] Secrets & key management only
- [ ] Supply chain / dependencies only
- [ ] Specific files/modules: _______________

### Q40. What are your top security concerns?
Rank your top 3:
- [1 ] Fund theft / drain
- [ ] Private key compromise
- [2 ] API abuse / DDoS
- [ ] Data breach / PII leak
- [ ] Regulatory non-compliance
- [3 ] Supply chain attack
- [ ] Insider threat
- [ ] Operational security
- [ ] Other: _______________

### Q41. Desired audit depth
- [ ] **Quick scan** — grep-based pattern matching, known vector check (~30 min, lowest cost)
- [ ] **Standard** — full checklist + known vectors, file-by-file review (~1-2 hours)
- [ ] **Deep** — standard + economic attack scenarios, cross-file analysis, formal property verification (~2-4 hours)
- [ ] **Maximum** — deep + manual verification steps, infrastructure review, compliance check (~4-8 hours)

### Q42. Report delivery preference
- [ ] Markdown file in repo
- [ ] JSON (machine-parseable)
- [ ] Both markdown and JSON
- [ ] PDF (formatted)

---

## Section 10: Repository Access

### Q43. How will the auditor access the code?

**Option A: Open-source repo (recommended for public projects)**
```
Repository URL: _______________
Branch to audit: _______________
Commit hash (optional): _______________
```

**Option B: Local checkout in the auditor's workspace (recommended for private repos)**
```
Install auditor-skill outside your repository (the plugin, or a user-level skill
such as ~/.claude/skills/auditor-skill; OUTPUT-RULES.md Rule 11e), then invoke
the audit from your IDE's AI agent in the repository.
```

**Option C: Upload files (for web-based service)**
```
Upload a ZIP/tar of your repository (without node_modules, .git, build artifacts).
Max size: ___ MB
```

### Q44. Any files or directories to EXCLUDE from audit?
```
Exclude patterns (one per line):
_______________
_______________
_______________
```

### Q45. Any additional context the auditor should know?
```
Free text — known issues, recent changes, areas of concern, etc.:
_______________
```

---

## Section 11: Audit Execution

### Q46. Where may the auditor run the project's own code?
Building, testing or installing the project runs code the project controls — build scripts, proc-macros, test suites, `Anchor.toml` scripts, package install hooks. Asked once per audit; see `OUTPUT-RULES.md` Rule 11a.
- [ ] **Isolated** (recommended) — a container, VM, or Claude Code sandbox, with no keys or credentials mounted
- [ ] **Native** — on the auditor's own machine (the report says so)
- [ ] No preference — recorded as **native** (also the default when automated runs leave Q46 unanswered), and the report carries that caveat

> Tools that send code, dependency names or addresses to outside services (an RPC provider, a second-opinion LLM, package registries) are not gated by this answer; the report lists each one (Rule 11b).

---

## How Answers Affect the Audit

| Answer | Effect |
|--------|--------|
| Q1 = DeFi | Enables economic attack scenarios (checklists 06, known vectors 1-30) |
| Q2 = Solana | Enables Solana-specific checklists (01-07) |
| Q8 = Mainnet live | Increases all severity scores by 1 for fund-related findings |
| Q10 > $1M | Doubles the weight of critical findings in risk score |
| Q11 = Single wallet | Auto-flags as Severity 8+ finding |
| Q17 = Yes | Requires full economic review (checklist 06) |
| Q18 / Q22 = token registry or risk API | Loads `references/methodologies/token-registry-risk.md` + KV-132 / KV-133 (identity spoofing, score farming) |
| Q22 = Geyser stream / indexer or fee sponsorship | Loads `references/vuln-classes/transaction-v1.md` + KV-135 / KV-136 (transaction v1: sponsor cap bypass, reader wedge, zero-budget indexing) + checklist 20 §20.6, 09 §9.18 |
| Q25 = First audit | Triggers more thorough analysis, no assumptions about prior fixes |
| Q31 = GitHub Actions | Loads `references/vuln-classes/github-actions.md` + KV-139 / KV-140 + checklist 13 §13.13 (DEP-090..096); add KV-116 and AI-034..035 when an AI agent runs in CI |
| Q32 = No tests | Auto-flags testing gaps, enables checklist 16 recommendations |
| Q35 = MiCA/GDPR | Enables compliance checklist (18) |
| Q39 = Specific scope | Skips irrelevant checklists, reduces cost/time |
| Q41 = Quick scan | Uses grep + known vectors only, skips semantic analysis |
| Q46 = Isolated | Builds, tests, installs and every PoC build run in a container / VM / sandbox (`OUTPUT-RULES.md` Rule 11a); a step that cannot run there keeps its source-level verdict, and a PoC records `[PoC-ATTEMPTED]` |
| Q46 = Native, or unanswered | Target-controlled code runs on the auditor's machine; the report's Coverage & Limitations states it |
