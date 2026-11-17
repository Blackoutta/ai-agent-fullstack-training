# Known Attack Vectors — Index

One line per vector. Click to see the full multi-step verification procedure.

## Load-when (markers) column — advisory gating

Every row carries a **Load when (markers)** cell: the grep/prescan markers that make the vector *worth loading* for a given codebase. This is a token-efficiency layer, **not** a scope gate — the completeness guarantee (OUTPUT-RULES Rule 0: every in-scope vector gets a verdict) is unchanged.

- **Feature markers** (e.g. `pyth`·`switchboard`, `token_2022`·`transfer_hook`, `invoke`·`CpiContext`) mean the vector is feature-specific. When *every* marker is provably absent — an empty prescan array (see `references/orchestration/pre-scan.md`) or zero grep hits across the in-scope tree — the vector is skip-deferred and renders `[N/A — feature absent: <marker>]`. This is an **evidence-backed verdict**, and it **reopens on demand**: the instant a manual read surfaces the feature, load the vector and evaluate it.
- **`always (<phase>)`** means the vector is universally applicable within that phase/domain and is **NEVER** skipped (private-key leak, secrets, supply-chain, access control, and other baseline vectors). A marker cell must never make a vector unreachable — when in doubt a vector is tagged to its phase (always-load for that scope), not a narrow feature.

## How to Contribute

1. Create a new file: `NNN-short-name.md` (next available number)
2. Follow the existing format: YAML frontmatter + `### N — Title` + severity + real-world example + verification procedure with numbered steps
3. Add your entry to this index (include the **Load when (markers)** cell — default to `always (<phase>)` unless the vector is provably feature-specific)
4. Submit a PR

### Crypto / On-Chain (1-30)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 1 | [Private Key Leak](001-private-key-leak.md) | 10 | always (crypto) |
| 2 | [Flash Loan Price Manipulation](002-flash-loan-price-manipulation.md) | 10 | `flash` · `flashloan` · oracle-priced deposit/withdraw · `pyth` · `switchboard` |
| 3 | [Reentrancy (CPI)](003-reentrancy-cpi.md) | 10 | `invoke` · `invoke_signed` · `CpiContext` |
| 4 | [Missing Access Control](004-missing-access-control.md) | 10 | always (crypto) |
| 5 | [Oracle Manipulation](005-oracle-manipulation.md) | 9 | `pyth` · `switchboard` · `oracle` · `PriceUpdate` · `get_price` |
| 6 | [First Depositor / Share Inflation](006-first-depositor-share-inflation.md) | 9 | `shares` · `mint_to` · `deposit` · `vault` · `total_supply` |
| 7 | [MEV Sandwich Attack](007-mev-sandwich-attack.md) | 7 | `swap` · `slippage` · `min_amount_out` · `route` |
| 8 | [Rug Pull / Admin Backdoor](008-rug-pull-admin-backdoor.md) | 10 | always (crypto) |
| 9 | [Unchecked CPI Target](009-unchecked-cpi-target.md) | 9 | `invoke` · `invoke_signed` · `CpiContext` · `program_id` |
| 10 | [PDA Confusion / Type Cosplay](010-pda-confusion-type-cosplay.md) | 8 | `seeds` · `find_program_address` · `AccountInfo` · `try_deserialize` |
| 11 | [Integer Overflow / Underflow](011-integer-overflow-underflow.md) | 9 | `arithmetic_sites` · `+` `-` `*` `/` · `checked_` |
| 12 | [Arithmetic Rounding Exploit](012-arithmetic-rounding-exploit.md) | 7 | `arithmetic_sites` · `/` · `div` · `mul_div` · `shares` |
| 13 | [Missing Signer Check](013-missing-signer-check.md) | 10 | always (crypto) |
| 14 | [Account Reinitialization](014-account-reinitialization.md) | 8 | `init` · `init_if_needed` · `is_initialized` |
| 15 | [Unchecked Account Owner](015-unchecked-account-owner.md) | 9 | always (crypto) |
| 16 | [Token Account Mismatch](016-token-account-mismatch.md) | 8 | `TokenAccount` · `token::mint` · `token::authority` · `spl_token` |
| 17 | [Vault Donation Attack](017-vault-donation-attack.md) | 7 | `vault` · `get_token_account_balance` · `.amount` · `shares` |
| 18 | [Fee-on-Transfer Token Exploit](018-fee-on-transfer-token-exploit.md) | 7 | `token_2022` · `TransferFee` · `transfer_hook` · `get_extension` |
| 19 | [Freeze Authority Griefing](019-freeze-authority-griefing.md) | 6 | `freeze_authority` · `FreezeAccount` · `mint` |
| 20 | [Program Upgrade Hijack](020-program-upgrade-hijack.md) | 10 | always (crypto) |
| 21 | [Governance Attack (Vote Buying)](021-governance-attack-vote-buying.md) | 8 | `realm` · `proposal` · `spl-governance` · `vote_record` · `voter_weight` |
| 22 | [Bridge Exploit (Fake Proof)](022-bridge-exploit-fake-proof.md) | 10 | `guardian` · `vaa` · `emitter` · `verify_signatures` · `attestation` |
| 23 | [Token-2022 Transfer Hook Attack](023-token-2022-transfer-hook-attack.md) | 7 | `token_2022` · `transfer_hook` · `TransferHook` · `get_extension` |
| 24 | [Stale/Missing Account Close](024-stale-missing-account-close.md) | 5 | `close` · `lamports` · `realloc` |
| 25 | [Compute Budget Exhaustion DoS](025-compute-budget-exhaustion-dos.md) | 6 | loops · `remaining_accounts` · `Vec` · `panic_sites` |
| 26 | [PDA Seed Collision](026-pda-seed-collision.md) | 8 | `seeds` · `find_program_address` · `create_program_address` |
| 27 | [Missing Discriminator Check](027-missing-discriminator-check.md) | 8 | `try_deserialize` · `AccountInfo` · `remaining_accounts` · discriminator |
| 28 | [Front-Running Transaction](028-front-running-transaction.md) | 6 | `swap` · `claim` · `commit` · `slippage` · price-sensitive ix |
| 29 | [Withdraw-Before-Update Race](029-withdraw-before-update-race.md) | 8 | `withdraw` · `invoke` · state-mutation-after-CPI · `reload` |
| 30 | [Infinite Mint / Uncapped Supply](030-infinite-mint-uncapped-supply.md) | 10 | `mint_to` · `supply` · `mint_authority` · `max_supply` |

