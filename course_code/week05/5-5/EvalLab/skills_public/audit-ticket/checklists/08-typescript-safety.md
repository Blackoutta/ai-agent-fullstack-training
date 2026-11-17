# 08 — TypeScript Safety Checklist

> Domain: Off-chain TypeScript code (backend, frontend, scripts, tests)  
> Severity if missed: MEDIUM to LOW  
> References: Project TypeScript Safety rules, strict-typing skill

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 8.1 — `any` Type Ban

- [ ] **TS-001**: `grep -rn ": any" --include="*.ts" --include="*.tsx"` — ZERO results expected
- [ ] **TS-002**: `grep -rn "as any" --include="*.ts" --include="*.tsx"` — ZERO results expected
- [ ] **TS-003**: `grep -rn "<any>" --include="*.ts" --include="*.tsx"` — ZERO results expected
- [ ] **TS-004**: `grep -rn "Record<string, any>" --include="*.ts" --include="*.tsx"` — ZERO results expected
- [ ] **TS-005**: `grep -rn "Promise<any>" --include="*.ts" --include="*.tsx"` — ZERO results expected
- [ ] **TS-006**: `grep -rn "Array<any>" --include="*.ts" --include="*.tsx"` — ZERO results expected
- [ ] **TS-007**: `grep -rn "catch.*: any" --include="*.ts" --include="*.tsx"` — ZERO results expected
- [ ] **TS-008**: `grep -rn "Function" --include="*.ts" --include="*.tsx"` — avoid `Function` type (implicit any)
- [ ] **TS-009**: `grep -rn "Object" --include="*.ts" --include="*.tsx"` — avoid bare `Object` type
- [ ] **TS-010**: If any `any` exists — is there a documented justification with `// eslint-disable-next-line`? Still flag it

## 8.2 — Error Handling

- [ ] **TS-011**: All catch blocks use `catch (e: unknown)` — never `catch (e: any)` or `catch (e)`
- [ ] **TS-012**: After `catch (e: unknown)`, type is narrowed: `if (e instanceof Error)` before accessing `.message`
- [ ] **TS-013**: No empty catch blocks: `catch (e) { }` or `catch (e) { /* ignore */ }` — flag all
- [ ] **TS-014**: No `catch` that silently swallows errors without logging
- [ ] **TS-015**: Errors are logged with context (which function, what input caused it, timestamp)
- [ ] **TS-016**: No `console.log` for error handling in production — use structured logging
- [ ] **TS-017**: Thrown errors use custom error classes or descriptive messages (not bare `throw new Error("error")`)
- [ ] **TS-018**: Async functions: all promises are awaited or explicitly handled with `.catch()` — no floating promises
- [ ] **TS-019**: No `Promise<void>` without error handling (unhandled rejection)
- [ ] **TS-020**: Process-level unhandled rejection handler: `process.on('unhandledRejection', ...)` in backend

## 8.3 — Import & Package Safety

- [ ] **TS-021**: All Anchor imports use `@anchor-lang/core` — NOT `@coral-xyz/anchor` (discontinued)
- [ ] **TS-022**: No `require()` calls — use ES module `import` syntax
- [ ] **TS-023**: No dynamic imports of user-controlled paths — `import(userInput)` is code injection
- [ ] **TS-024**: IDL types imported from correct generated location (`target/types/`)
- [ ] **TS-025**: No circular imports — check with `madge --circular` or similar tool
- [ ] **TS-026**: Unused imports are removed (no dead code)
- [ ] **TS-027**: `tsconfig.json` has `strict: true` enabled
- [ ] **TS-028**: `tsconfig.json` has `noImplicitAny: true`
- [ ] **TS-029**: `tsconfig.json` has `strictNullChecks: true`
- [ ] **TS-030**: TypeScript version is current and supported

## 8.4 — Solana-Specific Type Safety

