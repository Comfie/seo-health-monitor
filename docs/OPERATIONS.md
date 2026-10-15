# Operations

How to deploy, configure, back up and look after the live system. For what is live right now, see [STATUS.md](STATUS.md).

## Services

| Railway service | Role | Source | Notes |
| --- | --- | --- | --- |
| `seo-health-monitor` | Web app and API | GitHub `main`, `Dockerfile` | Health check `/api/health`. Auto-deploys on push. |
| `seo-worker` | Background audits, PageSpeed, Search Console refreshes | GitHub `main`, `Dockerfile.worker` | 1 replica, 1 job at a time. Auto-deploys on push; no health check (it serves no HTTP). |
| `Postgres` | All data | Railway PostgreSQL 18 | Database `railway`, volume `postgres-volume` (5 GB) |

All services are in one Railway project (`seo-health-monitor`), in the `production` environment, in EU West (`europe-west4`). They talk over Railway's private network (`postgres.railway.internal`).

## Deploying

**Web app:** merge or push to `main`. Railway builds and only switches traffic once `/api/health` returns 200. A failed build or health check leaves the previous version live.

> Railway also rebuilds the web service whenever one of its **variables or volumes changes**, using whatever `main` currently holds. Keep `main` deployable.

**Worker:** deploys from the same push. Its build settings must keep the Dockerfile path `Dockerfile.worker`; with the default `Dockerfile`, it would build the web app instead. On deploy, the old worker hands running jobs back to the queue, and the new one picks them up.

**Before every deploy:**

```sh
npm test && npm run typecheck && npm run lint
```

## Configuration

Variables are set per service in Railway. Both services need the shared database, auth and Google variables. Secrets never go in Git; `.env.example` lists every variable with comments.