### Backend / API (31-55)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 31 | [NoSQL Injection (MongoDB)](031-nosql-injection-mongodb.md) | 8 | `mongo` · `mongoose` · `$where` · `find(` · `dynamodb` |
| 32 | [SQL Injection](032-sql-injection.md) | 9 | `sql` · `query(` · `SELECT` · `prisma` · `sequelize` · `knex` |
| 33 | [Mass Assignment (Vibe Coding)](033-mass-assignment-vibe-coding.md) | 7 | `req.body` · `Object.assign` · `create(` · `update(` · spread-into-model |
| 34 | [BaaS Auth Bypass (Supabase/Firebase)](034-baas-auth-bypass-supabase-firebase.md) | 9 | `supabase` · `firebase` · `firestore` · RLS · `service_role` |
| 35 | [JWT Algorithm Confusion](035-jwt-algorithm-confusion.md) | 8 | `jwt` · `jsonwebtoken` · `alg` · `verify(` · `none` |
| 36 | [SSRF (Server-Side Request Forgery)](036-ssrf-server-side-request-forgery.md) | 8 | `fetch(` · `axios` · `request(` · user-supplied URL · `http.get` |
| 37 | [CORS Misconfiguration](037-cors-misconfiguration.md) | 7 | `cors` · `Access-Control-Allow-Origin` · `origin:` |
| 38 | [IDOR (Insecure Direct Object Reference)](038-idor-insecure-direct-object-reference.md) | 7 | `req.params` · `findById` · `:id` route · ownership check |
| 39 | [Rate Limiting Bypass](039-rate-limiting-bypass.md) | 6 | always (backend) |
| 40 | [Command Injection](040-command-injection.md) | 9 | `exec(` · `spawn(` · `child_process` · `os.system` · `eval(` |
| 41 | [Path Traversal / LFI](041-path-traversal-lfi.md) | 8 | `readFile` · `path.join` · `fs.` · `../` · `sendFile` |
| 42 | [XML External Entity (XXE)](042-xml-external-entity-xxe.md) | 7 | `xml` · `libxml` · `SAXParser` · `DOCTYPE` · `parseString` |
| 43 | [Prototype Pollution](043-prototype-pollution.md) | 7 | `__proto__` · `merge(` · `lodash` · `Object.assign` · deep-clone |
| 44 | [Server-Side Template Injection](044-server-side-template-injection.md) | 8 | `template` · `ejs` · `pug` · `handlebars` · `render(` · `${` |
| 45 | [Webhook Forgery](045-webhook-forgery.md) | 7 | `webhook` · `signature` · `hmac` · `X-Signature` · `helius` |
| 46 | [GraphQL Introspection / Depth Attack](046-graphql-introspection-depth-attack.md) | 6 | `graphql` · `apollo` · `__schema` · `resolver` |
| 47 | [WebSocket Hijacking](047-websocket-hijacking.md) | 7 | `websocket` · `ws` · `socket.io` · `upgrade` |
| 48 | [ReDoS (Regex Denial of Service)](048-redos-regex-denial-of-service.md) | 6 | `RegExp` · `.match(` · `.test(` · complex regex · user input to regex |
| 49 | [HTTP Response Splitting](049-http-response-splitting.md) | 6 | `setHeader` · `res.header` · `redirect(` · user input in headers |
| 50 | [Session Fixation](050-session-fixation.md) | 7 | `session` · `express-session` · `cookie` · `req.session` |
| 51 | [Account Enumeration](051-account-enumeration.md) | 5 | `login` · `register` · `reset-password` · error-message differences |
| 52 | [Unbounded Request Body DoS](052-unbounded-request-body-dos.md) | 6 | `body-parser` · `express.json` · `limit` · `multer` · upload |
| 53 | [Missing Wallet Signature Verification](053-missing-wallet-signature-verification.md) | 9 | `signMessage` · `nacl` · `verify` · `PublicKey` · wallet auth |
| 54 | [Default Credentials in Production](054-default-credentials-in-production.md) | 8 | always (backend) |
| 55 | [Exposed Debug/Admin Endpoints](055-exposed-debug-admin-endpoints.md) | 7 | always (backend) |

