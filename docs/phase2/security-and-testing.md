# Security assessment and verification

## Scope

This is a code-level assessment and automated foundation test run, not a penetration-test certification. The application is not ready for external customers. No Phase 2 HTTP route or UI has been connected. Auth handler requests are exercised in memory using real Request/Response objects and the maintained library, and domain services use disposable PostgreSQL. There has been no live Google OAuth or hosted Railway PostgreSQL test.

Review references: [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [authorisation](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), and [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). The assessment applies their separation of identity, session validation and resource authorisation; it does not claim compliance with every control.

## Verified controls

| Area | Evidence |
| --- | --- |
| Identity | Closed default registration; uninvited users refused; verified email required; submitted roles/verification ignored; library scrypt hashes instead of plaintext |
| Session | HTTP-only/Secure/SameSite cookies; persisted expiration; logout invalidation; password-reset revocation; no cached session acceptance |
| Recovery | Same response for existing/nonexistent email; short-lived library tokens; reset token replay refused; no security questions or hardcoded credentials |
| CSRF | Wrapper requires the canonical configured Origin for every state-changing HTTP request, including initial signin. Forwarded Host cannot expand it. Library's own origin checks remain enabled. |
| Abuse | Persisted library throttling; shared conservative per-path bucket when no trusted IP is configured; operational tenant limits |
| Tenant reads | Two independent customers with the same public website receive separate records and histories; guessed audit/report/snapshot IDs denied |
| Tenant writes | Foreign website rename/delete/enqueue denied; cross-tenant site/audit/page references rejected by PostgreSQL composite keys |
| Account state | Active membership rechecked on repository calls; suspended tenants denied; plain fabricated contexts refused |
| Quotas | Tenant-row locking around admission; website/monthly/active-audit limits; usage survives website deletion |
| Administration | Separate administrator grants; registration cannot self-assign; offline bootstrap requires a verified user and refuses a second bootstrap |
| Migration | Counts, JSON/score/ID preservation, ciphertext equality, source hash unchanged, new sequence IDs, rollback on malformed JSON, wrong key and active-job refusals |
| Existing engine | Existing SSRF/crawler/SEO/report/Search Console tests retained; no edits to crawler, existing worker or live authentication |

Authentication logging is disabled in the new factory because library diagnostics may include email addresses. Connect explicit redacted event logging/monitoring before launch; logging disabled is not a complete operational monitoring solution. Operator commands suppress raw driver errors which may contain SQL parameters or credentials.

## Failures found and corrected

1. Generated PostgreSQL migrations placed composite foreign keys before referenced unique indexes. Changed referenced tenant/resource pairs to unique constraints so clean-database migrations succeed.
2. Invitation lookup inside the library's user-create transaction used an independent database connection. PGlite exposed a deadlock. Moved invitation checks into the library's pre-endpoint hook, outside that transaction; personal-account creation/consumption remains transactional.
3. The library's first-request signin handling accepted the test's foreign Origin without existing ambient cookies. Added a canonical-Origin HTTP wrapper covering signup, signin and all mutating auth requests.
4. Library throttling returns `X-Retry-After`; the wrapper now also sends standard `Retry-After` and disables caching of auth responses.
5. Verified SQLite snapshots can have empty WAL sidecars. The importer rejects pending WAL data and verifies the standalone main-file checksum, while allowing an empty sidecar.

## Test commands

```sh
npm test
npm run typecheck
npm run lint
DATABASE_PATH=/private/tmp/seo-phase2-build-20261014.db npm run build
npm run test:railway
```

Final foundation verification: **119 tests passed across 11 files**, including simultaneous admission. TypeScript and lint passed. The original deployed-baseline suite had 105 passing tests. The production build uses a disposable database so it cannot migrate a private local database. Turbopack helper process/port creation was blocked, including after an approved retry outside the sandbox. The supported `npm run build -- --webpack` production build **passed**, generating all existing routes. No bundler configuration was changed to hide the default-build failure.

The standalone `npm run test:railway` test initially encountered a sandbox loopback-port restriction, then **passed** with approved execution outside the sandbox. It verified readiness, login/cookie, denied unauthorised access, CSRF, SSRF, duplicate jobs, all four export formats, Fix instructions, SIGTERM/restart persistence, queued/interrupted recovery and backup/restore. This is a local standalone build test, not a deployment or test of Railway's live volume.

PGlite concurrency tests run simultaneous promises against one PostgreSQL instance; they do not prove cross-process worker leasing or global concurrency. Those require hosted/native PostgreSQL and multiple workers. Browser/UI, direct application API, OAuth callback isolation, account deletion and complete multi-user exports remain launch-blocking tests until those integrations exist.

## Dependencies

`npm audit` on 14 October 2026 reported **13 findings: 9 high and 4 moderate**, in development-tool dependency chains involving shadcn, fast-glob/micromatch/braces, eslint tooling and drizzle-kit/esbuild. No direct new auth/pg advisory appeared in this scan. The suggested automatic fixes include incompatible version downgrades; no forced bulk downgrade was applied.

Review and remediate compatible fixes or document reachability and acceptance before beta. Keep dev servers private. Re-scan runtime-only and full dependencies at release time; this scan is evidence for its recorded dependency tree, not a guarantee about future advisories.

## Outstanding security gates

Customer sessions must not reach any remaining global Phase 1 query. Audit every page/API/export/search/compare/AI/OAuth/worker call and cache key. Route-level and browser Account A vs B tests are mandatory.

The new job schema/admission are incomplete without distributed leases, fencing, global limits, retries, error reporting and a tenant-scoped runner. Do not attach the existing SQLite runner to new job IDs. Preserve DNS-at-connect SSRF checks, redirect checks, response bounds, robots compliance and external-content distrust during the port.

Live OAuth tokens must never appear in API responses, data exports, logs or admin views. The migration tested ciphertext and decryptability; it did not test actual Google refresh, account property authorisation, disconnect or tenant-aware caches. These require separate authorised test grants.

Add current-password/fresh-session checks for sensitive account changes/deletion, sessions UI, recovery delivery, CSRF tests through the reverse proxy, runtime/migration role separation, parameter validation, redacted monitoring, retention execution, abuse alerts and a full OWASP review before external use. Establish the preserved production-volume backup and independent restore evidence first.

## Stage 2 route-level evidence

`tests/beta-routes.test.ts` imports the real Next.js route modules (`/api/beta/*`) and calls them with real `Request` objects, the real Better Auth handler and a migrated PostgreSQL engine (PGlite). It uses three identities: an administrator bootstrapped through the offline grant, and customers **Alice** and **Bob**, each onboarded through HTTP routes and emailed links. Further synthetic users cover edge cases. `tests/beta-config.test.ts` covers configuration refusals, email delivery, the proxy, and a static scan that blocks beta code from importing global Phase 1 modules.

| Area | Positive (allowed) | Negative (refused) |
| --- | --- | --- |
| Invitations | Admin creates an invitation (201, link shown once, email sent); only a SHA-256 hash is stored; admin listing shows email, status and expiry | Listing contains no token hash or creator/consumer IDs; reissue for a registered address → 409; `PHASE2_INVITATIONS_ENABLED=false` → 403 with nothing written; revoked token cannot register |
| Admin access | Administrator can list, create and revoke | Customer GET/POST/DELETE on admin APIs → 404; unauthenticated → 401; customer revoke changes nothing |
| Registration | Invited email with valid token → 200, unverified user | Unknown token, mismatched email, foreign Origin, missing Origin, short password → 403/400, and the token stays usable; replay → 403; two simultaneous uses → one 200, one 403; expired → 403; closed registration → 403; library `sign-up/email` over HTTP → 404 (and 403 cross-origin); `role`, `emailVerified` and `tenantId` fields ignored |
| Verification and tenant | Verification link → 302 to `/beta/login?verified=1`; tenant, owner membership and consumed invitation created in one transaction; replay creates no second tenant | Sign-in before verification → 403 `EMAIL_NOT_VERIFIED` (new link sent, no tenant); invitation revoked before verification → no tenant, customer APIs → 401 |
| Website isolation | Two customers add the same public domain as separate records; owner renames (trimmed) and removes; activity logged | No session or forged cookies → 401; Bob GET/PATCH/DELETE Alice's ID → 404 with no Alice data; manipulated IDs (`1 OR 1=1`, `-1`, `0`, `1e3`, `abc`, overflow, path tricks) → 404; browser-supplied `tenantId` ignored |
| Input safety | Public URLs normalised (`www.` and case de-duplicated) | `javascript:`, `ftp:`, loopback, link-local metadata, IPv6 loopback, embedded credentials, bare `localhost` → 400; control-character display names → 400; website limit → 409 |
| CSRF | Same-origin mutations succeed | Valid cookie with foreign Origin, missing Origin or lookalike origin → 403, for website routes, registration and auth |
| Sessions and account | Name update; customer revokes own other session; sign-out; password change with current password signs out other sessions | `get-session`/`list-sessions`/`revoke-session`/`delete-user`/`change-email`/social sign-in → 404; email change via update-user → 400; unauthenticated update → 401; Bob revoking Alice's session → 404; wrong current password → 400; suspended tenant → 401 |
| Recovery | Reset email → callback → new password works; old sessions revoked | Known and unknown email get identical responses; token replay → 400; old password → 401; 7 rapid failed sign-ins → 429 with `Retry-After` |
| Configuration | Complete production config accepted; invitations off by default; local PGlite/localhost/log allowed only in development | `AUTH_DISABLED`, missing owner password in production, production DB URL reuse, non-PostgreSQL URL, `open`/`public` registration, short or reused secret, non-HTTPS origin, `log` email in production, missing Resend key |
| Phase 1 isolation | Owner routes unchanged (`npm run test:railway` passed) | Beta cookie on `/`, `/audits`, `/reports`, `/settings` → redirect to owner `/login`; on `/api/audits`, exports, Search Console and Google connect → 401; beta paths 404 when disabled; `/betaadmin` lookalike still needs owner auth |
| Email | Resend request carries sender, recipient, text and escaped HTML | Provider failure message has no address or token; non-allowlisted recipients suppressed without logging the address |

These are in-process tests. They do not exercise Railway's TLS termination, forwarded headers, hosted PostgreSQL, real email delivery or multiple app instances. Those remain on the [staging verification list](staging-setup.md#6-hosted-verification-to-record).

## Stage 3 audit-engine evidence

`tests/saas-jobs.test.ts` (23 tests) exercises the queue, runner, quotas and budgets against migrated PostgreSQL (PGlite), with a fake crawler and PageSpeed client and an injected clock. `tests/beta-audit-routes.test.ts` (13 tests) calls the real `/api/beta/audits` route modules as customers Alice and Bob and an administrator.

| Area | Allowed | Refused |
| --- | --- | --- |
| Audit start | Owner starts an audit of their own website (202) | Another account's website ID, with or without a forged `tenantId` (404); malformed IDs (404); missing body (400); foreign or missing Origin (403); second active audit (409); monthly limit and full global queue (409); more than 10 starts in 10 min (429) |
| Audit reads | Owner status, findings, history, compare | Every endpoint for another tenant's audit returns a body byte-identical to a missing ID; administrator gets 404 too (no impersonation); no session or forged cookie (401) |
| Reports | PDF/CSV/JSON/Markdown/tasks for the owner, `private, no-store`, filename from the owner's host and ID | Foreign audit 404; unfinished audit 409; unknown format 400; legacy owner export with a customer session (401); `tenant_id` absent from exports (a leak found and fixed during this stage) |
| Fix with AI | Owner prompt download | Crawled page title containing an injection instruction appears only inside fenced, labelled untrusted-data blocks |
| Jobs | One claim per job under 6 concurrent claimers; retry after lease expiry with fence + 1 | Stale worker's progress, heartbeat, completion and failure writes; late completion after another worker finished; completion for a suspended account; claims beyond the global or per-account limits |
| PageSpeed | Measured results stored as `ok` | Unfunded, timed-out and 429 tests stored as `unavailable` with no metrics; tests after a confirmed quota error skipped; monthly and daily budgets atomic under parallel reservation |
| AI | Stored report reused without new spend | Over-budget regeneration (409); unconfigured provider refused (503) before any budget is reserved |

Issues found and fixed during this stage:

1. Report generators spread whole rows, so JSON exports included the account's internal `tenant_id`. `full()` now strips it before any generator runs.
2. A GET-only route (`/api/beta/audits/compare`) was prerendered at build time: with Cache Components, a handler that touches no request data is static. `withCustomer()` now calls `connection()`, so every beta API runs at request time and no build opens the database.
3. An abort that arrived before the crawl started was missed; the runner now checks the signal before crawling.
4. Admission counted active audits but not PageSpeed re-test jobs; the per-account concurrency limit now counts all active jobs.
5. The AI route would have charged the budget before discovering that no provider key exists; it now refuses first.

6. *(Hosted PostgreSQL)* A worker frozen mid-transaction held the global advisory lock indefinitely and stalled every claim and admission. Pool connections now carry idle-in-transaction, lock and statement timeouts.
7. *(Hosted PostgreSQL)* A server-terminated session on a checked-out client crashed the Node process through an unhandled `error` event. Every client now has an error listener.

Multi-process evidence on hosted PostgreSQL 18 (separate worker processes, `kill -9`, SIGSTOP/SIGCONT, cross-process quota and budget races) is recorded in the [ledger](README.md#hosted-postgresql-verification-railway-14-october-2026). It was not run under production-like load.