| Variable | Purpose |
| --- | --- |
| `PHASE2_ENABLED=true`, `PHASE2_UNIFIED=true` | Run the multi-user app. Retires the old single-owner code paths. |
| `PHASE2_DATABASE_URL` | PostgreSQL over the private network, using the restricted `seo_app` login |
| `PHASE2_ORIGIN`, `APP_URL` | `https://seo-health-monitor-production.up.railway.app` (canonical origin, used for CSRF checks and email links) |
| `PHASE2_AUTH_SECRET` | Session signing. 32+ random characters, different from `APP_SECRET`. |
| `APP_SECRET`, `AUTH_PASSWORD` | Kept from the old app. Required by startup checks; not used for sign-in. |
| `PHASE2_REGISTRATION=invite-only`, `PHASE2_INVITATIONS_ENABLED=true`, `PHASE2_INVITATION_TTL_HOURS=72` | Invitation-only accounts |
| `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | Account email. An `EMAIL_RECIPIENT_ALLOWLIST` would restrict recipients; it is unset in production. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PHASE2_GOOGLE_REUSE_LEGACY_CLIENT=true`, `PHASE2_GOOGLE_TOKEN_SECRET` | Search Console OAuth with the existing client; tokens encrypted with the token secret |
| `PAGESPEED_API_KEY` | PageSpeed Insights (sent as a header) |
| `PHASE2_PAGESPEED_PAGES_PER_AUDIT=3` | Pages tested per audit (each tested on mobile and desktop) |
| `PHASE2_LIMIT_*`, `PHASE2_GLOBAL_*` | Optional limit overrides. Defaults are in `src/lib/saas/limits.ts` and summarised in [STATUS.md](STATUS.md#limits-per-tester-account-code-defaults). |
| `PHASE2_WORKER_CONCURRENCY` (worker) | Jobs per worker process (1) |
| `PHASE2_PRIVACY_CONTACT_EMAIL` | Contact shown on the privacy, terms and data-use pages (`comfynyatsine@gmail.com`) |
| `PHASE2_GLOBAL_AI_USD_PER_DAY` | Shared daily AI spend cap in US dollars (default `1`, unset in production). Prices per model live in `src/lib/ai/pricing.ts`; update them if Anthropic changes its prices. |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | AI consultant, on the web service only. `AI_MODEL=claude-sonnet-5-5` (about $0.05 per report); set `claude-opus-5-5` for higher quality at roughly twice the cost. Changing either redeploys the service. |

Startup refuses unsafe combinations, for example open registration, a non-HTTPS origin, reused secrets, or `AUTH_DISABLED`.

## Database

**Logins:**

- `seo_app` (the app): SELECT, INSERT, UPDATE and DELETE on application tables, sequence use, and read-only access to `drizzle` migration metadata. It can't create, alter or drop tables, and can't connect to other databases. Default privileges give it the same rights on tables created later by `postgres`. Its URL is kept privately in `~/secure/seo-app-database-url.txt`.
- `postgres` (operator only): owns the schema and runs migrations and backups. Use it through `railway ssh --service Postgres` or Railway's database tooling, never from the app.

**Schema changes:**

1. Add a migration under `drizzle-saas/`, using `npm run db:saas:generate`.
2. Take a backup (below).
3. Apply the migration with the operator login before deploying code that needs it:
   ```sh
   STAGING_DATABASE_URL=<postgres public URL> PHASE2_DATABASE_PURPOSE=staging npm run db:saas:staging migrate -- --confirm-staging=<host>/<database>
   ```
   The `staging` label and `--confirm-staging` (the URL's hostname and path, e.g. `example.proxy.rlwy.net/railway`) are guards in the script, not a separate database. Run `check` the same way before and after to compare the migration count. Migrations never run automatically on startup.
4. Deploy the web app and worker.

Prefer additive migrations: new tables and nullable columns.

**Ad-hoc inspection:**

```sh
echo "select count(*) from auth_user;" | railway ssh --service Postgres -- psql -U postgres -d railway -At
```

## Backups and restore

There are no automatic backups yet. Until there are:

- **Before every migration, and at least weekly,** take a plain dump to the private backup folder:
  ```sh
  f=~/secure/backups/pg-railway-$(date -u +%Y%m%dT%H%M%SZ).sql
  railway ssh --service Postgres -- pg_dump -U postgres -d railway --no-owner > "$f" && chmod 600 "$f"
  ```
- **Restore (disaster only):**
  1. Stop the worker: scale `seo-worker` to 0.
  2. Restore into an empty database: `psql -U postgres -d <db> < dump.sql` inside the Postgres service.
  3. Re-grant `seo_app` its privileges.
  4. Check the counts.
  5. Repoint and restart the web app and worker.

  Everyone has to sign in again. Re-apply any account deletions made after the dump was taken.
- **Encrypted backups:** the app has an encrypted logical backup and restore tool with fingerprint checks (`scripts/beta-maintenance.ts`). Its guards currently expect a separate staging target. Review them before using it on the live database.

## Monitoring

- **Admin → Operations** (`/beta/admin/operations`) shows:
  - worker and web heartbeats;
  - queue depth, the oldest queued job, running and failed jobs, stale leases and retries;
  - provider failures;
  - PageSpeed and AI usage against their caps.
- **Workers** log `alive, running=N` every minute:
  ```sh
  railway logs --service seo-worker
  ```
- **Recommended alerts:**

| Signal | Threshold |
| --- | --- |
| `/api/health` | Not 200 for 2 minutes (external uptime monitor) |
| Worker heartbeat | Missing for 90 seconds |
| Oldest queued audit | Over 10 minutes old |
| Final audit failures | 3 or more in 24 hours |
| PageSpeed tests or AI spend | 80% of the daily cap |

## Common tasks

| Task | How |
| --- | --- |
| Invite a tester | Admin → Invitations → enter their email. The link is valid for 72 hours and single-use. |
| Raise or lower one account's limits | Admin → account → limit overrides (clamped to hard bounds) |
| Suspend an account | Admin → account → Suspend. This revokes their sessions immediately. Reactivate the same way. |
| Restart the worker | `railway service restart --service seo-worker`. Running jobs are handed back, or recovered by lease expiry. |
| Scale workers | Increase replicas on `seo-worker`. The database enforces the global limit (`PHASE2_GLOBAL_MAX_RUNNING`, default 2). |
| Rotate the database password | Change the `seo_app` password in Postgres, update `PHASE2_DATABASE_URL` on both services, then redeploy. |
| Turn off invitations | Set `PHASE2_INVITATIONS_ENABLED=false` (the web service redeploys) |

## Incidents

1. **Confirm and contain:** close invitations, suspend an affected account, or stop the worker, as needed.
2. **Preserve evidence:** keep logs and events private. Never paste tokens, connection strings or exports into issues or chat.
3. **Rotate:** rotate any exposed secret and revoke sessions.
4. **Fix and verify:** fix, then check isolation between accounts.
5. **Personal information:** if personal information was compromised, follow the [Information Regulator's POPIA process](https://inforegulator.org.za/popia/) (see [SECURITY-AND-PRIVACY.md](SECURITY-AND-PRIVACY.md)).
