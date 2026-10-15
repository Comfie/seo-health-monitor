# G5: multi-tenant Google Search Console — verification report

Prepared 15 October 2026 (Africa/Johannesburg) on `phase2-multiuser`, based on the tested G4 release `d31e130` (evidence `adcf96f`). **Status: implemented and verified locally; hosted verification with real Google accounts has not started and needs approval** (gates SC1–SC5 below). Nothing was committed, pushed or deployed. Phase 1 production, its Google integration and the beta staging services and data were not changed. The only staging access in this pass was a read-only listing of variable *names*.

> Naming: this milestone is "G5 (Search Console)". The runbook's earlier gate "G5 production SQLite backup" in [staging-setup.md](staging-setup.md#0-approval-gates) is a different, still-unapproved gate and is unchanged.

## What was tested with real Google versus mocks

| Area | Evidence so far | Real Google? |
| --- | --- | --- |
| OAuth (state, PKCE, callback, tenant binding, replay, swap, scope checks) | 27 route-level tests plus a 28-check local browser walkthrough | **No.** A fake Google enforces client credentials, PKCE S256, single-use codes, per-user properties and per-user grant revocation. |
| Property listing, linking, domain and URL-prefix suitability | Route tests and browser walkthrough | **No** (fake Google) |
| Search Analytics, URL Inspection, refresh jobs, audit integration | Route and worker tests; browser walkthrough with a real crawl of example.com | **No** for Google data. The crawl was real. |
| Token refresh, revocation detection, disconnect, shared-grant handling | Route tests | **No** |
| Keyless PageSpeed API from this workstation | One request | **Yes**: HTTP 429 `rateLimitExceeded` (see PageSpeed below) |
| Hosted OAuth callback, hosted isolation, real Search Console data | — | **Pending** (SC1–SC4) |

No result in this report should be read as proof that real Google accounts work end to end. That evidence comes from the hosted run.

## Design

