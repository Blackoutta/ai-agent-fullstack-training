# 10 — Frontend Security Checklist

> Domain: Next.js frontend (apps/web/)  
> Severity if missed: MEDIUM to LOW  
> References: OWASP, project frontend-security instructions, visual-identity rules

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 10.1 — Cross-Site Scripting (XSS) Prevention

- [ ] **FE-001**: No use of `dangerouslySetInnerHTML` — flag every occurrence
- [ ] **FE-002**: If `dangerouslySetInnerHTML` is used — is the input sanitized with DOMPurify or equivalent?
- [ ] **FE-003**: User-generated content (names, descriptions) is rendered as text, not HTML
- [ ] **FE-004**: No `document.write()` or `document.writeln()` anywhere
- [ ] **FE-005**: No inline event handlers in JSX (`onClick={new Function(userInput)}`)
- [ ] **FE-006**: URL parameters are not rendered directly into the DOM without sanitization
- [ ] **FE-007**: `target="_blank"` links include `rel="noopener noreferrer"`
- [ ] **FE-008**: No template literal injection in URL construction: `${userInput}` in URLs is validated

## 10.2 — Secret & Key Exposure

- [ ] **FE-009**: `NEXT_PUBLIC_` env vars — list all and verify NONE contain secrets
- [ ] **FE-010**: No API keys in client-side code (RPC URLs with API keys, Jupiter API key, etc.)
- [ ] **FE-011**: Sensitive API calls proxied through backend — not called directly from browser
- [ ] **FE-012**: No private keys or mnemonics in frontend code (including test files)
- [ ] **FE-013**: Wallet adapter handles private keys — no custom key handling in frontend
- [ ] **FE-014**: No hardcoded tokens, passwords, or secrets in source maps
- [ ] **FE-015**: Source maps disabled in production build (or only accessible to team)
- [ ] **FE-016**: `.env.local` is in `.gitignore`

## 10.3 — API Route Security (Next.js /api/)

- [ ] **FE-017**: All API routes validate wallet signatures server-side (not just client-side)
- [ ] **FE-018**: API route body parsing in try-catch: `try { body = await req.json() } catch { return 400 }`
- [ ] **FE-019**: Required fields validated before proxying to backend
- [ ] **FE-020**: Proxy responses: `text()` then `try { JSON.parse(text) }` — never bare `.json()`
- [ ] **FE-021**: Error status codes: 400 validation, 401 auth, 502 backend proxy failure (NOT 500)
- [ ] **FE-022**: No internal error messages leaked to client
- [ ] **FE-023**: CORS headers set in `middleware.ts` (`proxy.ts` on Next.js 16+) for API routes
- [ ] **FE-024**: Rate limiting on API routes (at minimum, forwarded from backend)

## 10.4 — Client-Side Data Handling

- [ ] **FE-025**: No sensitive data stored in `localStorage` (private keys, tokens, session data)
- [ ] **FE-026**: No sensitive data stored in `sessionStorage` without encryption
- [ ] **FE-027**: Cookies (if used): `HttpOnly`, `Secure`, `SameSite=Strict` flags
- [ ] **FE-028**: No logging of sensitive data with `console.log` in production
- [ ] **FE-029**: All `console.log` removed from production code (or gated behind `NODE_ENV`)
- [ ] **FE-030**: No sensitive data in React state that persists after component unmount
- [ ] **FE-031**: Browser history: no sensitive data in URL parameters (e.g., `?key=secret`)

## 10.5 — Transaction Security (Wallet Integration)

- [ ] **FE-032**: Transactions are built on the client and signed by the user's wallet — server never holds private keys
- [ ] **FE-033**: Transaction simulation shown to user before signing (or at minimum, details displayed)
- [ ] **FE-034**: Transaction confirmation waited for before showing success (`finalized` or `confirmed` commitment)
- [ ] **FE-035**: Transaction failure handled gracefully — user-friendly error message
- [ ] **FE-036**: No auto-signing of transactions without user interaction
- [ ] **FE-037**: Wallet disconnect properly clears all session state
- [ ] **FE-038**: Multiple wallet support doesn't leak state between wallets
- [ ] **FE-039**: Transaction builders validate all inputs before building instruction
- [ ] **FE-040**: No race conditions in transaction submission (double-click protection)
- [ ] **FE-083**: Before sending a v1 transaction to the connected wallet, the dApp checks that the wallet (and any hardware signer behind it) can sign version 1 — a signer that returns "invalid message" for byte `0x81` triggers an explicit fallback to v0 / legacy or a clear block, never a retry loop or a blind-sign prompt (see KV-067, `references/vuln-classes/transaction-v1.md` V8)
- [ ] **FE-084**: The pre-sign simulation (FE-033) runs on the exact base64 bytes with the v1 config, and the fee shown to the user is the config `priorityFee` as a **total in lamports** plus base fee — no display derived from a micro-lamports-per-CU field that v1 does not carry

## 10.6 — Performance & DoS Prevention

