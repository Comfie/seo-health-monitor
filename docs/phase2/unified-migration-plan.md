# Unified application release review — 15 October 2026

The owner's latest instructions supersede the separate-product and dedicated-Google-client strategy. Source remains `phase2-multiuser`, preserving completed G5/G6 work and evidence. The final target is **https://seo-health-monitor-production.up.railway.app/**. Final production cutover, production logical-database creation/role changes, and production variable changes are **not executed without explicit approval of this packet**. Existing beta is the rehearsal service, not a second permanent product. No invitations, payments, public registration, or scheduled destructive retention.

## Source reconciliation

Live production is revision `b3a86700fab74da2d0a40a5e138d445a4e9fccaa`, equal to `railway-deployment` and the merge base of `phase2-multiuser`. Production image is `sha256:46a99985a198bfb86c7c550d576ca6fbb3b4705cb7b1d4d7103f8b63eb02c340`, deployment `b921c2dc-3e09-4386-8605-209ece6febb1`. `main` is `11b7cb6` and lacks Railway-specific safeguards. No merge or replacement with `main` is needed. The existing Docker privilege drop, graceful worker shutdown, SSRF controls, security headers, secret handling, and Phase 1 fallback are retained. Unified entrypoint skips SQLite volume initialization/ownership changes entirely.

## Verified actual production backup

Production service `899895fa-f368-42d9-aba6-e1a6ccb9a5ab`, environment `437c36cc-333e-41ea-b7f5-42351b88582a`. Live SQLite is `/data/seo-health.db` on `/data`, WAL enabled, with zero active audits at inspection. The SQLite online backup API made a consistent snapshot in the running container's temporary directory. It was downloaded to the operator's private directory **outside the live volume**, restored to a new file, and checked using the production `APP_SECRET` obtained through Railway configuration, never displayed.

Artifacts: `/Users/comfort/secure/backups/unified-20261015/phase1-production.db` and `phase1-restored.db`, files 0600, directory 0700. Both SHA-256 values: `8d0d70a0951c89fbea910c3215538189bdc89df1e6259646080ec7e4796ea707`. Both integrity checks `ok`; zero FK violations; identical counts. Private original variable snapshot and image/deployment manifests are beside these files. No backup, password hash, connection URL, or secret is committed. This is the **live Phase 1 backup**, distinct from staging PostgreSQL backups.

| Record | Production backup | Independent restore | PostgreSQL rehearsal |
| --- | ---: | ---: | ---: |
| Websites | 4 | 4 | 4 |
| Audits | 4 | 4 | 4 |
| Pages | 94 | 94 | 94 |
| Checks | 220 | 220 | 220 |
| Findings | 354 | 354 | 354 |
| Performance results | 24 | 24 | 24 |
| Google accounts / tokens | 0 | 0 | 0 |
| Google property links | 0 | 0 | 0 |
| Search Console snapshots | 1 | 1 | 1 |

Actual production currently contains **no Google refresh tokens or property links**. Token decryptability therefore has no real stored token to exercise; do not call this a successful live-token test. A historical snapshot is preserved. Automated tests with encrypted synthetic grants verify original-secret decryption, tenant-key re-encryption, foreign-tenant rejection, and property relationships. The production OAuth client and PageSpeed key are configured, but their presence is not proof of current provider success.

## Migration rehearsal and identity preservation

The restored production backup was imported into a disposable local PostgreSQL engine (PGlite), on migrations 0000–0004. All nine application-table counts match. **10,646 fields compared structurally, zero mismatches**, including scores, JSON, timestamps, report text, IDs and relationships. FK constraints remained enabled; identity sequences advance beyond imported IDs; repeated imports and populated destinations are refused. Source backup remains byte-identical. Rate-limit counters and SQLite-specific migration metadata are intentionally not imported. Historical completed audits have no pending jobs and are not charged again to the new admission ledger.

Only the existing verified administrator's identity and password hash are selected from beta via `captureUnifiedOwner`; administrator privilege, verified email, active personal tenant and credential are required. New destination receives that user ID, credential, personal tenant and administrator grant; **zero staging test users, sessions, invitations, Google credentials or staging websites/audits**. The old single-password Phase 1 system has no user table to preserve; after cutover use the existing verified multi-user administrator account and its existing account password. Old owner cookies are not accepted as user sessions. Owner test limits are bounded (20 websites, 100 audits/month, 1,000 PageSpeed reservations/month, 50 AI calls/month); shared daily limits still take precedence.

