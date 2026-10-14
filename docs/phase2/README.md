# Phase 2 implementation ledger

Updated 15 October 2026 (Africa/Johannesburg). Stages 1 (foundation), 2 (customer onboarding and website management) and 3 (multi-tenant audit engine) are implemented on `phase2-multiuser`. Stage 4A has an approved Railway beta deployment and a verified administrator operator account; the customer A/B journey remains pending G4. This is **not a completed SaaS**. No monetisation is included. Phase 1's service and data remain unchanged; nothing was pushed or committed; no external tester was invited; unrestricted public registration does not exist.

## Stage 4A: Railway staging preparation (in progress)

**Current internal test run (15 October 2026):** G4 is now approved for the two synthetic plus-address accounts only. Source baseline `0d181a3` and beta fixes `d31e130` are committed on `phase2-multiuser`, with no push or production merge. G4 is enabled only on the beta service; the original operator-only status below is historical. Current evidence and limitations: [controlled internal test report](hosted-g4-test-report.md).

Started 14 October 2026 on `phase2-multiuser`, with operator verification completed 15 October 2026 local time. Code is still uncommitted; nothing was pushed. The only invitation is the approved offline operator bootstrap; no tester invitation was issued.

**Railway (approved by the owner, 14 October 2026):** the project keeps its single `production` environment by the owner's decision, so the beta runs beside Phase 1 as two new services, `seo-beta-web` (`a704af9c…`, domain `seo-beta-web-production.up.railway.app`, new volume at `/data`) and `seo-beta-worker` (`c84c9305…`). Neither has a repository source, so neither can auto-deploy. Settings were applied per service through the API, variables were set with secrets piped via stdin, and the database is reached over the private network. Both are **deployed** (see below).

#### Deployment record (14 October 2026, approved gate G3)

| Item | Value |
| --- | --- |
| Code | Uncommitted working tree on `b3a8670`; `git stash create` tree `0c9b9ba1fe174e1d89dded9250d8f28c82ce7433`. Uploaded with `railway up`; nothing pushed. |
| `seo-beta-web` | Deployment `33d83c2c-82da-4ada-bd7c-d6ec05ced411`, image `sha256:1efa4954…`. Online. |
| `seo-beta-worker` | Deployment `ea7fbcd6-5db8-4fc8-9232-fbb29a76a3ff`. The **real Linux build of `Dockerfile.worker` succeeded** (bundle 215.6 kB). Online; logs `started`, then `alive, running=0`, with no `poll failed`. |
| Email at initial deploy | Initially a full-access Resend key, subsequently **replaced and revoked** (operator record below). `EMAIL_FROM=SEO Health Monitor Beta <seo-beta@dominiondesk.com>`, chosen by the owner for allowlisted test mail. Allowlist: exactly the owner's Gmail address and its `+beta-a` and `+beta-b` plus-addresses. The original key had been typed into tracked `.env.example`; it was never committed. It was moved to git-ignored `.env.local` and set on Railway through stdin. |
| Phase 1 after deploy | Unchanged: active deployment `b921c2dc-3e09-4386-8605-209ece6febb1`, `/api/health` 200 |

The first web build failed: an unanchored `reports` entry in `.railwayignore` also excluded `src/lib/reports` and `src/app/(app)/reports` from the upload. That build was rejected, nothing went live, and Phase 1 was not affected. Every directory pattern is now anchored to the repository root.

**Hosted checks passed (unauthenticated, against `https://seo-beta-web-production.up.railway.app`):** `/api/beta/health` `{"ok":true}` (PostgreSQL reachable over the private network); `/api/health` and `/beta/login` 200. HSTS (`max-age=31536000; includeSubDomains`), CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` on `/beta`. HTTP → 301 to HTTPS. Cross-origin `POST /api/beta/auth/sign-in/email` → 403. Library `sign-up/email` → 404; `get-session` → 404. Unauthenticated `/api/beta/websites` and `/api/beta/admin/invitations` → 401. Legacy `/` → 307 to `/login`; `/api/audits` → 401.

**Still pending on the hosted app:** the customer A/B journey and worker reliability scenarios, plus the wider authentication checklist beyond the operator checks below. The Phase 1 service was not modified: its active deployment is still `b921c2dc-3e09-4386-8605-209ece6febb1`, `/api/health` returns 200, and it has no `PHASE2_*` variables. Isolation rules and IDs: [staging-setup.md](staging-setup.md). Database password rotation remains deferred by the owner.

### Operator bootstrap and verification (15 October 2026 local time)

Scope approved by the owner: register and verify the administrator, check login, session cookies, persistence and logout, grant the administrator role once, and confirm the invitation page is protected. **G4 remains explicitly unapproved**. The owner also approved replacing the full-access Resend key before any tester invitation.

The operator link was delivered only through the private local environment (`~/secure/seo-beta-operator-invitation.txt`, mode `0600`). The owner completed registration and the emailed verification link. The password and link were not exposed in chat, Git or application logs. Saved session checks use `~/secure/beta-session.sh`; its report contains HTTP statuses and redacted cookie attributes only.

| Check | Hosted evidence |
| --- | --- |
| Registration and verification | PostgreSQL: one user, email verified, one personal tenant, one membership; the single operator invitation is claimed and consumed. Resend reports the verification email sent at `2026-10-14 21:50:55 UTC` as **delivered**. |
| Login | Owner's private helper: `POST /api/beta/auth/sign-in/email` **200**; saved session accesses `/beta` and `/api/beta/websites` with **200**. |
| Session cookie | `__Secure-shm_beta.session_token`; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`. Cookie value and password are never included in the report. |
| Before administrator grant | Saved customer session: admin API **404**; admin page renders the streamed not-found fallback, with no invitation UI or data. Its generic page title is visible. |
| One-time role assignment | The first offline bootstrap succeeded and the repeated command was refused in the prior session. Follow-up: exactly **one administrator** and **one `administrator.bootstrap` activity event**. `bootstrapAdministrator()` serializes grants with an advisory transaction lock and refuses an existing administrator with `Initial administrator has already been provisioned.` |
| After administrator grant | Same saved session: admin API **200**, admin page **200** with administrator content, and the one invitation is listed with `invitationsEnabled:false`. API responses have `Cache-Control: no-store`. |
| Page/API protection | Anonymous admin API **401**; anonymous admin page **307** to `/beta/login`. Authenticated cross-origin invitation POST **403**. Same-origin invitation POST **403** while G4 is off, before parsing input or creating an invitation. Customer cookie on legacy `/api/audits` remains **401**. |
| Session persistence | Beta web restarted without rebuilding deployment `33d83c2c…`; the saved session still reaches the admin API with **200**. It also survives the replacement-key redeploy (`6922066f…`) with **200**, without another login. Sessions remain in PostgreSQL. |
| Logout and revoked cookie | `POST /api/beta/auth/sign-out` **200**, then replaying the old cookie against `/api/beta/websites` **401**. The old-cookie `/beta` probe returned **200**, so its status alone is not treated as proof of access. Final probes with the cleared jar: `/beta` and `/beta/admin` **307** to `/beta/login`; both protected APIs **401**, with no admin content. Final PostgreSQL count: **zero active or stored sessions**. Sign in again to use the administrator UI. |
| Invitation gate and data | `PHASE2_INVITATIONS_ENABLED=false`, `PHASE2_REGISTRATION=invite-only`; exactly three allowlisted addresses. One user and one invitation, no websites or audit jobs. No A/B tester account exists. |