### Frontend / Client-Side (56-75)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 56 | [XSS via SVG / Image Injection](056-xss-via-svg-image-injection.md) | 7 | `svg` · `dangerouslySetInnerHTML` · `innerHTML` · file upload |
| 57 | [Stored XSS (User Content)](057-stored-xss-user-content.md) | 8 | `dangerouslySetInnerHTML` · `innerHTML` · user content render |
| 58 | [DOM-Based XSS](058-dom-based-xss.md) | 7 | `innerHTML` · `document.write` · `location.hash` · `eval(` |
| 59 | [Clickjacking](059-clickjacking.md) | 6 | always (frontend) |
| 60 | [OAuth State Forgery (CSRF via OAuth)](060-oauth-state-forgery-csrf-via-oauth.md) | 7 | `oauth` · `state=` · `redirect_uri` · `callback` |
| 61 | [Sensitive Data in URL Parameters](061-sensitive-data-in-url-parameters.md) | 5 | `searchParams` · `query` · `?token=` · `useRouter` |
| 62 | [Client-Side Auth Bypass](062-client-side-auth-bypass.md) | 7 | always (frontend) |
| 63 | [PostMessage Origin Bypass](063-postmessage-origin-bypass.md) | 6 | `postMessage` · `addEventListener('message'` · `event.origin` |
| 64 | [LocalStorage Token Theft](064-localstorage-token-theft.md) | 6 | `localStorage` · `sessionStorage` · `token` · `jwt` |
| 65 | [Clipboard Hijacking (Crypto Address)](065-clipboard-hijacking-crypto-address.md) | 7 | `clipboard` · `navigator.clipboard` · `copy` · wallet address |
| 66 | [CSS Exfiltration](066-css-exfiltration.md) | 5 | user-supplied CSS · `style` injection · `<style>` |
| 67 | [Wallet Blind Signing Exploit](067-wallet-blind-signing-exploit.md) | 8 | `signTransaction` · `signAllTransactions` · `sendTransaction` · wallet-adapter |
| 68 | [Subresource Integrity Bypass](068-subresource-integrity-bypass.md) | 6 | `<script src` · CDN · `integrity=` |
| 69 | [Third-Party Script Compromise](069-third-party-script-compromise.md) | 7 | `<script src` · analytics · third-party embed |
| 70 | [Open Redirect](070-open-redirect.md) | 5 | `redirect(` · `window.location` · `returnUrl` · `next=` |
| 71 | [Missing CSP (Content Security Policy)](071-missing-csp-content-security-policy.md) | 6 | always (frontend) |
| 72 | [API Key Exposure in Client Bundle](072-api-key-exposure-in-client-bundle.md) | 7 | always (frontend) |
| 73 | [Dangling DNS / Subdomain Takeover](073-dangling-dns-subdomain-takeover.md) | 7 | always (frontend) |
| 74 | [Insecure External Link (no rel)](074-insecure-external-link-no-rel.md) | 3 | `target="_blank"` · `<a href` · external link |
| 75 | [Console Data Leak in Production](075-console-data-leak-in-production.md) | 4 | `console.log` · `console.debug` · `console.error` |