`importSqliteBackup` supports an explicit independent destination token secret: legacy grants, if present in the final snapshot, are decrypted with the original `APP_SECRET` and immediately re-encrypted with the tenant-bound G5 purpose and destination token key. Tokens are not copied to another tenant or written to logs. The importer checks the verified administrator and records source checksum and counts. Offline `scripts/unified-migration.ts` requires an explicit separate target database, exact host/database confirmation, private inputs, owner email confirmation and valid keys. It is never invoked by deployment/startup.

## Google reuse and callbacks

Use existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PAGESPEED_API_KEY` from approved Railway configuration. No new Google project, client, or API key. Set `PHASE2_GOOGLE_REUSE_LEGACY_CLIENT=true` deliberately. Credential fallback is only enabled by that flag; an override conflicting with the existing client fails closed. Each environment uses its own independent `PHASE2_GOOGLE_TOKEN_SECRET`, different from `APP_SECRET` and `PHASE2_AUTH_SECRET`.

The callback constructed by the actual Phase 1 deployment is:

`https://seo-health-monitor-production.up.railway.app/api/integrations/google/callback`

Unified mode preserves that exact callback and dispatches it to G5's tenant-aware handler. The Google Cloud console redirect allowlist itself has not been independently inspected. No URI change is needed at cutover if the existing working client already authorizes this deployed callback. Browser binding is scoped to `/api` so both the new connect endpoint and preserved callback receive it. State remains short-lived, single-use and bound to user, tenant, session and browser; PKCE, read-only scope verification and encrypted verifier storage are unchanged. Old in-flight Phase 1 consent flows will need restarting after cutover; legacy state is never accepted as tenant state.

Scopes remain `openid`, `email`, `https://www.googleapis.com/auth/webmasters.readonly`. Each tenant sees only its own credential, properties, links and snapshots. With intentional client sharing, disconnect/reconnect and account deletion erase local access **without calling Google's grant-wide revocation endpoint**, protecting grants held in another tenant/deployment. The user can remove the app in Google Account permissions when they deliberately want a Google-wide revocation.

Before cutover, beta's same-path callback is on the beta host. To perform live consent there, optionally add `https://seo-beta-web-production.up.railway.app/api/integrations/google/callback` to the **existing** client's redirect allowlist. This is an additional test URI, not a new client. Alternatively leave that extra URI unconfigured and perform consent on the original domain after approved cutover. Never send beta state to the live Phase 1 handler. Live consent, authorized properties, analytics, indexing, token refresh and reconnect remain **unverified until actually performed**.

PageSpeed remains server-side, with the existing key in `X-Goog-Api-Key`, real mobile/desktop parsing, Lighthouse and any field Core Web Vitals supplied by Google, existing scoring, per-account reservations and global budget. Beta daily cap remains **40**, with up to three pages per audit (mobile and desktop); no zero override. The key's Google Cloud quota covers both services during transition; their database usage ledgers are independent, so monitor aggregate provider quota. Quota/errors/absent field data are unavailable states, never invented scores. Fix with AI prompts require no provider key. AI narrative reports require `ANTHROPIC_API_KEY`, which is absent from actual production; supplying one is optional owner action.

## Unified routing and UI

`PHASE2_UNIFIED=true` retires legacy SQLite access and owner login, skips the legacy worker, and requires ready PostgreSQL configuration. `/` and old page bookmarks redirect to the account experience; old audit IDs and report-download URLs map to tenant-aware pages/handlers with ownership checks. `/api/health` measures PostgreSQL. Unknown legacy paths are denied, never passed to global data. A second handler guard and `getDb()` protection enforce retirement even if proxy routing is bypassed.

The current shared application shell/branding remains. `/beta` is temporarily the canonical account route prefix on the **same app/domain**, not another product. Legacy `/audits/:id/report`, category pages with `?audit=`, history, comparisons, Fix with AI, settings and Search Console retain usable destinations. Deprecated API consumers that submit the old audit-create body must adopt the website-ID contract; they are not silently allowed to create global work. The original SEO Progress charts, metric changes, timeline and Search Console movement are ported to tenant-scoped queries at `/beta/progress`. G6 administration, monitoring, notices and account lifecycle remain available. A later route-only cleanup can move these pages to root paths, with `/beta` redirects, while retaining the same authentication base path/cookie and tenant repositories; no second data migration is necessary.

## PostgreSQL and cutover proposal — pending approval

