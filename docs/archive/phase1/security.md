# Security model

The app crawls untrusted websites and holds API keys and a Google OAuth grant, so its main risks are server-side request forgery, unauthorised use (including running up paid API costs), and secret leakage.

| Area | Control |
| --- | --- |
| **SSRF** | Only `http(s)` on ports 80/443/8080/8443. Credentials in URLs and internal hostnames are rejected. Every DNS answer is validated at connect time, which also defeats DNS rebinding. Private, loopback, link-local, CGNAT, reserved and IPv4-mapped addresses are blocked, every redirect hop is re-checked, and response sizes and timeouts are capped. (`src/lib/crawler/ssrf.ts`, `http.ts`) |
| **Authentication** | Single owner password (`AUTH_PASSWORD`, compared via HMAC in constant time). The session is an HMAC-signed, expiring, httpOnly, SameSite=Lax cookie, marked Secure over HTTPS and bound to the password, so changing the password signs everyone out. Production fails closed (HTTP 503) when auth isn't configured. (`src/lib/security/auth.ts`) |
| **Enforcement** | `src/proxy.ts` protects every page and API route except `/login`, `/api/auth/login` and `/api/health`. Each API route also re-checks the session (`src/lib/security/guard.ts`) as defence in depth. |
| **CSRF** | SameSite=Lax cookies, plus `Origin` validation on every POST/PUT/PATCH/DELETE. |
| **Rate limiting** | SQLite-backed (survives restarts), with per-client and global caps on sign-in (brute force), audits, PageSpeed re-tests, Search Console refreshes and AI reports. `X-Forwarded-For` is only trusted with `TRUST_PROXY`. AI regeneration also has a per-audit cooldown and returns the cached report by default. |
| **Secrets** | API keys only come from environment variables. The PageSpeed key is sent as a header (`X-Goog-Api-Key`), never in URLs or error messages. The Google refresh token is encrypted with AES-256-GCM using a key derived via HKDF from `APP_SECRET`. OAuth uses state and PKCE (S256) in an encrypted short-lived cookie, plus an open-redirect guard on `returnTo`. |
| **Output safety** | CSV exports neutralise formula injection. AI Markdown is rendered without raw HTML. Crawled content is only ever rendered as text. |
| **Headers** | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS in production, `X-Frame-Options: DENY`, `nosniff`, a strict Referrer-Policy, a Permissions-Policy, COOP, and the `X-Powered-By` header removed. |
| **Container** | Runs as a non-root user. Only `/data` is writable state. |

## Testing

- `tests/security.test.ts`: auth modes (fail closed), password and session tampering, expiry and password-change invalidation, origin checks, persistent and global rate limits, spoofed `X-Forwarded-For`, proxy redirects/401/403/503, route guards with the proxy bypassed, queue claim/recovery, and unsafe URLs rejected before queueing.
- `tests/url-and-ssrf.test.ts`: blocked address ranges, DNS rebinding, and the SSRF guard in the fetch client.
- `tests/search-console.test.ts`: token encryption (including no plaintext in the database file), OAuth state/PKCE and open redirects, and only readable properties being linkable.
- `tests/pagespeed-and-export.test.ts`: API key never in the URL, and CSV injection.
- Manual check against the production build: unauthenticated pages redirect to `/login`, APIs return 401, cross-origin sign-in returns 403, security headers are present, and a hard-killed server recovers its interrupted audit.
- `npm audit --omit=dev`: 0 known vulnerabilities in runtime dependencies at the time of writing. The `shadcn` CLI, a dev-only scaffolding tool, has advisories that don't affect the running app.

## Known limitations

- `script-src` allows `'unsafe-inline'` because Next.js injects inline bootstrap scripts. A nonce-based CSP would need per-request rendering of every page.
- There's one shared owner account. There are no per-user roles.
- Rate limiting without `TRUST_PROXY` uses a single shared bucket for everyone. That's deliberate: client addresses can't be determined safely in that setup.