### DevOps / Supply Chain (76-100)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 76 | [Dependency Confusion (Substitution Attack)](076-dependency-confusion-substitution-attack.md) | 9 | always (devops) |
| 77 | [Malicious npm Package (Typosquatting)](077-malicious-npm-package-typosquatting.md) | 8 | always (devops) |
| 78 | [Secrets in Git History](078-secrets-in-git-history.md) | 10 | always (devops) |
| 79 | [.env File Committed to Repo](079-env-file-committed-to-repo.md) | 9 | always (devops) |
| 80 | [CI/CD Pipeline Injection](080-ci-cd-pipeline-injection.md) | 9 | `.github/` · `gitlab-ci` · `Jenkinsfile` · `${{` · workflow |
| 81 | [Insecure Docker Configuration](081-insecure-docker-configuration.md) | 7 | `Dockerfile` · `docker-compose` · `FROM ` · container |
| 82 | [Exposed Admin / Debug Endpoints in Production](082-exposed-admin-debug-endpoints-in-production.md) | 8 | always (devops) |
| 83 | [Missing Rate Limiting on Critical Endpoints](083-missing-rate-limiting-on-critical-endpoints.md) | 7 | always (devops) |
| 84 | [Prototype Pollution](084-prototype-pollution.md) | 7 | `__proto__` · `merge(` · `lodash` · `Object.assign` |
| 85 | [Server-Side Request Forgery (SSRF)](085-server-side-request-forgery-ssrf.md) | 8 | `fetch(` · `axios` · `request(` · user-supplied URL |
| 86 | [Insecure Deserialization](086-insecure-deserialization.md) | 8 | `pickle` · `yaml.load` · `JSON.parse` · `unserialize` · `Marshal` |
| 87 | [Insufficient Logging & Monitoring](087-insufficient-logging-monitoring.md) | 6 | always (devops) |
| 88 | [Insecure CORS Configuration](088-insecure-cors-configuration.md) | 7 | `cors` · `Access-Control-Allow-Origin` · `origin:` |
| 89 | [Unpatched Server Dependencies](089-unpatched-server-dependencies.md) | 7 | always (devops) |
| 90 | [Missing HTTPS / TLS Misconfiguration](090-missing-https-tls-misconfiguration.md) | 8 | `http://` · `tls` · `ssl` · `rejectUnauthorized` · `certificate` |
| 91 | [Upgrade Authority Not Secured](091-upgrade-authority-not-secured.md) | 10 | always (devops) |
| 92 | [DNS Hijacking / Domain Takeover](092-dns-hijacking-domain-takeover.md) | 9 | always (devops) |
| 93 | [Improper Error Handling (Error Leak)](093-improper-error-handling-error-leak.md) | 5 | `catch` · `stack` · `err.message` · error response |
| 94 | [Missing Input Length Limits](094-missing-input-length-limits.md) | 6 | always (devops) |
| 95 | [Insecure Randomness](095-insecure-randomness.md) | 7 | `Math.random` · `rand()` · `random` · token/nonce generation |
| 96 | [Missing Security Headers](096-missing-security-headers.md) | 5 | `helmet` · `setHeader` · `X-Frame-Options` · CSP |
| 97 | [Stale / Leaked Development Credentials](097-stale-leaked-development-credentials.md) | 8 | always (devops) |
| 98 | [Broken Access Control on API Endpoints](098-broken-access-control-on-api-endpoints.md) | 8 | always (devops) |
| 99 | [Insecure WebSocket Connections](099-insecure-websocket-connections.md) | 6 | `websocket` · `ws://` · `socket.io` · `wss` |
| 100 | [Insufficient Backup / Disaster Recovery](100-insufficient-backup-disaster-recovery.md) | 7 | always (devops) |