**Resend replacement completed:** created `seo-beta-sending-2026-10-15` with `sending_access`, restricted to the verified `dominiondesk.com` domain. A single plain transport-check email went to the approved operator address; Resend confirmed **delivered** before installation and revocation. The new key is refused access to key management (**401**). It was installed on `seo-beta-web` through stdin and in git-ignored `.env.local` (mode `0600`); the worker resolves the web-service reference to the same new key. Both beta services were redeployed from their existing images. Resend confirmed deletion of the identified old `seo-health-monitor` full-access key; a subsequent probe returned **400** with an explicit invalid-key response. The other account keys were untouched. No credential value is recorded here.

| Current service | Deployment after key replacement |
| --- | --- |
| `seo-beta-web` | `6922066f-8342-4e02-8b79-f94f286b918d`, online |
| `seo-beta-worker` | `61ac836d-9f8d-42cc-97bd-216e9c4c5bde`, online |
| Phase 1 `seo-health-monitor` | Unchanged `b921c2dc-3e09-4386-8605-209ece6febb1`; health **200**, zero `PHASE2_*` variables |

Final deployment-log check: worker `started` and `alive, running=…` entries are present, with no `poll failed`; the current web and worker logs contain neither the operator address nor `token=`. This is an idle liveness check, not the pending worker reliability scenarios.

Application artifact provenance remains the original uncommitted tree on `b3a86700fab74da2d0a40a5e138d445a4e9fccaa` / stash tree `0c9b9ba1fe174e1d89dded9250d8f28c82ce7433`; the replacement reused the deployed images rather than uploading the working tree. Only the evidence documentation was changed in this continuation. No source commit or push occurred.

**Next gated work:** obtain G4 approval before enabling invitations to the two approved plus-addresses. The hosted A/B isolation/audit journey, worker failure scenarios, session-expiry manipulation, password-reset/reuse checks, verification-link reuse, invitation expiry/revocation, rate-limit and trusted-client-IP checks remain unverified. This record does not close the entire Stage 4A checklist.

### Baseline re-validated