- [ ] **TS-031**: All pubkey strings are validated with `new PublicKey(str)` in try-catch before use
- [ ] **TS-032**: PublicKey comparisons use `.equals()` not `==` or `===`
- [ ] **TS-033**: All lamport values use `bigint` or `BN` — not plain `number` (precision loss above 2^53)
- [ ] **TS-034**: PDA derivation uses `PublicKey.findProgramAddressSync()` — never hardcoded bumps
- [ ] **TS-035**: ATA derivation uses `getAssociatedTokenAddressSync()` — never manual derivation
- [ ] **TS-036**: Transaction builders properly set `feePayer` and `recentBlockhash`
- [ ] **TS-037**: Transaction simulation before sending — `connection.simulateTransaction()` used
- [ ] **TS-038**: BN arithmetic uses the correct methods (`.add()`, `.sub()`, `.mul()`, `.div()`) — not JS arithmetic on BN objects
- [ ] **TS-039**: keypair handling — no private keys in source code or hardcoded
- [ ] **TS-040**: Connection object uses committed/finalized commitment for financial reads
- [ ] **TS-061**: Every `getTransaction` / `getBlock` / `blockSubscribe` call passes `maxSupportedTransactionVersion: 1` (a JSON integer) — no omission, no literal `0` / `"legacy"`; the error path for `-32015` / a failed block is an operational error, never "transaction not found" (see KV-136)
- [ ] **TS-062**: Transaction version is detected structurally — wire byte 0 `=== 0x81` ⇒ v1; RPC JSON `message.transactionConfig` present ⇒ v1; gRPC `message.config` present ⇒ v1, *then* `versioned` ⇒ v0, else legacy — never inferred from size, from `versioned` alone, or from the presence of a ComputeBudget instruction; unknown versions are rejected
- [ ] **TS-063**: Compute limits and priority fees are read through one version-agnostic accessor (config for v1, ComputeBudget scan for legacy / v0) that normalises to total lamports (`price × limit ÷ 1e6`) before any comparison, cap, or storage — a v1 tx is never recorded as zero-budget because the scan found nothing
- [ ] **TS-064**: Senders building `version: 1` set `computeUnitLimit` and `loadedAccountsDataSizeLimit` explicitly (simulate with both maxed, add margin, round data size up to 32 KiB), use `setTransactionMessagePriorityFeeLamports` (total lamports, never a per-CU value), strip all ComputeBudget instructions, use no address lookup table and no duplicate addresses, encode `base64`, assert size with a version-aware check, and run on `@solana/kit` ≥ 8.0.0 / `@solana/web3.js` ≥ 3.0.0-rc.3 via the manual `pipe()` path (1.x is read-only; the kit plugin planner throws)

## 8.5 — Input Validation (zod)

- [ ] **TS-041**: Every API endpoint has a zod schema for request body
- [ ] **TS-042**: Zod schemas enforce types, not just presence (`.string().min(1)` not just `.string()`)
- [ ] **TS-043**: Zod schemas for pubkeys use `.refine()` to validate as a real base58 PublicKey
- [ ] **TS-044**: Zod schemas for amounts use `.number().positive()` or `.bigint()`
- [ ] **TS-045**: Zod schemas reject unexpected fields (`.strict()` mode or explicit schema)
- [ ] **TS-046**: Zod parse errors return 400 with descriptive error (not internal message)
- [ ] **TS-047**: No `req.body` read without going through zod parse first
- [ ] **TS-048**: No `req.query` or `req.params` used without validation

## 8.6 — Serialization & Deserialization

- [ ] **TS-049**: JSON responses from external APIs are typed with interfaces (not `as any`)
- [ ] **TS-050**: JSON parsing uses try-catch: `try { JSON.parse(text) }` not bare `JSON.parse()`
- [ ] **TS-051**: Borsh deserialization uses generated types from Anchor IDL
- [ ] **TS-052**: Base58/Base64 encoding uses well-known libraries (`bs58`, `Buffer.from`)
- [ ] **TS-053**: No `eval()` or `new Function()` anywhere in the codebase
- [ ] **TS-054**: No template literal injection in SQL/MongoDB queries
- [ ] **TS-055**: TypeScript `satisfies` keyword used where appropriate for compile-time checks

## 8.7 — Declaration Files

- [ ] **TS-056**: Third-party libs without types have `.d.ts` declaration files (not `any` escape hatch)
- [ ] **TS-057**: Custom `.d.ts` files are in a `types/` directory and referenced in `tsconfig.json`
- [ ] **TS-058**: No `@ts-ignore` or `@ts-nocheck` comments — flag every occurrence
- [ ] **TS-059**: No `@ts-expect-error` without a clearly documented reason on the same line
- [ ] **TS-060**: Interfaces/types for all MongoDB document shapes are defined and used consistently
