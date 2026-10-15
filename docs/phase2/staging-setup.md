# Railway beta setup (customer beta, Stage 4A)

**Status (15 October 2026, Africa/Johannesburg):** the approved controlled internal G4 run passed **229 hosted and 25 browser checks**. Invitations remain enabled **only on beta web**, with invite-only registration and the exact email allowlist unchanged. Current beta web `b83ab02c…` and worker `f7e8de3c…` use preserved source revision `d31e130`; both are healthy. Results, restored test settings and unverified scenarios are recorded in [the internal test report](hosted-g4-test-report.md). Operator verification is recorded in [the ledger](README.md#operator-bootstrap-and-verification-15-october-2026-local-time). The full-access email key was replaced and revoked. Phase 1 remains unchanged. **No external beta is approved.**

## Layout: one Railway environment, by decision

The project has a single environment, `production`, and the owner wants to keep it that way, so the beta runs **beside** Phase 1 instead of in a separate staging environment. Isolation therefore comes from separate services, separate secrets and a separate database, not from an environment boundary.

| Service | ID | Role | Source | Domain | Volume |
| --- | --- | --- | --- | --- | --- |
| `seo-health-monitor` | `899895fa-f368-42d9-aba6-e1a6ccb9a5ab` | **Phase 1, live. Never modified by beta work.** | GitHub `Comfie/seo-health-monitor` | `seo-health-monitor-production.up.railway.app` | `seo-health-monitor-volume` at `/data` |
| `Postgres` | `4b213dae-47d8-49a5-b67e-a07fdd2bf9ce` | Beta database (`railway`), migrations `0000`–`0002` | Railway template `postgres-ssl:18` | TCP proxy `iriguchi.proxy.rlwy.net` (workstation maintenance only) | `postgres-volume` |
| `seo-beta-web` | `a704af9c-54e8-43cd-a180-56709d270e66` | Beta web | **None.** Deployed only by `railway up`. | `seo-beta-web-production.up.railway.app` | `seo-beta-web-volume` at `/data` (new, empty) |
| `seo-beta-worker` | `c84c9305-d840-498c-b43f-fbdcfc1378e7` | Beta audit worker | **None** | None | None |

Project `6682ee67-83a0-4251-a282-cabcccb26091`, environment `production` (`437c36cc-333e-41ea-b7f5-42351b88582a`).

**Rules that replace the environment boundary:**

1. Every CLI and API action names a beta service explicitly (`--service seo-beta-web` / `seo-beta-worker`, or the beta service ID). `railway volume add` has no `--service` flag and acts on the *linked* service: run `railway status` first.
2. Never use environment-wide **shared variables**. They would also reach Phase 1.
3. Never run `railway config apply` (it manages the whole project) or `railway up` without `--service`.
4. In the dashboard, if a "staged changes / Deploy" banner appears, check that it lists only beta services before confirming.
5. The beta services have no repository source, so a push to any branch cannot deploy them, and beta work cannot redeploy Phase 1.
6. After each beta change, confirm that Phase 1's active deployment ID is unchanged (baseline `b921c2dc-3e09-4386-8605-209ece6febb1`) and that `/api/health` returns 200.

Accepted trade-offs of one environment: one shared private network (the beta can reach `seo-health-monitor.railway.internal`, though nothing in the beta calls it); one shared set of project members and notifications; usage billed together. The Postgres credential that leaked in chat is now in use; rotating it later (§2) needs only a redeploy of the two beta services.

## 0. Approval gates

| Gate | Status |
| --- | --- |
| G1 Rotate the beta database password (§2) | **Deferred by the owner** ("work as is for now") |
| G2 Create `seo-beta-web` / `seo-beta-worker`, volume, domain, settings and variables | **Done 14 October 2026** (approved) |
| G3 Deploy both services with `railway up` | **Done 14 October 2026** |
| Operator bootstrap, hosted operator checks and Resend key replacement | **Approved and completed 15 October 2026 local time**; evidence in the ledger. Does not approve G4. |
| G4 `PHASE2_INVITATIONS_ENABLED=true` for synthetic, allowlisted testers | **Approved 15 October 2026 for the two previously approved Gmail plus-addresses only.** Execution and results: [controlled internal report](hosted-g4-test-report.md). No external beta approval. |
| G5 Production SQLite backup ([migration guide](migration-and-rollback.md#production-backup-approval-required)) | Not yet approved |

No gate authorises inviting external users, public registration, Phase 1 changes or monetisation.

## 1. What is prepared in the repository

| File | Purpose |
| --- | --- |
| `Dockerfile` | Existing web image (Next.js standalone). Unchanged. Used by `seo-beta-web`. |
| `Dockerfile.worker` | Worker image: runtime-only `npm ci --omit=dev`, then `scripts/beta-worker.ts` bundled with esbuild into `dist/beta-worker.mjs`. Runs `node --conditions=react-server dist/beta-worker.mjs` as PID 1 and a non-root user. No port, no volume. |
| `.railwayignore` | Keeps `data/`, `.env*`, backups, test artefacts and the local `.next`/`node_modules` out of `railway up` uploads. |
| `GET /api/beta/health` | Readiness: 200 `{ok:true}` only when the beta is configured **and** PostgreSQL answers `select 1`; 503 `{ok:false}` with no detail otherwise; 404 when the beta is off. |
| `npm run db:saas:staging -- check` | Read-only connectivity and schema check: version, applied migrations, public table count, and row counts for users/tenants/websites/audits/jobs. Prints no URL or row contents. |

**No config-as-code files.** Railway now rejects `railwayConfigFile` ("Config as Code is deprecated; use `.railway/railway.ts`"). The project-wide IaC replacement would also manage Phase 1, so build and deploy settings were applied **per service** through the Railway API (`serviceInstanceUpdate`, keyed by the beta service IDs) and read back:

| Setting | `seo-beta-web` | `seo-beta-worker` |
| --- | --- | --- |
| `dockerfilePath` | `Dockerfile` | `Dockerfile.worker` |
| Health check | `/api/beta/health`, 120 s | None (no HTTP) |
| Restart policy | `ON_FAILURE`, 5 retries | `ALWAYS` |
| Draining | 30 s | 30 s |
| Source | None | None |

**Worker liveness fix (Stage 4A).** The worker's internal timers are `unref()`'d so they never keep a web server alive. Run standalone with PostgreSQL unreachable, the process therefore exited with code **0** after one failed poll, and an on-failure restart policy would have left the queue without a worker. `scripts/beta-worker.ts` now holds a referenced keep-alive interval, which also logs `alive, running=N` every 60 s, and shutdown is bounded to 20 s, inside the 30 s drain. Verified locally.

## 2. Rotate the beta database password (G1, deferred)

1. Railway → `Postgres` → **Database** tab → **Credentials** → **Regenerate password**. This updates the server password and `PGPASSWORD`, `POSTGRES_PASSWORD`, `DATABASE_URL` and `DATABASE_PUBLIC_URL` together. Do **not** edit `POSTGRES_PASSWORD` by hand.
2. Redeploy `seo-beta-web` and `seo-beta-worker` (they reference `${{Postgres.DATABASE_URL}}`). Phase 1 does not use this database.
3. Verify from the workstation without displaying the credential:

   ```sh
   read -rs STAGING_DATABASE_URL && export STAGING_DATABASE_URL   # paste DATABASE_PUBLIC_URL; nothing is echoed
   export PHASE2_DATABASE_PURPOSE=staging
   npm run db:saas:staging -- check --confirm-staging=iriguchi.proxy.rlwy.net/railway
   unset STAGING_DATABASE_URL
   ```

   Expected: `{"connected":true,"postgres":"18.6","migrations":3,"publicTables":22,…}`.

## 3–5. Variables (set 14 October 2026; derived from the source code)

Secrets were generated locally and piped with `railway variable set NAME --stdin`, so no value appeared on a command line, in output or in a transcript. A read-back confirmed each is 64 characters (38 for `AUTH_PASSWORD`), that each differs from the Phase 1 value, and that `PHASE2_AUTH_SECRET` ≠ `APP_SECRET`.

### `seo-beta-web`

| Variable | Value | Read by |
| --- | --- | --- |
| `PHASE2_ENABLED` | `true` | `config.ts`, `instrumentation.ts`, `proxy.ts` |
| `PHASE2_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` → `postgres.railway.internal/railway` (private network) | `config.ts`. Refuses to start if equal to `DATABASE_URL` or `PRODUCTION_DATABASE_URL`. |
| `PHASE2_ORIGIN`, `APP_URL` | `https://seo-beta-web-production.up.railway.app` | Origin check on auth POSTs; email links; Phase 1 origin checks |
| `PHASE2_AUTH_SECRET`, `APP_SECRET` | New random, 64 hex characters | `config.ts`, `security/crypto.ts` |
| `AUTH_PASSWORD` | New random owner password (not Phase 1's). Readable in the dashboard if ever needed. | `security/auth.ts`, `security/railway.ts` |
| `PHASE2_REGISTRATION` | `invite-only` | `config.ts` |
| `PHASE2_INVITATIONS_ENABLED` | `true` on beta web following controlled G4 approval (15 October 2026) | `config.ts` |
| `PHASE2_INVITATION_TTL_HOURS` | `72` | `config.ts` |
| `EMAIL_TRANSPORT` | `resend` | `config.ts` |
| `EMAIL_RECIPIENT_ALLOWLIST` | Exactly three addresses: the owner's Gmail address and its `+beta-a` and `+beta-b` plus-addresses. Never leave it empty: an empty allowlist allows **every** recipient. | `email.ts` |
| `RESEND_API_KEY` | Set through stdin; **sending-only**, restricted to `dominiondesk.com`. Replacement test delivered; previous full-access key revoked. | `config.ts`, `email.ts` |
| `EMAIL_FROM` | `SEO Health Monitor Beta <seo-beta@dominiondesk.com>` (the key's only verified domain; the owner's choice) | `email.ts` |
| `TRUST_PROXY` | `0` | `rate-limit.ts` |
| `PHASE2_LIMIT_PAGES_PER_SCAN` | `5` (bounded tests) | `limits.ts` |
| `PHASE2_GLOBAL_PAGESPEED_PER_DAY` | `40` (bounded tests) | `limits.ts` |
| Not set | `PHASE2_WORKER` (separate worker), `PHASE2_TRUSTED_IP_HEADER` (until measured, §7), `PAGESPEED_API_KEY` (Google's anonymous quota; 429s appear as "not measured"), `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_*`, `DATABASE_URL`, `PRODUCTION_DATABASE_URL`. Other limits use code defaults. | |

`DATABASE_PATH=/data/seo-health.db` comes from the image, inside the beta's own volume, which satisfies `validateRailwayEnvironment`.

### `seo-beta-worker`

The worker runs the same configuration guard, so it needs the same beta and owner-area variables. All of them are **reference variables** to `seo-beta-web` (`${{seo-beta-web.NAME}}`), plus `PHASE2_DATABASE_URL=${{Postgres.DATABASE_URL}}` and `PHASE2_WORKER_CONCURRENCY=1`. `RESEND_API_KEY` and `EMAIL_FROM` already reference the web service and resolve once you set them there.

## 6. Deploy (G3: after the Resend key)

From this working tree (nothing is committed or pushed):

```sh
railway up --service seo-beta-web    --environment production --ci
railway up --service seo-beta-worker --environment production --ci
```

The upload respects `.gitignore` and `.railwayignore`. Record the deployment IDs, plus `git stash create` as the tree identifier.

After deploy:

1. `curl -sS https://seo-beta-web-production.up.railway.app/api/beta/health` returns `{"ok":true}`; `/beta/login` renders.
2. Worker logs: `[beta-worker] worker-… started`, then `alive, running=0` each minute, and no `poll failed`.
3. `db:saas:staging -- check`: still 3 migrations and 22 tables. Deploys never migrate.
4. Phase 1: same active deployment ID; `/api/health` returns 200.

## 7. Bootstrap and hosted authentication checks (Step 4)

1. Operator invitation (offline; prints a one-time link, sends no email):

   ```sh
   ALLOW_TEST_INVITATION=true PHASE2_ORIGIN=https://seo-beta-web-production.up.railway.app \
     npm run db:saas:staging -- prepare-invitation you@<allowlisted domain> --confirm-staging=iriguchi.proxy.rlwy.net/railway
   ```

2. Register from the link, verify through the emailed link, then grant administrator rights offline: `npm run db:saas:staging -- bootstrap you@<allowlisted domain> --confirm-staging=…`.
3. **Stop before G4:** complete and report the approved operator subset first. This subset is now recorded in the ledger; the invitation gate remains off. Only after fresh G4 approval, set `PHASE2_INVITATIONS_ENABLED=true`, redeploy the beta web service, and invite **two synthetic customers** (A and B) on the approved allowlisted addresses from `/beta/admin`. The send-only key replacement and old-key revocation prerequisite is complete.
4. Cookie and transport: `curl -sSI` on a sign-in response shows `__Secure-shm_beta.session_token` with `HttpOnly; Secure; SameSite=Lax`, plus an HSTS header.
5. **Client IP (measure before trusting any header).** Railway's own forum answers about `X-Real-IP` and `X-Forwarded-For` contradict each other, so measure:
   1. Temporarily set `PHASE2_TRUSTED_IP_HEADER=x-real-ip` and redeploy.
   2. Sign in once normally and once with `-H 'X-Real-IP: 203.0.113.9' -H 'X-Forwarded-For: 203.0.113.9'`.
   3. Read the two newest `auth_session.ip_address` values through the operator connection.
   4. If both show your real address, the edge overwrites the header: keep it. If the spoofed value appears, unset the variable and repeat with `x-forwarded-for` (Better Auth uses the first entry).
   5. If neither is trustworthy, leave it unset. Every client then shares one conservative limiter, which is safe but can lock testers out under abuse.
6. Then record each item below with the date and deployment ID:
   - [x] Operator sign-in and sign-out; old session cookie refused by the protected API after sign-out (15 October local time, ledger).
   - [x] Operator session survives a beta web-service restart and the replacement-key redeploy. Sessions live in PostgreSQL (ledger).
   - [ ] Session expiry: set an existing session's `expires_at` in the past through the operator connection; the next request redirects to `/beta/login`.
   - [ ] Cross-origin POST with a valid cookie → 403 (`-H 'Origin: https://evil.example'`).
   - [ ] `POST /api/beta/auth/sign-up/email` → 404; registration with a mismatched email → 403.
   - [ ] Email verification link works once; a reused link fails.
   - [ ] Password reset works once, signs out other sessions, and a reused link fails.
   - [ ] Expired invitation (`PHASE2_INVITATION_TTL_HOURS=1`, wait) and revoked invitation refused; a used invitation cannot register twice.
   - [ ] Sign-in rate limit returns 429 after 5 attempts per minute.
   - [ ] Customer cookie on legacy routes (`/`, `/api/audits`, `/api/sites/1/search-console`, `/api/integrations/…`) → redirect to `/login` or 401.
   - [ ] Customer → `/api/beta/admin/*` → 404; `/beta/admin` shows not-found.

## 8. Customer journey and worker reliability (Steps 6–7)

Keep workloads bounded: 5 pages per scan, at most 3 PageSpeed pages per audit, the daily PageSpeed budget lowered to 40, and only public test domains you are allowed to crawl (e.g. `example.com`).

**Journey (A, B, administrator):** the 15 steps of the Stage 4A brief: invite, accept, verify, sign in, add website, audit through the worker, progress, results, PDF/JSON/CSV/Markdown, Fix with AI, second audit plus compare. B audits the same domain. B's direct API requests for A's website and audit IDs (GET/PATCH/DELETE website, start audit, status, findings, each export, fix, compare, cancel, PageSpeed, AI) must all return byte-identical 404s. The administrator gets not-found or 404 for A's audit pages and APIs.

**Worker reliability:**

| Test | How | Pass condition |
| --- | --- | --- |
| Concurrency limits | Scale the worker to 2 replicas; A and B each start 3 audits | Never more than `PHASE2_GLOBAL_MAX_RUNNING` running; never more than 1 per account |
| Termination | Restart the worker mid-audit | Graceful hand-back: the job requeues without using an attempt, then completes |
| Hard kill and lease expiry | Remove the worker deployment mid-audit (no graceful stop), redeploy | The lease expires; another claim with a higher fence completes it |
| Stale worker | Covered by the 14 October multi-process test (SIGSTOP); repeat with two replicas if feasible | Late writes rejected |
| Retry limit | Audit a host that refuses connections | Retries with backoff, then a sanitised failure after 3 attempts |
| Cancellation | Cancel queued and running audits | Queued: immediate, allowance refunded. Running: stops at the next checkpoint. |
| PageSpeed exhaustion | Set `PHASE2_GLOBAL_PAGESPEED_PER_DAY=1` | Further tests show "not measured", never a score |
| Database interruption | Restart the PostgreSQL service | Worker logs `poll failed` then recovers without a restart; web health is 503 during the outage and 200 after |
| Worker failure isolation | Stop the worker service | Web UI and APIs keep working; audits stay queued; they resume when the worker returns |

## 9. Resend (Step 5)

1. In Resend, add a dedicated **staging subdomain** you control, e.g. `staging-mail.<your domain>`, so the main domain's reputation and DMARC are not affected.
2. Publish the records Resend shows at your DNS host: the DKIM `TXT` (`resend._domainkey…`), and the `MX` plus SPF `TXT` on the `send.` sub-subdomain that Resend uses as the return path. Add `_dmarc.staging-mail.<your domain>` with `v=DMARC1; p=none; rua=mailto:<you>` to start. Wait until Resend shows **Verified**.
3. Create an API key with **Sending access** restricted to that domain. Store it only with `railway variable set RESEND_API_KEY --stdin …`.
4. Keep `EMAIL_RECIPIENT_ALLOWLIST` set for the whole of staging.
5. Delivery tests, allowlisted addresses only: invitation, verification, password reset. Also check that a non-allowlisted invitation sends nothing and that the admin still sees the one-time link. Check invalid, expired, consumed and revoked links.
6. Logs: search the web service logs for `@` and `token=`. Neither may appear. A suppressed message logs only its purpose; a Resend failure reports only the HTTP status. The `log` transport, which prints addresses and links, is refused in production mode.

**Recorded 15 October 2026 local time:** the owner chose the already verified `dominiondesk.com` sender for this restricted beta. The send-only key is scoped to that domain, the operator verification and replacement transport-check emails were delivered, and the old full-access key is revoked. The exact three-address allowlist remains in place and G4 is off. Tester invitation, password reset and link expiry/reuse tests remain **unverified**; the above dedicated-subdomain steps are guidance for a future mail-domain setup, not a prerequisite the owner selected for this operator run.

## 10. Teardown and rollback

The beta services are disposable: removing or stopping `seo-beta-web` and `seo-beta-worker` does not affect the Phase 1 service, which shares no volume, variable, source or database with them. Do **not** delete or re-migrate the staging PostgreSQL; export evidence first if you ever retire it. To roll back a bad staging deploy, use Railway's deployment rollback on the service. Migrations are additive and are never run by a deploy, so an application rollback needs no database change.