| Check | Result |
| --- | --- |
| `npm test` (before Stage 4A changes) | 203 passed, 15 files (the brief's "202" predates the second Stage 3 pass) |
| `npm test` (after) | **209 passed, 17 files**: +3 `tests/beta-health.test.ts`, +3 `tests/backup-verify.test.ts` |
| `npm run typecheck`, `npm run lint` | Passed, no warnings |
| `npm run build` (disposable `DATABASE_PATH`) | Passed; standalone contains `pg`, no PGlite or tsx |
| PostgreSQL safeguards in `src/lib/saas/db.ts` | Present: `idle_in_transaction_session_timeout=15000`, `lock_timeout=10000`, `statement_timeout=60000`; pool and per-client `error` listeners that log only the error code |
| Local SQLite database | Write-protected during the runs; SHA-256 of `.db`, `-wal`, `-shm` unchanged |

### Prepared

- **Two-service Railway layout** (web + separate worker): a dedicated `Dockerfile.worker`, a `.railwayignore`, and the runbook with approval gates G1–G5 in [staging-setup.md](staging-setup.md). Per-service `railway.json` files were drafted, then dropped: Railway now rejects config-as-code (`railwayConfigFile` is deprecated in favour of project-wide IaC, which would also manage Phase 1), so the settings are applied per service through the API.
- **Worker liveness defect fixed.** Standalone, with PostgreSQL unreachable, `npm run worker:beta` logged one `poll failed` and **exited with code 0**, because all its timers are `unref()`'d. Railway's on-failure restart would have left the queue with no worker after a database blip. The entry point now holds a referenced keep-alive that logs `alive, running=N` every minute, and shutdown is bounded to 20 s, inside a 30 s drain window. The worker service also uses restart policy `ALWAYS`. Verified locally: it survived the outage and exited 0 with `stopped` on SIGTERM.
- **Worker image.** First design: run TypeScript through `tsx` in the image. Moving `tsx` to `dependencies` for a `--omit=dev` install broke `npm ci --omit=dev` deterministically (npm marked the nested `esbuild@0.18.20` as an optional peer but its platform binary as dev-only), so that change was reverted; `package.json` and `package-lock.json` are byte-identical to their state before this pass. Final design: the build stage bundles `scripts/beta-worker.ts` with esbuild (packages external), and the runtime stage has `npm ci --omit=dev` plus `dist/beta-worker.mjs`. Replayed outside Docker: the bundle imports only runtime packages (`pg`, `drizzle-orm`, `undici`, `cheerio`, …, no SQLite or PGlite), and it starts, survives the outage and stops cleanly on a clean production-only install. No local Docker build was available; the **real Linux Railway build subsequently succeeded** in deployment `ea7fbcd6…` (deployment record above).
- **`GET /api/beta/health`**: readiness for the web service's Railway health check. 200 only if the beta is configured and PostgreSQL answers; 503 `{ok:false}` with no detail; 404 when the beta is off. Tests: disabled, ready, and failing database with a credential-bearing error that must not leak.
- **`db:saas:staging -- check`**: a read-only connectivity and schema check for after the password rotation. Prints the version, migration and table counts and five row counts, never the URL. Queries validated against a freshly migrated database (3 migrations, 22 tables, 0 rows), matching staging.
- **`scripts/verify-sqlite-backup.ts`**: read-only backup and restore verifier: SHA-256, integrity, foreign keys, per-table counts, Google-token decryptability under the supplied `APP_SECRET`, and a cross-file comparison. Prints no secrets or row data. On the existing **local** baseline and its restore: integrity `ok`, 0 violations, identical counts across 11 tables, 1/1 tokens decryptable. This is **not** a production backup.
- **Production backup procedure and migration plan**, with application rollback separated from database rollback: [migration-and-rollback.md](migration-and-rollback.md#production-backup-approval-required).

### Dependency audit (Step 9, re-checked)

`npm audit`: still **13 findings (9 high, 4 moderate)**, the same packages as before.

- Plain `npm audit fix` changes nothing relevant: it only adds optional platform binaries.
- The available patch releases (`shadcn@4.21.5`, `eslint-config-next@16.4.1`) were tried in a scratch lockfile and still left 13 findings, so they were not applied. The remaining fixes are major downgrades (`drizzle-kit@0.18`, `shadcn@1`, `eslint-config-next@14`) that would break the toolchain. Not applied.
- **Web image:** none of the flagged packages is in `.next/standalone/node_modules` (re-verified).
- **Worker image:** `npm ci --omit=dev` excludes all 9 **high** findings (shadcn, eslint-config-next, braces, micromatch, fast-glob, ts-morph). `drizzle-kit` and its `@esbuild-kit`/old `esbuild` chain (the 4 **moderate** findings) are still installed, because npm treats `drizzle-kit` as an optional peer of a runtime package; `--omit=peer` does not remove it. The worker never imports or runs them, and the advisory concerns esbuild's development server. **Accepted residual risk** pending upstream fixes; your sign-off is still needed (beta checklist).

### Not yet done in Stage 4A

- **Steps 4–7 (remaining hosted authentication, customer journey, worker reliability):** the operator authentication subset above passed; the wider checklist remains pending, and no customer A/B testing starts before G4 approval.
- **Step 5 (remaining email flows):** operator verification and the send-only replacement transport test were delivered. Tester invitation and password-reset delivery/reuse checks remain unverified. Setup and follow-up steps are in [staging-setup.md §9](staging-setup.md#9-resend-step-5).
- **Step 8 (monitoring):** not yet implemented. Planned: an operator-only queue metrics endpoint and command (queue depth, oldest queued age, stale leases, 24 h failure rate, PageSpeed failures, daily budget use), structured worker counters, and alert rules for a stalled queue and repeated worker failures. Railway's built-in CPU and memory metrics, plus usage alerts, cover resources.
- **G5 (production backup):** procedure ready, not executed.

### Stage 4B (after 4A closes)

Tenant-specific Google Search Console (OAuth state per tenant, grants, token cache, property checks, disconnect, two-account test); administration (quota overrides, suspension, queue and failed-job views, privileged action log); privacy (account export and deletion, retention jobs, reviewed privacy policy, terms and crawling notice, POPIA evaluation).

---

## Stage 3 summary (multi-tenant SEO audit engine)

Recorded 14 October 2026 on `phase2-multiuser`. Still behind `PHASE2_ENABLED` (off in production). Nothing was committed, pushed, deployed or sent to external users. Production, its Railway services and data were not touched.

### Re-verification and hardening (second pass, 14 October 2026)

The Stage 3 brief was re-issued against a description of the Stage 2 state (166 tests). The working tree already contained Stage 3, so it was re-verified against every step of the brief rather than rebuilt. Branch `phase2-multiuser`, all work still uncommitted; nothing pushed, deployed or sent.

Changes in this pass:

- **AI allowance refunded on provider failure.** `reserveUsage` now returns its ledger ID, and `releaseUsage` removes it when the consultant call throws (outage, rate limit, refusal, empty response), so a provider failure no longer uses up an account's monthly or the beta's daily AI budget. Repeated failures stay bounded by the per-account route throttle (5 per hour). New test: `returns the AI allowance when the provider fails to produce a report`.
- **AI consultant prompt-injection rule.** The consultant (shared by Phase 1 and the beta) now tells the model that titles, headings, evidence, URLs, local signals and crawl notes are text copied from the audited site and must be treated as data, never as instructions. Fix with AI already fenced this text. The rendered report still goes through `react-markdown` with raw HTML disabled.
- Reviewed and **left as designed:** a job that hits the 20-minute deadline is retried (bounded by `max_attempts`); this has an explicit test.

| Check (second pass) | Result |
| --- | --- |
| `npm test` | **203 passed, 15 files** (202 + 1 new) |
| `npm run typecheck`, `npm run lint` | Passed, no warnings |
| `npm run build` (Turbopack, disposable `DATABASE_PATH`) | Passed |
| `npm run test:railway` (Phase 1 standalone smoke) | Passed |
| Local SQLite database | Write-protected; SHA-256 of `seo-health.db`, `-wal` and `-shm` unchanged |
| Browser walkthrough (fresh isolated copy, empty PGlite, in-process worker, log email, real crawls of example.com and real PageSpeed calls, 5-page cap) | Three users registered through the invitation UI and verified through the logged links; administrator granted offline. **40/40 checks.** One check failed in the scripted run because it read the history page before streaming finished; a settled re-check showed Bob's history page and API list only his audit. Alice: website added (metadata IP refused), two audits completed, results/findings/Fix with AI, PDF/CSV/JSON/Markdown downloads (200, `private, no-store`, filenames from her own host and audit ID), comparison, history, cancellation. Bob: same domain audited independently; 4 page probes and 9 audit API probes against Alice's audit, plus GET/PATCH/DELETE on her website and an audit start on it, all denied (404) with no Alice data. Legacy API 401; owner area redirects to `/login`. Administrator: invitation admin works; Alice's audit page not-found and export 404. Customer → admin API 404. |
| `npm audit` | Unchanged: 13 (9 high, 4 moderate), all development/build tooling, none present in `.next/standalone/node_modules`; classification below still holds |

Railway: no Railway CLI or project access in this workspace, so the hosted web/worker deployment remains **unverified** (steps in [staging-setup.md](staging-setup.md)). The staging database credential pasted in an earlier session should still be rotated.

### Completed functionality

- **Tenant audit runner on PostgreSQL** (`src/lib/saas/audit-runner.ts`). It reuses the existing crawler, checks, scoring, PageSpeed client and report generators. The storage-independent steps moved to `src/lib/audit/pipeline.ts`, which the Phase 1 SQLite runner now also uses, so both engines produce identical checks, scores and metadata. Results (pages, checks, findings, PageSpeed rows, scores, metadata) are written in one transaction, together with the job's completion.
- **Distributed job queue** on `background_jobs` (`src/lib/saas/jobs.ts`, `worker.ts`):
  - Atomic claims are serialised by a PostgreSQL advisory lock.
  - The global running limit and each account's concurrency limit are enforced at claim time.
  - Leases have expiry and heartbeats. Every claim increments a **fencing token** and issues a new lease token. Every worker write (progress, results, failure, cancellation) must present both while the job is still running, so an expired or superseded worker can't overwrite anything.
  - Retries are bounded (3 attempts) with exponential backoff (30 s doubling, capped at 15 min). Expired leases are recovered, and a graceful shutdown hands jobs back without using an attempt.
  - Each job has a hard 20-minute deadline. Suspended accounts are skipped at claim time and refused at completion.
  - The worker's tenant identity is copied from the job row at claim time. No request data reaches a worker.
- **Cancellation.** A queued audit is cancelled immediately, and its monthly allowance is returned if it never started. A running audit stops at the next checkpoint; the crawler now accepts an `AbortSignal` that it checks between requests. If the worker has died, recovery cancels the audit instead of retrying it.
- **Quotas** (`src/lib/saas/limits.ts`): websites, audits per month, pages per scan, simultaneous scans, PageSpeed tests per month and AI reports per month per account, plus global running, queued, daily PageSpeed and daily AI limits.
  - Values come from server-side `PHASE2_LIMIT_*` and `PHASE2_GLOBAL_*` settings (see `.env.example`). A non-NULL tenant column is an administrator override, clamped to hard bounds.
  - Accounting is atomic. A tenant row lock is taken for per-account counts and an advisory lock for global budgets, and the ledger insert happens in the same transaction.
  - The page limit is snapshotted into the job at admission.
- **PageSpeed.** Each test is charged to the budget just before it is sent. A test that is not funded, times out, hits Google's 429 or fails is stored as `unavailable` with its reason, never as a measurement. Once Google reports the quota exhausted, the remaining tests are skipped instead of sent. Customer re-tests run as fenced `pagespeed` jobs and recompute only the performance category.
- **Customer API** (`/api/beta/audits…`): start, history (optionally per website), status/progress, findings, cancel, compare, exports (PDF/CSV/JSON/Markdown/tasks), Fix with AI, PageSpeed re-test and AI consultant.
  - Every route derives the tenant from the session through `withCustomer()`. Only a website or audit ID is read from the request, and IDs must be strict positive integers.
  - Another account's ID gets a response byte-identical to a missing ID's.
  - Downloads are rendered on demand and sent `private, no-store`. Filenames use only the owner's host and audit ID. No report is cached or reachable through a shareable URL.
  - Internal tenant, row, lease and worker identifiers are never returned. Report generators receive rows with `tenant_id` removed.
- **Customer UI** in the existing design:
  - Run audit and History on websites and the dashboard.
  - A progress view with cancel.
  - Results: score dial, category scores, statistics, "Fix these first", reports, PageSpeed with re-test, AI consultant and audit limits.
  - Per-category findings with affected URLs and PageSpeed tables, Fix with AI, history with a compare picker, and comparison.
  - Empty states and errors (failed/cancelled audits, quotas, busy queue) are shown to the user.
  - The owner area's comparison body became the shared `ComparisonView` component.
- **Worker hosting.** In-process (`PHASE2_WORKER=in-process`, via `instrumentation.ts`) or as separate processes (`npm run worker:beta`). Neither starts unless explicitly configured.
- **Migration** `drizzle-saas/0002_stage3_audit_jobs.sql`. It is additive: new job, usage and limit columns, and checks. It replaces the per-audit unique job index with a partial "one active job per kind per audit" index, and makes the four existing tenant limit columns nullable. No rows are deleted or rewritten. Existing tenants keep their explicit values, which now act as overrides.

### Test results (this workstation, 14 October 2026)

| Check | Result |
| --- | --- |
| `npm test` | **202 passed, 15 files** (re-run after the hosted-test fixes): 166 baseline + 36 new (23 engine/queue/quota tests in `tests/saas-jobs.test.ts`, 13 route-level A/B tests in `tests/beta-audit-routes.test.ts`). One Stage 1 fixture now also completes the job row, because the queue is authoritative for "active"; its assertion is unchanged. |
| `npm run typecheck`, `npm run lint` | Passed, no warnings |
| `npm run build` (Turbopack, disposable `DATABASE_PATH`) | **Passed.** Every `/api/beta` route is request-time (ƒ); standalone output contains `pg` and no PGlite |
| `npm run test:railway` (Phase 1 standalone smoke on the new build) | **Passed** |
| Local SQLite database | Write-protected during every test run; SHA-256 unchanged before and after |
| Browser walkthrough (headless Chrome, isolated copy, disposable PGlite, in-process worker, `AUTH_PASSWORD` set, logged email, **real crawls of example.com and real PageSpeed calls**, 1 page sampled) | Alice added a website (the metadata IP was refused), ran two audits to completion, viewed results, findings, PageSpeed and Fix with AI, downloaded PDF/CSV/JSON/Markdown (200, `private, no-store`), compared the scans and cancelled a third audit. Bob audited the same domain and saw only his history. Bob's 9 API probes against Alice's audit (status, findings, PDF/JSON export, fix, compare, cancel, PageSpeed, history by website) and an audit start on Alice's website → 404; legacy API → 401; owner area → redirect to `/login`. The administrator could open invitation administration but got not-found and 404 for Alice's audit. Customer → admin API 404. The scripted run recorded 31/37 passes. The 6 failures were the script reading pages before streaming finished; re-checked after streaming, all show the generic not-found page with no Alice data (HTTP 200, see risks). |

Engine tests fake the crawler and PageSpeed (no network) and use an injected clock. They cover:

- Two tenants auditing the same domain.
- Six concurrent claims of one job; global and per-account claim limits; suspended accounts.
- Lease expiry with recovery, and the stale worker's progress, heartbeat, completion and failure all rejected.
- A crashed worker whose job finishes on another worker, and the late original unable to overwrite it.
- Backoff retries that end in a sanitised failure; non-retryable crawl errors.
- Queued and running cancellation (with refund); cancellation after worker death; graceful hand-back; the deadline.
- The page-limit snapshot; progress and log capping.
- Monthly quota under 8 parallel starts; the global queue limit.
- The PageSpeed per-test budget, timeouts and 429s stored as unavailable, the cross-account daily budget under parallel reservation, re-test jobs, the AI budget with reuse, and the settings/override precedence.

### Hosted PostgreSQL verification (Railway, 14 October 2026)

The operator created a Railway PostgreSQL service (PostgreSQL 18.6, reached through its public TCP proxy from this workstation). No application was deployed; only the database was used.

- **Staging database `railway`:** migrations `0000`–`0002` applied with the guarded staging command (`--confirm-staging=iriguchi.proxy.rlwy.net/railway`). There are 22 tables and 3 recorded migrations, and the partial `job_active_idx` exists. It contains **no data rows**.
- **Contention tests** ran in a separate throwaway database on the same server (`seo_stage3_contention`), which was **dropped afterwards**. The harness ran each worker as a **separate OS process** with a fake crawler and PageSpeed client (no third-party traffic). Final run: **11/11 passed**.

| Scenario | Result |
| --- | --- |
| A. 12 audits, 4 worker processes × concurrency 2, global running limit 3 | Each audit completed exactly once (12 completions, 12 distinct jobs); every job attempts = fence = 1; work spread across all 4 processes; observed peak running = 3; 12 audits with one stored page each |
| B. One worker `kill -9`ed mid-audit, another frozen with SIGSTOP mid-audit, a third started | The third process recovered and completed both jobs (fence 2). The frozen worker, once resumed, had its completion rejected as stale. Stored results are the rescuer's. The frozen process survived the server ending its session. |
| C. Monthly audit quota of 5, two processes × 10 parallel starts | Exactly 5 admitted; usage ledger = 5 |
| D. Global daily PageSpeed budget of 7, two processes × 10 parallel reservations | Exactly 7 reserved |

Two defects were found by these tests (they could not appear on PGlite) and fixed in `src/lib/saas/db.ts`:

1. **A frozen worker stalled the whole queue.** A process paused mid-transaction kept the global advisory lock indefinitely, so no worker could claim and no customer could start an audit. Fencing kept the data correct, but liveness was lost. Every pool connection now sets `idle_in_transaction_session_timeout=15s`, `lock_timeout=10s` and `statement_timeout=60s`, so PostgreSQL ends a frozen holder's session and waiters retry.
2. **A server-ended session crashed the process.** `node-postgres` raises an unhandled `error` event on a checked-out client whose session the server terminates. In-process, this would have crashed the web server. Every client now has an error listener that logs only the error code.

During the re-run, a pre-existing Phase 1 test (`search-console.test.ts`, tamper check) failed once. The test was flaky: in about 1 of 64 runs its "tampered" ciphertext equalled the original. The test now changes the character it inspects; its assertions are unchanged.

**Still not verified:** the application deployed on Railway (web and worker services, TLS, forwarded headers, `__Secure-` cookies), Resend email delivery, and a browser walkthrough against the hosted app. The database credential shared during setup should be **rotated** after staging tests.

### Features available to beta customers (when the beta is enabled)

Sign in; add websites; run, watch and cancel audits; overall and category health scores; technical, on-page, performance, local and conversion findings with affected URLs and recommended fixes; prioritised action plan; audit history; scan comparison; PDF/CSV/JSON/Markdown reports; Fix with AI instructions (Claude Code, Codex, Cursor, Copilot or a developer); PageSpeed re-tests. The AI consultant report works when `ANTHROPIC_API_KEY` is set and within the AI budget; without a key it is refused before any budget is spent.

### Unfinished functionality

- Google Search Console for tenants (OAuth state, grants, token cache, property checks). The index-coverage check therefore always reports "not verified" for beta audits, and the notice says so.
- Audit deletion for customers, account data export/deletion, retention jobs.
- Admin UI for quota overrides, suspension, queue monitoring and failed-job inspection. Overrides are currently set on the tenant row by an operator.
- Redacted job/provider monitoring and alerting. Worker logs contain only job IDs and error class names.

### Known security risks and limitations

- Multi-process claiming, fencing, crash and freeze recovery, and quota races are now verified on hosted PostgreSQL 18 (see above). This was **not** under production-like load, and not with the application itself deployed on Railway.
- Lease expiry uses worker clocks. Fencing keeps results correct under clock skew, but badly skewed clocks could cause an unnecessary duplicate crawl. Run workers with NTP.
- Customer pages for a foreign or missing audit render the not-found UI with HTTP 200 (`notFound()` inside a streamed Suspense boundary, as in Stage 2). No data is included; the APIs return real 404s.
- A cancelled running crawl stops between requests; an in-flight request finishes within its own timeout.
- Concurrent AI "regenerate" requests may each spend one unit; the budget still bounds them. Each PageSpeed test is charged when attempted, whether Google measures it or not.
- Crawled content remains untrusted. Fix with AI keeps fencing it as data (tested with an injected instruction in a page title), and the CSV export keeps formula neutralisation. The crawler's SSRF, DNS-at-connect, redirect, size and robots protections are unchanged; the only crawler change is the cancellation signal.
- No PostgreSQL row-level security; isolation relies on repository filters, composite foreign keys and tests (unchanged from Stage 2).

### Dependency audit (re-reviewed)

`npm audit` reports 13 findings (9 high, 4 moderate). **All are development or build tooling; none ships in the deployed standalone output** (verified: none of the flagged packages is in `.next/standalone/node_modules`).

- *High:* `braces` → `micromatch` → `fast-glob` chains, used by `shadcn` (component CLI), `eslint-config-next` and `ts-morph`. These are CLI and lint tools only.
- *Moderate:* `esbuild` ≤0.24 under `@esbuild-kit/*` → `drizzle-kit`. The advisory concerns esbuild's development *server*, which drizzle-kit does not run. `npm audit --omit=dev` still lists this chain only because `better-auth` declares `drizzle-kit` as an *optional peer*; it is not imported at runtime.
- The offered automatic fixes are major downgrades (`drizzle-kit@0.18`, `shadcn@1`, `eslint-config-next@14`) and were not applied. Accept as dev-only and re-check when upstream releases fixes.

### Database migration status

`0000` → `0002` apply cleanly to empty PGlite in every test run, and were applied to the Railway staging database (`railway`) on 14 October 2026. The staging command applies all pending migrations: `npm run db:saas:staging -- migrate --confirm-staging=<host>/<db>`.

### Infrastructure blockers (unchanged)

A Railway PostgreSQL staging database now exists and was used for migration and contention tests. There is still no Railway CLI or project access for deploying services, and no Resend account. The hosted application, real email delivery and TLS/proxy behaviour remain **unverified**. No production backup exists or is claimed. The procedure, including the Stage 3 worker and limit variables, is in [staging-setup.md](staging-setup.md).

### Next recommended milestone

**Stage 4: hosted verification and operations.**

1. Deploy the web service (and workers) to the Railway staging environment against the already-migrated staging database.
2. Repeat the A/B/admin browser walkthrough against the hosted app, and verify cookies and CSRF through Railway's proxy.
3. Add failed-job and queue monitoring with alerts, plus the admin quota/suspension UI.
4. Then build tenant-aware Search Console and account export/deletion.

---

## Stage 2 summary (customer onboarding and tenant integration)

### Completed functionality

All of it sits behind `PHASE2_ENABLED=true` (off by default; production does not set it). With the flag off, every `/beta` page and `/api/beta` route returns 404.

- **Invitation-only registration** (`/beta/register?token=`, `POST /api/beta/register`). Tokens are 256-bit random, stored only as SHA-256 hashes, bound to one email address, time-limited (`PHASE2_INVITATION_TTL_HOURS`, default 72) and single-use: an atomic claim means two simultaneous attempts produce one account. The library's own sign-up endpoint is unreachable over HTTP. Server-side sign-up is refused by a hook unless a token was claimed for that exact email.
- **Email verification, login, logout, password recovery** through Better Auth over PostgreSQL. Sign-in is refused until the email is verified, and an unverified sign-in resends the link. Resets are single-use and revoke existing sessions. All verification links land on one fixed page.
- **Atomic tenant creation.** Verifying the email creates the personal tenant, the owner membership, the consumed invitation and an `account.created` activity row in one transaction. Replays are idempotent. A revoked invitation produces no tenant. `requireTenant()` retries provisioning and enforces the same rules on every request.
- **Server-derived tenant identity.** Every customer page uses `getCustomerPage()` and every customer API uses `withCustomer()`. Both derive the tenant from the library session and recheck membership/suspension in each repository call. Tenant, site or owner IDs supplied by the browser are ignored.
- **Personal dashboard** (`/beta`): websites with latest completed audit, latest audits, health overview (average score, critical issues), usage against beta limits, recent activity. New users get an onboarding empty state with **Add website**. A beta notice says which features are not yet available. It uses the existing visual design and shell.
- **Website management** (`/beta/websites`, `/api/beta/websites[/id]`): add with the existing URL normalisation and SSRF checks, display names, list, rename, remove (two-step confirm). Duplicate public domains across accounts are separate records. Per-account website limit enforced under a tenant row lock.
- **Account settings** (`/beta/account`): profile name; password change requiring the current password and signing out other sessions; signed-in session list (rendered server-side, no tokens or IPs) with per-session and "all other sessions" sign-out.
- **Invitation administration** (`/beta/admin`): administrators create, reissue and revoke invitations and see status (pending, awaiting verification, accepted, expired, revoked) and expiry. The link is shown once and never stored. Token hashes, creator and consumer IDs are never sent to the browser. `PHASE2_INVITATIONS_ENABLED=false` (the default) disables new invitations. Customers get 404 for the admin page and APIs.
- **Transactional email** through Resend's HTTP API (`src/lib/saas/email.ts`). Text and HTML templates, a 10-second timeout, errors that never contain addresses or tokens, and `EMAIL_RECIPIENT_ALLOWLIST` to keep staging mail to synthetic recipients. A `log` transport exists for local development and is refused in production.
- **Configuration guard** (`src/lib/saas/config.ts`): refuses `AUTH_DISABLED`, a production owner area without `AUTH_PASSWORD`, a database URL equal to `DATABASE_URL`/`PRODUCTION_DATABASE_URL`, a non-HTTPS origin, a reused `APP_SECRET`, and any registration mode other than `closed`/`invite-only`.
- **Schema migration** `drizzle-saas/0001_invitation_tokens.sql`: adds token hash (unique), claim, revocation and creator columns. Additive only.
- **Operator tooling:** `prepare-invitation` now creates a hashed single-use invitation and prints the link once, for bootstrapping the first operator.

Phase 1 is unchanged apart from three shared UI files (`app-shell.tsx`, `nav.ts`, `sign-out-button.tsx`, now parameterised by a beta variant), the proxy (beta paths bypass the owner check only when the beta is enabled), `next.config.ts` (`pg` external; `Referrer-Policy: no-referrer` on `/beta`) and `.env.example`.

### Test results (this workstation, 14 October 2026)

| Check | Result |
| --- | --- |
| `npm test` | **166 passed, 13 files** (119 foundation + 47 new: 33 route-level in `tests/beta-routes.test.ts`, 14 config/email/isolation in `tests/beta-config.test.ts`) |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings |
| `npm run build` (default Turbopack, disposable `DATABASE_PATH`) | **Passed**. All beta and Phase 1 routes generated; standalone output contains `pg` and no PGlite |
| `npm run test:railway` (standalone Phase 1 smoke) | **Passed**: readiness, owner login, unauthorised access, CSRF, SSRF, duplicate jobs, all exports, Fix instructions, SIGTERM/restart, recovery, backup/restore |
| Local browser run (isolated copy, disposable PGlite, `AUTH_PASSWORD` set, logged email) | Passed. Operator: invitation → register → verify → offline admin grant → dashboard → invite → add website (SSRF address refused). Second customer: register → verify → empty dashboard, then direct `fetch` of the operator's website ID (GET/PATCH/DELETE) → 404, admin APIs → 404, admin page → not-found without data. Legacy `/api/audits`, `/api/sites/1/search-console` → 401 and `/` → redirect. Session cookie not readable by JavaScript. Sign-out, forgot/reset password and sign-in with the new password all worked. |

Route-level tests run the real route modules, the real auth library and a PostgreSQL engine (PGlite), with two customers and one administrator. They are listed with their positive and negative cases in [security-and-testing.md](security-and-testing.md#stage-2-route-level-evidence).

**Not verified (hosted):** Railway staging, hosted PostgreSQL, Resend delivery, TLS/`__Secure-` cookies behind Railway's proxy, and the proxy's forwarded headers. These need the steps in [staging-setup.md](staging-setup.md). Treat them as incomplete.

### Security findings (Stage 2)

Found and fixed during this stage:

1. Better Auth's `get-session` and `list-sessions` return raw session tokens to page JavaScript, which defeats `HttpOnly`. Both are removed from the HTTP allowlist; sessions are read server-side and revoked by ID through an owner-checked route.
2. Email-only invitations (Stage 1) would let anyone who knew an invited address register it before its owner. Invitations now require a secret token claimed for that exact email, and the library sign-up endpoint is not exposed over HTTP.
3. Library endpoints outside the beta's needs (social sign-in, email change, account deletion and others) were reachable through the catch-all route. An explicit per-method allowlist now returns 404 for everything else.
4. Verification links resent on sign-in carried no callback and redirected to `/`, the owner area. Every verification link now uses one fixed beta callback.
5. A failed verification redirects with both `verified=1` and `error=`, and the login form showed the success message. Errors now take precedence.
6. The global not-found page linked customers into Phase 1 audit history. A beta not-found page now links to `/beta`.

Residual risks and accepted limitations:

- `notFound()` inside a streamed Suspense boundary returns HTTP 200 with the not-found UI (verified to contain no admin data). The admin APIs return real 404s.
- Without `PHASE2_TRUSTED_IP_HEADER`, all clients share the auth rate limiter. This is safe but could lock out testers during abuse. Verify Railway's header behaviour before enabling it.
- Sensitive account actions use current-password checks; Better Auth's 15-minute freshness window is not separately enforced. Account deletion and data export are not built.
- No PostgreSQL row-level security; isolation relies on repository checks and composite foreign keys (unchanged from Stage 1).
- The 13 development-dependency audit findings from Stage 1 were not re-reviewed in this stage.
- In local `open-dev` mode (no `AUTH_PASSWORD`), Phase 1 routes are open to everyone. Production refuses the beta without `AUTH_PASSWORD`.

### Remaining integration work

See the [legacy route audit](legacy-route-audit.md) for the route-by-route list. All of the following stay disabled for customer sessions:

- Audit execution: PostgreSQL runner, distributed leases with fencing, global admission limits, retries/cancel, progress, PageSpeed reruns, page-limit enforcement. Until these exist, customers can add websites but cannot run audits.
- Audit views, comparisons, progress, reports (PDF/CSV/JSON/Markdown) and Fix with AI over `tenantRepository.exportAudit`.
- Tenant-aware Google OAuth state, grants, token cache, property checks and disconnect.
- Admin: suspension, quota edits, aggregate monitoring, privileged action log UI. Account deletion/export and retention jobs.
- Redacted auth/email event logging and alerting.

### Infrastructure blockers

- No Railway CLI or authenticated Railway access in this workspace, so staging PostgreSQL/app/domain have not been created. Procedure: [staging-setup.md](staging-setup.md).
- No Resend account, verified sending domain or API key has been provided. Email delivery has been tested only against a mocked provider.
- The production-volume backup and its restore test have **not** been taken or verified. No production backup should be claimed.
- No Docker or native PostgreSQL locally, so hosted-engine and multi-process tests remain outstanding.

### Next development milestone

**Stage 3: tenant audit execution.** Build the PostgreSQL audit runner on `background_jobs` (claims, leases with fencing tokens, heartbeats, retries, global and per-tenant admission, snapshotted page limit). Then switch on "Run audit" and the tenant-scoped audit detail, history and report views for beta accounts. Route-level A/B tests must extend to every new audit, export and progress endpoint. Hosted staging (above) should be in place before this stage's verification.

---

# Stage 1 record (foundation)

## Production baseline

GitHub's latest Railway deployment record is deployment **7070693017**, SHA **b3a86700fab74da2d0a40a5e138d445a4e9fccaa**, environment `accurate-smile / production`; its latest status was `success` at `2026-10-14T16:18:00Z`. The corresponding branch is `railway-deployment`. This is evidence from GitHub deployment metadata, not a direct inspection of the running Railway container.

Remote/local `main` instead points to `11b7cb6daa3b9a540f8aa4433be02feb9253609c`. Its tree lacks several deployed Railway persistence, shutdown and backup safeguards. `phase2-multiuser` therefore starts at the recorded production SHA. Do not merge `main` over this branch or deploy `main` as a rollback substitute.

Read-only verification:

```sh
gh api repos/Comfie/seo-health-monitor/deployments
gh api repos/Comfie/seo-health-monitor/deployments/7070693017/statuses
gh api repos/Comfie/seo-health-monitor/git/refs/heads
```

An ignored local Git bundle preserves the complete production history: `data/backups/phase1-production-b3a8670.bundle`. `git bundle verify` passed. Neither development branch nor bundle was pushed.

## Deliverables and status

| Deliverable | This stage | Remaining before beta |
| --- | --- | --- |
| A. Architecture | [Existing system and target design](architecture.md) | Review deployment-specific choices |
| B. Multi-user application | Tested Better Auth factory and tenant repositories; Stage 2: auth/onboarding UI, dashboard, websites, account settings | Audits, reports, Google and worker paths for tenants |
| C. PostgreSQL migration | Generated schema; transactional importer; synthetic and local-backup rehearsals | Fresh production backup, hosted PostgreSQL rehearsal and independently verified cutover |
| D. Security report | [Assessment and test evidence](security-and-testing.md) | Full route/browser and independent security review |
| E. Google integration | Tenant-bound schema and ciphertext migration verified | Tenant-aware OAuth callbacks, refresh/disconnect, cache and live authorised-account tests |
| F. Administration | Separate admin table; one-time offline verified-user grant; Stage 2: protected invitation UI and email delivery | Suspension/quota controls and operational monitoring |
| G. Testing | Existing tests plus real authentication-handler, tenant repository and PostgreSQL-engine tests | Full customer UI/API, multi-process worker and hosted integration tests |
| H. Beta checklist | [Explicit launch gates](beta-checklist.md) | All unchecked gates; approval before external invitations |
| I. Deployment guide | [Staging, migration and rollback](migration-and-rollback.md) | Railway access, hosting and backup evidence |

*Superseded in Stage 2:* the modules are now used by the `/beta` pages and `/api/beta` routes, behind `PHASE2_ENABLED`. Customer sessions still cannot reach the global Phase 1 SQLite repositories (see the [legacy route audit](legacy-route-audit.md)).

## Stage sequence

1. **Foundation (this change):** preserve baseline, local verified backup/restore, schema, mature authentication, server-derived tenant context, tenant-bound reads/writes and importer rehearsals.
2. **Complete vertical customer flow:** connect email delivery, closed/invite-only auth endpoints, registration/verification/recovery screens, account settings, websites and personal dashboard. Replace every legacy route/page repository call; keep the existing appearance. Do not enable customer login against global SQLite data.
3. **Workers and integrations:** port the audit runner's synchronous SQLite writes to PostgreSQL; add distributed claims, leases with fencing tokens, global admission limits, retries, cancellation and provider budgets. Port Google state/token/cache/property access, reports, comparisons and AI.
4. **Administration/privacy:** admin UI, invitations, activity logs, fresh-session deletion/export, retention jobs and reviewed privacy/terms/crawling pages.
5. **Staging verification:** real PostgreSQL and independent customer/admin sessions through browser and direct HTTP; load and security review; tested restore/rollback and monitoring.
6. **Approval gates:** explicit production cutover approval, then explicit approval for 10–20 external beta invitations. Unrestricted registration remains a separate approval and implementation gate.

Railway CLI and authenticated Railway configuration were unavailable in this workspace. A local staging Compose definition and disposable PostgreSQL test environment are prepared; **a hosted Railway staging environment and production-volume backup have not been created or verified**. These are infrastructure access prerequisites, not permission to change production.

## Verification ledger

- Existing deployed-baseline tests: 105 passed.
- Final foundation tests: 119 passed across 11 files; TypeScript and lint passed.
- Local backup restoration: integrity, foreign keys, counts and SHA-256 match.
- Real local-backup import into disposable PostgreSQL: all nine domain tables imported with counts recorded in the migration guide; source unchanged; token decryptability verified without Google requests.
- Default production build: blocked by Turbopack helper port permission, including an approved retry. Supported Webpack production build passed; all existing routes generated.
- Standalone Railway smoke test: passed outside the sandbox. Verified owner login/cookie, denied unauthorised requests, CSRF/SSRF, duplicate-job handling, PDF/CSV/JSON/Markdown exports, Fix instructions, shutdown/restart persistence, interrupted-job recovery and backup/restore.
- Full dependency audit: 13 development-tool findings; review/remediation remains a beta gate.