| Concern | Implementation |
| --- | --- |
| OAuth start | `POST /api/beta/google/connect`, an HTML form post, so the existing canonical-Origin check applies. A 32-byte state and a 48-byte PKCE verifier are generated per attempt. The `google_oauth_states` table stores only the SHA-256 of the state, plus the AES-GCM-encrypted verifier, tenant, user, session ID, a hash of a browser nonce, the return path and a 10-minute expiry. The nonce is set as an `HttpOnly`, `Secure` cookie scoped to `/api/beta/google`. Scopes requested: `openid email webmasters.readonly`, with `include_granted_scopes` **off** so a stored grant never inherits wider access. |
| Callback | `GET /api/beta/google/callback`. The tenant comes from the beta session, never from parameters. The state row is **consumed atomically before any other check**, so it works once whatever the outcome. Tenant, user, session and browser nonce must all match; otherwise nothing is exchanged and nothing is stored. Only a fixed outcome code is passed back to the page (no reflected Google text). The response carries `no-store` and `no-referrer`. |
| Grant checks | A token is stored only if `webmasters.readonly` was granted, no scope outside `openid`, `email` and `userinfo.email` is present, a refresh token was returned and the ID token has a `sub`. Rejected tokens are discarded, **not revoked**: revoking would end the same Google user's grant for other accounts of this app. |
| Storage | One `google_accounts` row per tenant (new unique index), with Google's `sub`, status and timestamps. The refresh token is AES-256-GCM encrypted under the **beta's own secret** (`PHASE2_GOOGLE_TOKEN_SECRET`), using the existing `encrypt` code with an optional root secret, and an HKDF purpose bound to the tenant ID. A ciphertext copied into another tenant's row fails to decrypt (tested). Existing composite foreign keys bind links, snapshots and jobs to the tenant's own websites. |
| Access tokens | Process memory only, keyed by tenant, account and credential version, and cleared on reconnect, revoke and disconnect. |
| Reconnect | The same Google account updates the credential and restores existing links. A different Google account replaces the old one and removes its links, because the new account has not been shown to have access to those properties. The old grant is then revoked unless shared. |
| Revocation | Google `invalid_grant` marks this exact credential `revoked` (a concurrent reconnect is not overwritten). The links are flagged and the customer is asked to reconnect. Audits then report index status as *not verified*, with that reason. |
| Disconnect | Revokes at Google **unless the same Google user is connected to another tenant** (Google revokes per user and client). Then deletes the credential, links, pending states and queued refreshes, and re-marks the latest audits as not verified. Other tenants are untouched (tested). |
| Properties | Listed live from the tenant's own token. Linking requires the property to be in that list right now (not `siteUnverifiedUser`) **and** to cover the website's host: a domain property for the domain or a parent, or a URL-prefix property on the same host (with or without www, either scheme). URL Inspection only sends URLs the property covers. |
| Refresh jobs | New `search_console_jobs` queue, separate from `background_jobs`, so G4 audit claims, limits and fencing are unchanged. It uses the same protocol: `FOR UPDATE SKIP LOCKED` claims, fence plus lease token on every write, bounded retries with backoff, lease-expiry recovery and graceful hand-back. At most one active refresh per website (partial unique index), at most one running per worker process, and the tenant comes from the job row. Quota and transient errors are retried; revocation fails the job without retrying. |
| Audits | The worker fetches Search Console data with the **lease's** tenant. Up to `PHASE2_GSC_MAX_INSPECTIONS` (default 10) URLs are inspected, most important first (homepage, shallow and well-linked pages). The snapshot is written inside the fenced completion transaction. Google problems never fail an audit. |
| Index findings | The shared weight-0 "Google index coverage" check now explains Google's documented coverage states (crawled or discovered but not indexed, noindex, robots.txt, canonical choices, redirects, soft 404, 4xx and 5xx, unknown URL), with a recommended action. It flags important pages with high severity and labels the data as owner-authorised URL Inspection, not the public crawl. The first evidence line is unchanged for Phase 1. Without a connection, every message starts with **"Not verified:"**. |
| Reports and AI | JSON and PDF exports carry an owner-authorised summary or an explicit `verified:false` note. Indexing issues flow into Fix with AI, CSV and Markdown as ordinary findings. The AI consultant's prompt allows Google figures only when `verified:true`. Phase 1 callers pass nothing and keep their previous output. |
| Customer UI | New **Search performance** page (`/beta/search-console`) with: connect, reconnect and disconnect; property linking per website; status and errors; refresh with progress; clicks, impressions, CTR and position with deltas; daily trends; top queries and pages; index status with Google's reason and the fix; and a table of on-site health score next to Google data per audit. The audit results page has a "Google search performance" panel, separate from the score. Low-traffic, delayed-data and anonymised-query cases are explained instead of showing zeros as errors. |
| Headers | `/beta/search-console` only: `form-action 'self' https://accounts.google.com` and `Referrer-Policy: same-origin`. Both were found in the browser walkthrough: Chrome blocks the redirect to Google under `form-action 'self'`, and under `no-referrer` sends `Origin: null` on form posts, which failed the Origin check. The page URL carries no tokens, and every other page keeps the previous headers. |

### Routes (all session-derived, foreign IDs get the same 404 as missing ones)

`GET /api/beta/google` (status) · `POST /api/beta/google/connect` · `GET /api/beta/google/callback` · `GET /api/beta/google/properties` · `POST /api/beta/google/disconnect` · `GET|POST|DELETE /api/beta/websites/{id}/search-console` · `POST /api/beta/websites/{id}/search-console/refresh` (202).

Per-account throttles: connect 10 per 10 minutes, property listing 30 per 10 minutes, linking 20 per hour, refresh 10 per hour.

## Migration `0003_g5_search_console` (additive)

New tables `google_oauth_states` and `search_console_jobs`. New nullable or defaulted columns on `google_accounts` (`google_subject`, `status` default `active`, `updated_at`) and `search_console_connections` (`permission_level`, `last_refreshed_at`, `last_error`). New indexes, including unique `google_accounts(tenant_id)`, plus a status check. No drop, rename, column rewrite, update or delete. A new test applies 0000–0002, inserts G4-style rows (tenant, membership, site, audit, job, usage, Google account), applies 0003 and asserts every pre-existing row is byte-identical: 24 tables. Staging currently holds no Google rows; verify with the read-only check before migrating (SC2). The SQLite importer maps the new columns explicitly. Imported Phase 1 ciphertext is unreadable under the beta key, so such an account is marked revoked on first use and its owner reconnects.

## Local results (this workstation)