Read-only inventory: PostgreSQL 18 service `4b213dae-47d8-49a5-b67e-a07fdd2bf9ce` has `postgres` and staging database `railway`. Beta already uses private networking. Do not put production records into staging `railway` or copy its test accounts.

1. Review and approve creating logical database `seo_health_production` on the existing PostgreSQL service. Use a separate owner/migrator role and a runtime role with only CONNECT, schema USAGE, application DML and sequence access; no superuser/role/database creation. Keep administration credentials operator-only. Review existing beta runtime credentials and restrict them before production shares the server, so staging credentials cannot access the new production database. No shared service restart or staging-data deletion is required. Sharing a server still shares capacity/failure risk; resource monitoring/backups apply to both databases.
2. Migrate only the new database with explicit 0000–0004. Import only the approved verified owner identity and a **fresh final production SQLite snapshot**, after audit drain and a short write freeze. Repeat integrity, field/count, relationship, sequence and Google-key checks. The rehearsal snapshot is not a substitute for that final snapshot if production has changed.
3. Prepare a production worker using `Dockerfile.worker`, one replica, private production DB URL, same production auth/origin/Google configuration, bounded concurrency and existing leases/fencing/retries/graceful shutdown. Keep it idle until the new destination is ready. Retain beta worker for isolated staging; no staging queue consumes production jobs. This is the only additional application service proposed; existing production web and PostgreSQL are reused.
4. Configure the original web service with `PHASE2_ENABLED=true`, `PHASE2_UNIFIED=true`, `PHASE2_DATABASE_URL` pointing at the new database via private networking, production origin, independent auth/token secrets, existing Google client/key and existing `APP_SECRET` retained for recovery. Registration stays closed, invitations disabled, recipients restricted, destructive retention unapproved. No default credentials or automatic migrations.
5. Deploy the reviewed source revision to the original web service, keeping its existing domain and `/api/health` readiness path. Keep the original SQLite volume mounted and unchanged for rollback. Use the existing verified administrator account password on the new email/password login; revoke old sessions rather than copying them.
6. Essential smoke checks: health, administrator authentication, exactly the imported history, private exports, worker heartbeat/progress, tenant denial, registration/CSRF/security controls, real PageSpeed, and no production SQLite access. Owner then performs Google consent and functional UI tests. Do not block access on comprehensive Google or multi-account tests; mark them unverified.

**Nothing in this document authorizes executing steps 1–5 before the owner's final approval.**

## Rollback

Before any cutover record the exact candidate commit, new DB checksum/count ledger, current images, private configuration snapshot and fresh SQLite backup. For an application-only rollback, stop the production PostgreSQL worker/admission, preserve new PostgreSQL writes in an encrypted backup, restore original Phase 1 variables from private storage and redeploy the preserved Phase 1 image/revision above with the original volume/`APP_SECRET`. Confirm owner login, original history and health. No down migrations, DROP, SQLite overwrite, or staging deletion.

Once the unified app accepts new writes, the old SQLite image cannot show those PostgreSQL-only writes. Preserve/export/reconcile them before deciding on data recovery; rollback is not a claimed lossless reverse migration. Do not revive deleted accounts from an old backup: preserve/reconcile the deletion ledger and invalidate recovered sessions. Scheduled destructive retention remains off pending policy approval. Recurring offsite backups and alert delivery are operational follow-up, not silently installed.

## Owner test checklist and honest verification status

Automated tests, build and hosted beta smoke evidence are recorded in `evidence/unified/` as they finish. Local/synthetic tests do not prove live Google consent. Browser UI testing by the owner is **unverified** until performed.

- Sign in with the existing verified administrator account; inspect account, administrator and operations pages.
- After cutover, confirm the 4 historical websites, 4 audits and existing report links. Add a website, run an audit, watch progress, inspect findings and SEO Progress, compare scans, download PDF/CSV/JSON/Markdown and copy Fix with AI instructions.
- Run mobile/desktop PageSpeed and inspect real score/metric/unavailable labels. Missing field Core Web Vitals are allowed when Google has no field data.
- Connect Google using the existing client; select your authorized property, refresh analytics/indexing, inspect clicks/impressions/CTR/position/queries/pages, report/Fix evidence, then disconnect/reconnect. Do not interpret a redirect alone as provider success.
- Download account JSON using the current account password. Use only a clearly disposable account for permanent deletion; never delete the administrator or existing internal A/B records.
- Verify any desired profile/password/device changes yourself. No external invitations or public signup. Report issues with route, action and observed result, without secrets.