### On-Chain — Modern Surface (101-109)

> Added in v4.4. Focus: sysvars, precompiles, lookup tables, PDA bump canonicalization, Token-2022 extensions, account revival, ATA assumptions, token decimals, and native/Pinocchio (p-token) programs.

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 101 | [Sysvar Spoofing & Instructions-Sysvar Introspection](101-sysvar-spoofing-instructions-introspection.md) | 8 | `sysvar` · `instructions_sysvar` · `load_instruction_at` · `get_instruction_relative` |
| 102 | [Precompile Signature Verification Bypass (Ed25519/Secp256k1)](102-precompile-signature-verification-bypass.md) | 9 | `ed25519` · `secp256k1` · `precompile` · `instructions_sysvar` · signature-verify ix |
| 103 | [Address Lookup Table (ALT) Manipulation](103-address-lookup-table-manipulation.md) | 7 | `address_lookup_table` · `AddressLookupTable` · `lookup_table` · versioned tx |
| 104 | [Non-Canonical Bump / PDA Derivation Confusion](104-non-canonical-bump-pda-derivation-confusion.md) | 7 | `seeds` · `bump` · `create_program_address` · `find_program_address` |
| 105 | [Token-2022 Extension Abuse (permanent delegate / frozen-default / fee / confidential / mint-close)](105-token-2022-extension-abuse.md) | 8 | `token_2022` · `get_extension` · `PermanentDelegate` · `ConfidentialTransfer` · `TransferFee` |
| 106 | [Account Revival / Zombie After Close](106-account-revival-zombie-after-close.md) | 8 | `close` · `lamports` · `realloc` · `is_initialized` · reopen |
| 107 | [Fake / Non-Canonical Associated Token Account (ATA)](107-fake-non-canonical-associated-token-account.md) | 8 | `associated_token` · `get_associated_token_address` · `ATA` · `token::authority` |
| 108 | [Token Decimals & Cross-Mint Amount Confusion](108-token-decimals-cross-mint-amount-confusion.md) | 7 | `decimals` · `amount` · multi-mint · `transfer_checked` · `mint.decimals` |
| 109 | [Pinocchio / p-token — Missing Manual Validation in Zero-Copy Native Programs](109-pinocchio-ptoken-missing-manual-validation.md) | 8 | `pinocchio` · `p-token` · `no_std` · `AccountInfo` · manual-validation (native, no Anchor) |

### Solana × AI + Off-Chain Rust (110-117)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 110 | [Agent Wallet Key Custody & Missing Spend Caps](110-agent-wallet-key-custody-spend-caps.md) | 9 | always (ai-agent) |
| 111 | [BPF Stack Frame Overflow DoS](111-bpf-stack-frame-overflow-dos.md) | 6 | large stack arrays · `[u8; N]` · deep recursion · `panic_sites` (on-chain) |
| 112 | [In-Memory Secret Non-Zeroization (Off-Chain Rust)](112-in-memory-secret-non-zeroization.md) | 6 | `Keypair` · `secret` · `zeroize` · `.rs` off-chain · in-memory key |
| 113 | [Autonomous Agent Blind Signing](113-autonomous-agent-blind-signing.md) | 8 | `signTransaction` · agent · autonomous · `sendTransaction` · LLM-driven sign |
| 114 | [MCP Tool Poisoning](114-mcp-tool-poisoning.md) | 8 | `.mcp.json` · `mcp` · tool-definition · agent SDK |
| 115 | [On-Chain Data Prompt Injection](115-onchain-data-prompt-injection.md) | 8 | `prompt` · `llm` · on-chain data → model · `completion` · `inference` |
| 116 | [AI Coding Agent in CI Holds Deploy / Upgrade Keys](116-ai-coding-agent-ci-deploy-key.md) | 9 | `.github/` + agent · CI + deploy key · `anthropic`/`openai` in workflow |
| 117 | [Agent Delegation Scope Creep](117-agent-delegation-scope-creep.md) | 7 | `delegate` · agent · scope · permission · `approve` |