| Check | Result |
| --- | --- |
| `npm test` | **239 passed, 18 files** (211 G4 baseline + 27 in `tests/beta-search-console.test.ts` + 1 migration test) |
| `npm run typecheck`, `npm run lint` | Passed, no warnings |
| `npm run build` (disposable `DATABASE_PATH`) | Passed; all new routes are request-time; standalone `node_modules` has `pg` only (no PGlite/tsx) |
| Worker bundle (`esbuild`, as in `Dockerfile.worker`) | 255.4 kB (was 215.6 kB); imports only runtime packages: no SQLite, PGlite or Phase 1 Search Console service |
| `npm run test:railway` (Phase 1 standalone smoke) | Passed |
| Local SQLite database | Write-protected; SHA-256 of `.db`, `-wal`, `-shm` unchanged |
| Browser walkthrough (headless Chrome via `playwright-core` in the scratchpad; isolated app copy without `.env.local` or `data/`; PGlite; in-process worker; log email; **real crawl of example.com**; fake Google preloaded into the server's `fetch`; only the consent screen hop simulated) | **28/28** (below) |

### Route-level isolation tests (`tests/beta-search-console.test.ts`, 27)

Customers Alice, Bob and Carol. Alice and Bob use different Google identities; Carol authorises the same Google identity as Bob.

- **Configuration:** Search Console is optional; the Phase 1 client ID, a reused secret, a short secret or a partial configuration is refused, while the beta stays up.
- **Before connecting:** the index check is "Not verified"; the export says `verified:false`; connect requires a session and the canonical Origin; an unauthenticated callback redirects to login.
- **OAuth start:** read-only scopes, S256, the beta redirect URI and no `include_granted_scopes`; the nonce cookie is HttpOnly, Secure and path-scoped; only the state hash is stored.
- **Connection:** Alice's account belongs to Alice's tenant only, with the token encrypted; Bob sees no account.
- **Replay:** replaying a used state returns `state_invalid` and the code is not exchanged again.
- **Tenant swap:** Bob completing Alice's callback (with or without her cookie) returns `session_mismatch`; nothing is stored, nothing is exchanged and the state is burnt. A callback without the browser nonce, an expired state or a forged state is refused.
- **Grant validation:** a missing scope, an over-broad scope, no refresh token or access denied stores nothing.
- **Property isolation:** each customer lists only their own properties. Bob linking Alice's property ID returns **403**, an unsuitable property **422**, an unverified property **403**, and a non-string body **403**; a customer without a connection gets **409**.
- **Manipulated IDs:** IDs `alice's`, `0`, `-1`, `1e3`, `2147483648` and `1 OR 1=1` on GET/POST/DELETE/refresh all return a 404 **byte-identical** to a missing website, and Alice's link is untouched.
- **Data isolation:** refresh jobs call Google only with the owning tenant's token for that tenant's property. Snapshots and overviews contain only the owner's figures and private queries.
- **Refresh mechanics:** at most one active refresh per website; a per-account throttle that doesn't affect other accounts; the worker loop reports the job-row tenant; a superseded lease cannot write.
- **Audits:** inspections use the owner's property and only covered URLs. The finding reads "Google crawled this page but chose not to index it (important page)", high severity, with source and action. The other tenant's audit stays unverified. The score is identical with and without Search Console.
- **Reports:** Fix with AI includes the indexing task; JSON exports carry only the owner's summary; the PDF renders; a foreign export is 404.
- **Quota:** an inspection 429 leaves the check "not verified (quota)" and the audit still completes; an analytics 429 gives retry, retry, failed, with the last good data kept and the reason shown.
- **Revocation:** revoking at Google marks only Alice `revoked`, Bob keeps working, new audits explain the reason, and reconnecting the same account restores the links.
- **Copied ciphertext:** Alice's ciphertext copied into Bob's row is unusable (`reconnect`) and no Google call is made as Alice.
- **Shared grant:** Carol disconnecting a grant shared with Bob does not revoke at Google, and Bob still works.
- **Disconnect:** Alice's disconnect revokes at Google, deletes her credential and links, resets her latest audit to not verified, and leaves Bob unaffected; a second disconnect is a no-op.
- **Unlink:** keeps the Google account.
- **Secrets:** across every response body, redirect, `Set-Cookie`, export and captured console output, no access or refresh token, client secret, ciphertext column or verifier appears.

### Browser walkthrough (28/28)

Alice audited example.com and saw "Not verified". She then connected through the real form, POST and callback; saw only properties covering her site; linked one; and watched the refresh job complete with metrics, top query and trend charts. A second audit showed the important-page indexing finding, with Google's reason and fix, on the findings page, plus the audit-page Google panel, the Fix with AI task and the score-versus-Google table.

Bob, on the same domain, saw only his unconnected state, even with Alice's website ID in the URL. A callback started by Alice and completed in Bob's browser was refused (`session_mismatch`), and Bob had no connection afterwards. Bob then connected his own account and saw only his own property. Forged-property linking returned 403 and a foreign snapshot read returned 404, and he saw only his own data.

Alice disconnected and her latest audit reverted to "not verified". Bob stayed connected and could refresh. No token material appeared in rendered pages, and there were no console errors apart from the two deliberate probes' 403/404.

## PageSpeed measurement gap (investigated)

The G4 runs recorded only "unavailable" PageSpeed results. Root cause: neither beta service has `PAGESPEED_API_KEY` (variable names listed read-only), so requests use Google's shared anonymous quota. A single keyless request from this workstation today returned **HTTP 429 `rateLimitExceeded` ("Queries per day")**. The application behaves correctly: it stores the result as unavailable, never as a measurement.

Fix (needs approval, SC5): create a **beta-only** API key restricted to the PageSpeed Insights API (and to the beta services if possible), and set `PAGESPEED_API_KEY` on `seo-beta-worker`, which runs audits and re-tests, and `seo-beta-web`. Keep `PHASE2_GLOBAL_PAGESPEED_PER_DAY` as the cost cap. Do not reuse Phase 1's key.

## Hosted verification plan (approval required; nothing below has been done)

| Gate | Action | Phase 1 impact |
| --- | --- | --- |
| **SC1** | You create a **new** Google OAuth client, separate from Phase 1. Ideally use a separate Google Cloud project: enable the Search Console API, set the consent screen to *Testing* with only the test Google accounts as test users, add the redirect URI `https://seo-beta-web-production.up.railway.app/api/beta/google/callback`, and authorise no other origins. I then set `PHASE2_GOOGLE_CLIENT_ID`, `PHASE2_GOOGLE_CLIENT_SECRET` and a new random `PHASE2_GOOGLE_TOKEN_SECRET` on **beta web and worker** via stdin. | None |
| **SC2** | Read-only `db:saas:staging -- check`. Confirm there are zero `google_accounts` rows and that `0003` is the only pending migration. Then `migrate --confirm-staging=…` applies the additive `0003`. Existing accounts, audits and usage stay as they are. | None |
| **SC3** | Commit the G5 source, then deploy beta web and worker from a clean `git archive` (as in G4). Keep G4 settings, the invite-only allowlist and the existing accounts. | None |
| **SC4** | Hosted tests with **real Google accounts**: A and B each connect their own Google account, which needs real Search Console access to a property. Repeat the isolation matrix above against the hosted app: callback replay and swap, foreign IDs, property forgery, refresh jobs, disconnect independence, token-leak scans of responses, exports and Railway logs. Run audits with real index data, plus G4 regression (sign-in, websites, scans, cancellation, quotas, reports, Fix with AI, isolation). With approval, also temporarily scale `seo-beta-worker` to two replicas for a multi-worker run, including `railway`-initiated termination of one replica mid-job and lease recovery, then scale back. | None |
| **SC5** | Beta-only PageSpeed key as above, then one audit to confirm real measurements. | None |

Decisions needed from you: approval for each gate; which Google accounts A and B will use and which Search Console properties they can see; and whether two separate Google identities are available. If both customers use the same Google account, isolation still holds per tenant, and the shared-grant path is exercised. Neither your Google password nor any customer's is needed or requested: you complete Google's consent screen yourself.

## Known limitations and residual risks

- Hosted behaviour (real Google responses, Railway proxy headers on the callback, real quotas) is **unverified** until SC4.
- Railway's HTTP logs may record the callback query string. The authorisation code is single-use and useless without the server-side PKCE verifier and client secret, and the state is single-use.
- Property listing calls Google on each Search performance page view, subject to Google's per-user quota. It is not cached.
- When the same Google user is connected in two tenants, a disconnect deletes the local credential but leaves Google's grant in place (by design, to protect the other tenant). The customer is told they can also remove access in their Google account.
- Old snapshots are kept after unlinking or disconnecting, as the account's own history. Screens and reports only use data for the currently linked property, and account data deletion is still outside this stage.
- Isolation still relies on repository filters, composite foreign keys and tests (no PostgreSQL row-level security), as in G4.
