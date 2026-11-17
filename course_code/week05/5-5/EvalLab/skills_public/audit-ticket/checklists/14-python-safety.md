# 14 — Python Safety Checklist

> Domain: Python backend, scripts, bots, data pipelines, Django/Flask/FastAPI  
> Severity if missed: 3–10 depending on context  
> References: OWASP Top 10, Bandit, PEP 8, Python Security Best Practices

Every item below is a single verification step. Mark each `[PASS]`, `[FAIL-{severity}]`, `[PARTIAL]`, or `[N/A]`.

---

## 14.1 — Injection & Input Handling

- [ ] **PY-001**: No use of `eval()` or `exec()` on user-controlled input
- [ ] **PY-002**: No use of `os.system()` or `subprocess.call(shell=True)` with user input — use `subprocess.run()` with `shell=False` and argument list
- [ ] **PY-003**: No string formatting/f-strings used to build SQL queries — use parameterized queries or ORM
- [ ] **PY-004**: No `pickle.loads()` or `pickle.load()` on untrusted data (arbitrary code execution)
- [ ] **PY-005**: No `yaml.load()` without `Loader=yaml.SafeLoader` (code execution via YAML)
- [ ] **PY-006**: No `marshal.loads()` on untrusted data
- [ ] **PY-007**: No `__import__()` with user-controlled module names
- [ ] **PY-008**: `ast.literal_eval()` used instead of `eval()` when parsing literal data
- [ ] **PY-009**: Template engines (Jinja2, Django) have auto-escaping enabled — no `|safe` or `mark_safe()` on user input
- [ ] **PY-010**: Regular expressions do not use untrusted input without `re.escape()` (ReDoS risk)
- [ ] **PY-011**: No `xml.etree.ElementTree` or `xml.dom.minidom` on untrusted XML — use `defusedxml` (XXE attacks)
- [ ] **PY-012**: JSON parsing uses `json.loads()` — never `eval()` for JSON

## 14.2 — Authentication & Authorization

- [ ] **PY-013**: Passwords hashed with `bcrypt`, `argon2`, or `scrypt` — never MD5/SHA1/SHA256 alone
- [ ] **PY-014**: Password comparison uses constant-time `hmac.compare_digest()` — never `==`
- [ ] **PY-015**: JWT tokens validated with correct algorithm — no `algorithms=["none"]`
- [ ] **PY-016**: JWT secret key not hardcoded — loaded from environment
- [ ] **PY-017**: Session tokens have expiration, rotation, and secure cookie flags
- [ ] **PY-018**: API endpoints have authentication middleware — no unauthenticated mutation endpoints
- [ ] **PY-019**: Role-based access control checks on every protected endpoint
- [ ] **PY-020**: No `@login_required` or equivalent missing on admin/mutation views
- [ ] **PY-021**: OAuth/OIDC state parameter validated to prevent CSRF
- [ ] **PY-022**: Rate limiting configured on authentication endpoints

## 14.3 — Web Framework Security (Django/Flask/FastAPI)

- [ ] **PY-023**: Django `DEBUG = False` in production
- [ ] **PY-024**: Django `SECRET_KEY` loaded from env — not in settings.py
- [ ] **PY-025**: Django `ALLOWED_HOSTS` configured — not `['*']`
- [ ] **PY-026**: CSRF protection enabled (Django middleware, Flask-WTF, etc.)
- [ ] **PY-027**: CORS configured with specific origins — not `allow_all_origins = True`
- [ ] **PY-028**: Security headers set (X-Content-Type-Options, X-Frame-Options, HSTS)
- [ ] **PY-029**: File uploads validated: type, size, filename sanitized, stored outside webroot
- [ ] **PY-030**: Static files served by reverse proxy (nginx) in production — not by Python
- [ ] **PY-031**: Error pages do not expose stack traces or internal paths in production
- [ ] **PY-032**: Logging does not include sensitive data (passwords, tokens, PII)
- [ ] **PY-033**: FastAPI `docs_url` and `redoc_url` disabled or auth-protected in production

## 14.4 — Database & ORM Safety

- [ ] **PY-034**: All database queries use parameterized queries or ORM — no string concatenation
- [ ] **PY-035**: Django `extra()`, `raw()`, `RawSQL()` calls reviewed for SQL injection
- [ ] **PY-036**: SQLAlchemy `text()` calls use bound parameters — no f-strings
- [ ] **PY-037**: MongoDB (PyMongo) queries validate input types — no `$where` with user input
- [ ] **PY-038**: Database connection strings loaded from env — not hardcoded
- [ ] **PY-039**: Database migrations reviewed for data loss operations (drop column, drop table)
- [ ] **PY-040**: ORM queries checked for N+1 query patterns (select_related/prefetch_related)