### On-Chain — Governance & Randomness (118-120)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 118 | [Stake Account Authority Hijack](118-stake-account-authority-hijack.md) | 8 | `stake` · `StakeProgram` · `authorized` · `staker` · `withdrawer` |
| 119 | [Durable-Nonce Pre-Signed Governance Abuse](119-durable-nonce-pre-signed-governance-abuse.md) | 9 | `nonce` · `durable_nonce` · `advance_nonce` · `realm` · `proposal` · governance |
| 120 | [On-Chain Randomness Predictability & VRF Misbinding](120-onchain-randomness-predictability.md) | 7 | `random` · `vrf` · `switchboard` · `Clock` · `slot_hashes` · `blockhash` |

### Modern On-Chain, Custody & Off-Chain Consumers (121-126)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 121 | [cNFT / Account-Compression Merkle Proof Abuse](121-cnft-account-compression-merkle-proof.md) | 7 | `spl-account-compression` · `bubblegum` · `merkle` · `cNFT` · `proof` |
| 122 | [Inner-Instruction / Event-Log Spoofing](122-inner-instruction-event-log-spoofing.md) | 7 | `emit_cpi` · `invoke` · inner-instruction · event parsing off-chain · `sol_log` |
| 123 | [Lamport-Donation Account Bricking (King-of-the-SOL)](123-lamport-donation-account-bricking.md) | 6 | `lamports` · rent-exempt check · `try_borrow_lamports` · balance-equality assumption |
| 124 | [Custodial Cleartext Key Export / Recoverable Signing Material](124-wallet-cleartext-key-export.md) | 8 | always (custody) |
| 125 | [Bonding-Curve Launchpad Graduation & Migration Abuse](125-bonding-curve-launchpad-graduation-abuse.md) | 7 | `bonding_curve` · `graduate` · `virtual_reserves` · `migrate` · `curve` |
| 126 | [Session Token as Custody](126-session-token-as-custody.md) | 7 | `session` · `session_token` · delegated-signing · `spending_limit` |

### DoS, Float Math, Keeper Lifecycle & CLMM Math (127-131)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 127 | [ATA / Account Pre-Creation DoS (Init Front-Running)](127-ata-account-precreation-dos.md) | 6 | `init` · `create_associated_token_account` · `init_if_needed` · pre-creation |
| 128 | [On-Chain Floating-Point Financial Math](128-onchain-floating-point-math.md) | 5 | `f32` · `f64` · `as f64` · `.sqrt()` · `.powi(` · float in value math |
| 129 | [Keeper Request→Execute Front-Running & Reordering](129-keeper-request-execute-frontrunning.md) | 7 | `keeper` · `request` · `execute` · two-step · `crank` · settlement |
| 130 | [CLMM/DLMM Tick-Boundary & Liquidity Math](130-clmm-tick-boundary-liquidity-math.md) | 7 | `tick` · `sqrt_price` · `liquidity_net` · `bin_array` · `fee_growth` |
| 131 | [Write-Lock Account Contention DoS (Hot Shared Writable)](131-write-lock-account-contention-dos.md) | 6 | shared writable account · global `mut` state · single hot PDA · `#[account(mut)]` global |

### Token Registries, Risk Signals & Permissioned Tokens (132-134)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 132 | [Canonical-Asset / Token-List Spoofing & Primary-Variant Hijack](132-canonical-asset-token-list-spoofing.md) | 8 | `tokenlist` · `token list` · `assetId` · `canonical` · `getTokenBySymbol` · `coingeckoId` · `tokens.xyz` · `primaryVariant` · strict / verified list |
| 133 | [Token Risk-Score / Trust-Tier Metric Farming](133-token-risk-score-metric-farming.md) | 6 | `riskScore` · `risk_score` · `grade` · `trustTier` · `liquidityTier` · `isVerified` · `rugcheck` · `webacy` · `goplus` |
| 134 | [Token ACL (SRFC-37) Gate-Program Bypass & Permissionless-Freeze Griefing](134-token-acl-gate-program-bypass.md) | 7 | `token_acl` · `TACLkU6` · `MINT_CFG` · `gating_program` · `thaw_permissionless` · `can_thaw_permissionless` · `DefaultAccountState` + delegated freeze authority |