- [ ] **FE-041**: All images use `next/image` — no raw `<img>` tags
- [ ] **FE-042**: Videos: `preload="none"`, `poster` attribute, explicit dimensions
- [ ] **FE-043**: Heavy components lazy-loaded: `dynamic(() => import('./X'), { ssr: false })`
- [ ] **FE-044**: `loading.tsx` and `error.tsx` in every route segment
- [ ] **FE-045**: `<Suspense>` boundaries around data-fetching components
- [ ] **FE-046**: Memoization used where appropriate: `useMemo`, `useCallback` with stable deps
- [ ] **FE-047**: Max 5 `useState` per component — beyond that, use `useReducer`
- [ ] **FE-048**: Error Boundaries catch component crashes gracefully
- [ ] **FE-049**: No infinite re-render loops (check useEffect deps arrays)
- [ ] **FE-050**: Bundle size: no unnecessarily large packages imported (lodash full import, etc.)

## 10.7 — Accessibility & Compliance

- [ ] **FE-051**: All interactive elements have `aria-label`
- [ ] **FE-052**: Semantic HTML used: `<section>`, `<nav>`, `<article>`, `<main>`, `<header>`, `<footer>`
- [ ] **FE-053**: Modals trap focus and support Escape key
- [ ] **FE-054**: Text contrast passes WCAG AA (no `text-white/30` on dark for readable text)
- [ ] **FE-055**: Form inputs have associated `<label>` elements
- [ ] **FE-056**: Tab navigation works correctly through all interactive elements

## 10.8 — Third-Party Script Safety

- [ ] **FE-057**: No third-party scripts loaded from untrusted CDNs without SRI (Subresource Integrity)
- [ ] **FE-058**: Analytics scripts (if present) don't capture sensitive data
- [ ] **FE-059**: No postMessage handlers without origin validation
- [ ] **FE-060**: iframes (if present) use `sandbox` attribute
- [ ] **FE-061**: Web Workers (if used) don't process user-controlled code
- [ ] **FE-062**: Service Workers (if used) have proper scope and don't intercept unintended requests

## 10.9 — SVG & File Upload Attacks

- [ ] **FE-063**: SVG files from user input are sanitized — `<script>`, `onload`, `onerror`, `<foreignObject>`, `javascript:` URIs stripped
- [ ] **FE-064**: User-uploaded images: MIME type validated server-side (not just client extension — attackers rename `.svg` to `.png`)
- [ ] **FE-065**: `<img src>` rejects `data:image/svg+xml` URIs from user input (inline SVG = XSS vector)
- [ ] **FE-066**: Content-Security-Policy: no `unsafe-inline` in `script-src` (prevents inline script execution from SVG)
- [ ] **FE-067**: User-uploaded files served from a separate domain/CDN (not same-origin — prevents cookie access)
- [ ] **FE-068**: File uploads have server-side size limits and type allowlists (not just frontend validation)
- [ ] **FE-069**: No user-controlled HTML/SVG rendered in `<iframe srcdoc>` without sandbox

## 10.10 — Advanced Client-Side Attacks

- [ ] **FE-070**: Clickjacking protection: CSP `frame-ancestors 'self'` AND X-Frame-Options set server-side
- [ ] **FE-071**: `window.addEventListener('message', ...)` handlers validate `event.origin` against allowlist before processing data
- [ ] **FE-072**: OAuth/social login flows include `state` parameter and validate it on callback (CSRF via OAuth prevention)
- [ ] **FE-073**: Wallet/crypto addresses displayed on page are not vulnerable to clipboard hijacking — copy button copies from DOM, not from hidden/injected element
- [ ] **FE-074**: No sensitive tokens, session IDs, or secrets in URL query parameters (visible in referrer headers, browser history, server logs)
- [ ] **FE-075**: CSS does not accept/interpolate user input — no `style={{ background: userInput }}` without sanitization (CSS exfiltration prevention)
- [ ] **FE-076**: Client-side route guards (e.g., `if (!user) redirect('/login')`) are backed by server-side auth checks on every API call — never trust client-only auth

## 10.11 — Next.js Middleware / Proxy, Server Actions & RSC

- [ ] **FE-077**: Next.js is at or above the patched release for CVE-2025-29927 (the `x-middleware-subrequest` header let requests skip middleware; fixed in 15.2.3 / 14.2.25 / 13.5.9) — and middleware is *not* the only auth check: every protected route handler and server action re-verifies the session itself
- [ ] **FE-078**: The `middleware.ts` / `proxy.ts` (Next.js 16+) `matcher` covers every protected path — no negative-lookahead or prefix matcher that lets a trailing slash, encoded segment, `_next/data` variant or a newly added route ship unprotected
- [ ] **FE-079**: Server Actions (`'use server'`) treat their arguments as untrusted network input — they validate with a schema and check authorization *inside* the action (they are public POST endpoints); no action trusts a client-supplied user id, price, or role
- [ ] **FE-080**: Server Components do not pass secrets, full database rows or other users' data into Client Component props (props are serialized into the HTML / RSC payload); secret-bearing modules import `server-only`
- [ ] **FE-081**: Route handlers and pages that return per-user or authenticated data declare dynamic rendering (`dynamic = 'force-dynamic'`, no `revalidate`) — no ISR / `force-static` caching of authenticated responses, and their `Cache-Control` is `private, no-store`
- [ ] **FE-082**: `next.config` `images.remotePatterns` restricts remote image hosts to known origins — no wildcard `hostname: '**'` (the image optimizer becomes an open proxy for SSRF, abuse and cost amplification)