## 14.5 — Cryptography & Secrets

- [ ] **PY-041**: No hardcoded API keys, passwords, or secrets in source code
- [ ] **PY-042**: Secrets loaded from env vars or secret manager — validated at startup
- [ ] **PY-043**: Cryptographic operations use `cryptography` library — not `pycrypto` (unmaintained)
- [ ] **PY-044**: Random values for security use `secrets` module — not `random` (predictable PRNG)
- [ ] **PY-045**: No `hashlib.md5()` or `hashlib.sha1()` for security purposes (passwords, tokens)
- [ ] **PY-046**: TLS certificate verification enabled — no `verify=False` in `requests` calls
- [ ] **PY-047**: Private keys never logged, never in error messages, never in API responses
- [ ] **PY-048**: `.env` files in `.gitignore` — never committed

## 14.6 — Dependency & Import Safety

- [ ] **PY-049**: `requirements.txt` or `pyproject.toml` pins exact versions (not `>=` or `~=` for critical deps)
- [ ] **PY-050**: No packages with known CVEs — run `pip audit` or `safety check`
- [ ] **PY-051**: Virtual environment used — no system-wide `pip install`
- [ ] **PY-052**: No `pip install` with `--trusted-host` or `--index-url` pointing to untrusted registries
- [ ] **PY-053**: `__init__.py` files do not execute code with side effects on import
- [ ] **PY-054**: No wildcard imports (`from module import *`) — pollutes namespace, hides dependencies
- [ ] **PY-055**: Dependencies scanned with `pip audit` — no known vulnerabilities
- [ ] **PY-056**: 14-day quarantine rule applied to new package versions (same as npm)

## 14.7 — Error Handling & Type Safety

- [ ] **PY-057**: No bare `except:` or `except Exception:` that silently swallows errors
- [ ] **PY-058**: Exception handlers log the error — no empty `except: pass`
- [ ] **PY-059**: Type hints used throughout codebase — `mypy` or `pyright` configured
- [ ] **PY-060**: No `typing.Any` used where specific types are possible
- [ ] **PY-061**: API response schemas validated (Pydantic models for FastAPI, serializers for Django REST)
- [ ] **PY-062**: Assertion statements (`assert`) not used for input validation — use explicit checks (assert stripped in `-O` mode)
- [ ] **PY-063**: `finally` blocks used for resource cleanup — no leaked file handles, DB connections
- [ ] **PY-064**: No `sys.exit()` in library code — only in CLI entry points

## 14.8 — File & Path Safety

- [ ] **PY-065**: File paths constructed with `pathlib.Path` — no string concatenation
- [ ] **PY-066**: User-supplied filenames sanitized — no path traversal (`../../../etc/passwd`)
- [ ] **PY-067**: `os.path.join()` or `Path()` used — never concatenation with `/`
- [ ] **PY-068**: Temporary files created with `tempfile` module — not predictable names in `/tmp`
- [ ] **PY-069**: File permissions set explicitly — no world-readable sensitive files
- [ ] **PY-070**: Uploaded files validated server-side (not just client MIME type)

## 14.9 — Async & Concurrency

- [ ] **PY-071**: Shared mutable state protected with locks in threaded code
- [ ] **PY-072**: `asyncio` tasks have proper exception handling — no unhandled task exceptions
- [ ] **PY-073**: Database connections properly managed in async context (async connection pool)
- [ ] **PY-074**: No blocking I/O calls inside `async def` functions — use `run_in_executor`
- [ ] **PY-075**: Race conditions analyzed for financial operations (double-spend, double-process)

## 14.10 — Solana/Web3-Specific Python

- [ ] **PY-076**: Private keys loaded from env or hardware wallet — never hardcoded or in repo
- [ ] **PY-077**: Transaction simulation before send — `simulate_transaction()` called first
- [ ] **PY-078**: RPC endpoint loaded from env — no hardcoded mainnet URLs
- [ ] **PY-079**: Account data validated after deserialization — check discriminator, owner
- [ ] **PY-080**: Keypair files excluded from version control (`.gitignore`)
- [ ] **PY-081**: `solders` or `solana-py` used — check for known version vulnerabilities
- [ ] **PY-082**: Anchor IDL parsed correctly — validate instruction names and account counts