### Transaction Format & Runtime-Upgrade Readiness (135-136)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 135 | [Transaction v1 Fee-Sponsor Cap Bypass & Disabled ComputeBudget Gates](135-transaction-v1-fee-sponsor-cap-bypass.md) | 8 | `feePayer` / `fee_payer` as a service · `sponsor` · `paymaster` · `gasless` · `relayer` · `partialSign` · `ComputeBudgetProgram` scan · `load_instruction_at` + `compute_budget` |
| 136 | [Transaction v1 Reader Wedge & Zero-Budget Indexing](136-transaction-v1-reader-wedge-zero-budget-indexing.md) | 7 | `getTransaction` · `getBlock` · `blockSubscribe` · `maxSupportedTransactionVersion` · `yellowstone` · `geyser` · `ComputeBudget` scan · `computeUnitPrice` |

### Vendored Programs & White-Label Fleets (137)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 137 | [White-Label / Vendored On-Chain Program Version Drift & Inherited Admin Surface](137-vendored-program-version-drift.md) | 8 | always (crypto) |

### Runtime Timing: 200 ms Slots & the Alpenglow Clock (138)

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 138 | [Slot-Denominated Time After SIMD-0525 (Slot Used as a Clock)](138-slot-denominated-time-assumptions.md) | 7 | `clock.slot` · `Clock::get()?.slot` · `SLOTS_PER_YEAR` · `DEFAULT_TICKS_PER_SLOT` · `DEFAULT_MS_PER_SLOT` · `*_slot` duration / deadline fields · epoch-denominated lockups · `warp_to_slot` · `216_000` / `432_000` |

### CI/CD Trigger Trust — GitHub Actions (139-140)

> Added in v7.6. Who can start a privileged workflow job, and which fork-controlled code, artifacts or caches it runs or trusts. Playbook: `references/vuln-classes/github-actions.md`.

| # | Vector | Severity | Load when (markers) |
|---|--------|----------|---------------------|
| 139 | [Comment / Issue-Triggered Privileged Workflow Without Per-Event Author Gating](139-comment-triggered-workflow-author-gating.md) | 9 | `issue_comment` · `pull_request_review_comment` · `pull_request_review` · `discussion_comment` · `issues` (as a trigger) · `gollum` · `anthropics/claude-code-action` · `run-gemini-cli` · `openai/codex-action` · `actions/ai-inference` · `claude -p` · `codex exec` |
| 140 | [workflow_run / pull_request_target Pwn Request — Privileged Job Trusts Fork Code, Artifacts or Cache](140-workflow-run-pwn-request-artifact-cache-poisoning.md) | 9 | `pull_request_target` · `workflow_run` · `allow-unsafe-pr-checkout` · `issue_comment` job that fetches PR code |

---

## Known Duplicates & Consolidation Map

The off-chain set (1-100) contains six near-duplicate pairs (same root cause catalogued under two
categories). They are intentionally retained so both the "Backend" and "DevOps" reading paths stay
complete, but an auditor should **evaluate each pair once and cross-reference the verdict** — do not
double-count them as independent coverage. Severities are aligned to the higher of the pair.

| Canonical | Duplicate of | Topic | Aligned Severity |
|-----------|--------------|-------|------------------|
| 036 | 085 | SSRF | 8 |
| 037 | 088 | CORS misconfiguration | 7 |
| 043 | 084 | Prototype pollution | 7 |
| 055 | 082 | Exposed admin/debug endpoints | 8 |
| 039 | 083 | Rate limiting (bypass / missing) | 7 |
| 047 | 099 | WebSocket security | 7 |

**Distinct concepts:** 134 (140 files − 6 duplicate pairs).

---

**Total vector files:** 140 (100 original + 9 in v4.4 + 8 in v5.0 + 3 in v5.1 + 6 in v6.0 + 3 in v6.1 + 2 in v6.2 + 3 in v7.2 + 2 in v7.3 + 1 in v7.4 + 1 in v7.5 + 2 in v7.6)
**Distinct concepts:** 134 (after consolidating 6 duplicate pairs)
**Categories:** 6 (crypto, backend, frontend, devops, ai-agent, off-chain-rust)
**Severity range:** 3-10
