# Railway deployment — private single-owner release

Prepared from `origin/main` at `5ea8778`, not either platform migration branch. Nothing has been pushed or deployed. Read [compatibility and test report](railway-compatibility.md) and [future architecture and costs](railway-saas-roadmap.md) before release.

## Architecture and prerequisites

One always-running Node 22 Next.js service, one SQLite database on a persistent volume mounted at `/data`, one in-process durable audit worker, one owner password. No registration or billing features. Use Hobby for this personal beta; use Pro when running the commercial SaaS. Dockerfile reuses standalone output and includes native better-sqlite3, PDFKit and migrations. `node server.js` receives Railway's PORT and binds to `0.0.0.0`.

Docker is unavailable on the preparation machine. Before a first deployment, build and boot the Linux image on a Docker-capable machine using a NEW test volume and test secrets:

```sh
docker build -t seo-health-monitor:railway .
docker volume create seo-railway-test
docker run --name seo-railway-test --env-file /secure/path/test.env -e PORT=8080 -p 127.0.0.1:8080:8080 -v seo-railway-test:/data seo-health-monitor:railway
curl --fail http://127.0.0.1:8080/api/health
```

The private test env file needs `APP_SECRET` (32+ random characters), `AUTH_PASSWORD` (12+), `APP_URL=http://localhost:8080`, and `AUTH_DISABLED=false`. Do not reuse the local database volume. Exercise login, run an audit, restart the container, check history and export PDF; confirm the server user is UID 1001 with `docker exec seo-railway-test id`. Check volume permissions after mounting, not merely inside the image. The entrypoint begins as root to chown only the database directory and existing SQLite sidecars, then `exec gosu app node server.js` drops privileges and forwards signals. Do not set Railway's run UID to 1001 before this initialisation.

## Create the project (after explicit push/deployment approval)

1. Approve pushing the prepared local branch first. The eventual command is `git push -u origin railway-deployment`; it has NOT been run.
2. In Railway, create an **Empty Project**. Select Hobby in your workspace billing settings only when you intend to authorise payment. No live billing account was connected during preparation.
3. Add a service, connect GitHub repository `Comfie/seo-health-monitor`, and in **Settings → Source** select branch `railway-deployment`, root directory `/`. Pause automatic deployments until variables and the volume are configured. GitHub selection can trigger a first build; an unconfigured runtime will fail closed.
4. **Settings → Build**: use the repository `Dockerfile` (Dockerfile path `Dockerfile`). Build command is supplied by the image: `npm ci`, then `npm run build`. Do not override it with Railpack.
5. **Settings → Deploy**: leave Start Command empty to retain the image entrypoint/CMD. Set Healthcheck Path `/api/health`, timeout **300 seconds**, restart **On Failure**, max retries **10**, draining time **30 seconds**, overlap **0**, replicas **1**, one region. Start with replica limits **1 vCPU / 1 GB RAM**, then measure real audits. Disable Serverless/app sleeping and cron scheduling on this service: queued work needs a live process.
6. Add a volume from the service/project canvas (**Add Volume**, attach to the application service); mount at `/data`. Hobby normally defaults to 5 GB capacity; billing is for used storage. Set `DATABASE_PATH=/data/seo-health.db`.
7. Configure variables below. Railway automatically supplies PORT and volume metadata. Never run migrations in a build or pre-deploy command: those stages cannot access the volume. Leave Pre-deploy Command empty.
8. **Settings → Networking → Public Networking → Generate Domain**. Set `APP_URL=https://<generated-host>.up.railway.app`, with no path/query. Deploy staged settings only after approval and after configuring Google redirects.

Railway currently deprecates legacy config-as-code files and says existing files work for legacy services until 2026-12-01. Consequently this branch uses Dockerfile discovery plus explicit dashboard configuration instead of a `railway.json`. See [current config reference](https://docs.railway.com/config-as-code/reference). Record the final settings in your project change log.

## Environment variables

Use Railway's Variables UI and a password manager; do not print, paste into commits, or put secret values into shell command history. Preserve the EXACT existing APP_SECRET if importing OAuth connections; a new secret cannot decrypt old refresh tokens. Store it separately from backups for disaster recovery.

| Variable | Production value / purpose |
| --- | --- |
| `APP_URL` | Required public HTTPS origin; used for OAuth redirects and origin checks |
| `APP_SECRET` | Required 32+ random characters; session signing, state sealing, AES-GCM token encryption |
| `AUTH_PASSWORD` | Required strong owner password, 12+ characters |
| `AUTH_DISABLED` | `false` (Railway runtime rejects `true`) |
| `DATABASE_PATH` | `/data/seo-health.db` |
| `PAGESPEED_API_KEY` | Recommended; API key restricted to PageSpeed API |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Required to enable Search Console OAuth |
| `ANTHROPIC_API_KEY` | Optional; leave unset initially to avoid AI charges |
| `AI_MODEL` | Existing default `claude-opus-5-5`; choose supported model and verify provider access if enabling AI |
| `TRUST_PROXY` | `0` initially: conservative shared rate-limit identity; use another value only after verifying Railway's actual forwarding chain |
| `AUDIT_CONCURRENCY` | `1` for beta (clamped to 1–2; default 2 for existing local behavior) |
| `CRAWL_MAX_PAGES` | `25` (clamped 1–100) |
| `CRAWL_CONCURRENCY` | `2` (1–5) |
| `CRAWL_TIMEOUT_MS` | `15000` (2000–60000) |
| `CRAWL_MAX_BYTES` | `3000000` (100000–20000000) |
| `PAGESPEED_MAX_PAGES` | `3` (0–10; 0 disables measurements) |
| `GSC_MAX_INSPECTIONS` | `25` (0–100) |
| `AUDIT_RATE_LIMIT_MAX` | `2` for beta per 10-minute window |
| `AUDIT_RATE_LIMIT_GLOBAL_MAX` | `5` for beta per 10-minute window |
| `AUDIT_RATE_LIMIT_WINDOW_MS` | `600000` |
| `PORT`, `HOSTNAME`, `NODE_ENV` | Platform PORT; image/entrypoint binds `0.0.0.0`, image sets production |
| `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_VOLUME_MOUNT_PATH` | Supplied by Railway; startup validation requires database inside the mount |

Do not use `NEXT_PUBLIC_` for any secret. Do not enable `NEXT_MANUAL_SIG_HANDLE`; retain Next.js shutdown handling. Volume validation occurs only on Railway runtime, never during build. There is no queue service URL in this architecture.

## Google configuration

In Google Cloud Console select the existing project, enable PageSpeed Insights API and Search Console API. In **Google Auth Platform → Clients** (or **APIs & Services → Credentials**) open the Web application OAuth client. Add the EXACT authorised redirect URI:

```text
https://<your-host>/api/integrations/google/callback
```

Set APP_URL to the same origin. Retain the localhost URI if still needed locally. Keep consent restricted to your owner/test user for the beta. OAuth state and S256 PKCE remain enabled; scopes remain `openid`, `email`, and `webmasters.readonly`. HTTPS cookies are HttpOnly and SameSite=Lax, allowing top-level Google redirects. Never log callback query strings (they contain codes/state). Verify property access, a snapshot and refresh AFTER restarting (the in-memory access token cache then starts empty). Provider testing-mode refresh-token expiry may require reconnecting; check your Google consent settings.

## Startup migrations and persistence

`src/instrumentation.ts` dynamically starts the Node runtime. Runtime validates Railway variables, opens SQLite, creates its parent directory, enables WAL and foreign keys, applies the checked-in Drizzle journal/migrations, then starts the worker. Migration failure prevents readiness. Three existing migrations are retained unchanged. A single process and volume avoid migration races. Database, `-wal`, `-shm` and any `-journal` all live beside the database on `/data`; do not relocate just sidecars to ephemeral storage.

`/api/health` returns only `{ "ok": true }` after a database query; it is intentionally unauthenticated. Railway's healthcheck is a deployment readiness check, not continuous monitoring. Configure an external uptime monitor separately. Inspect deploy logs and confirm DB history after both restart and code redeployment.

For local migration rehearsal use a disposable database:

```sh
DATABASE_PATH=/private/tmp/seo-railway-migration-test.db npm run db:migrate
```

Do not run that command without DATABASE_PATH against the existing local DB. Container startup performs migrations automatically; it does not need tsx/drizzle-kit in the runtime image.

## Backups, safe import and restore

In the service **Backups** tab enable **Daily + Weekly + Monthly** volume backups and create a manual pre-release snapshot. Railway currently retains daily for 6 days, weekly 27 days, monthly 89 days. Backups are incremental, charged at volume rates; manual snapshots have a documented 50%-of-volume-capacity limit. They include the whole filesystem and WAL. Neither schedules nor Railway restores have been configured/tested here. See [Railway backups](https://docs.railway.com/volumes/backups).

The checked-in SQLite online snapshot tool is tested with uncheckpointed WAL writes and encrypted token ciphertext. It produces a private mode-0600 database, validates integrity/foreign keys, and REFUSES an existing destination. It never decrypts tokens. Backups still contain private audits, email and encrypted credentials: restrict access and encrypt off-platform copies. Never place copies in `public/`, GitHub, reports, or an HTTP endpoint. Volume backups are not an independent off-platform recovery copy.

Create a non-destructive export of the local database, using a new destination in a private directory (the tool does NOT auto-load `.env.local`):

```sh
DATABASE_PATH=/absolute/path/to/existing/seo-health.db node scripts/sqlite-backup.cjs backup /private/tmp/seo-health-transfer-UNIQUE.db
```

This reads the source with SQLite's online backup API; it never replaces it. Do not use `cp` on a running WAL database. For an initial import, upload only the snapshot using Railway's authenticated volume-file/SFTP tooling. Install/update Railway CLI separately, link to the intended project/environment/service, and consult `railway volume files --help` / `railway ssh --help` for current upload syntax. Never use `railway run` for volume operations: it runs locally with injected variables. After upload, via `railway ssh` in the running container:

```sh
node scripts/sqlite-backup.cjs restore /data/import/seo-health-transfer-UNIQUE.db /data/seo-health-imported-UNIQUE.db
```

Set `DATABASE_PATH=/data/seo-health-imported-UNIQUE.db` in Variables and redeploy. The old Railway DB remains available; the local DB remains untouched. Import is an entire snapshot, not a merge. Use a new file/path every time. Preserve APP_SECRET and OAuth client identity. Running jobs in an imported snapshot will recover after heartbeat expiry, potentially rescanning sites: import when audits are idle. Verify table counts/history and Google refresh before deleting any transfer copies under your own retention policy.

For logical recovery, create a safety backup of the current DB with a fresh destination, restore a known-good snapshot to ANOTHER new filename, then change DATABASE_PATH and redeploy. Never overwrite an active file or delete its WAL. Example in `railway ssh`:

```sh
node scripts/sqlite-backup.cjs backup /data/pre-restore-UNIQUE.db
node scripts/sqlite-backup.cjs restore /data/known-good-UNIQUE.db /data/restored-UNIQUE.db
```

For platform recovery: service **Backups → select timestamp → Restore → review staged changes → Deploy**. Railway stages a new restored volume at the same mount and retains the previous unmounted volume. Confirm DATABASE_PATH exists in the selected backup and that APP_SECRET matches. Run health, history, login, exports and token refresh checks. Platform recovery remains untested until a drill in a separate environment; never drill on the only live volume.

## Verify the first release

```sh
curl --fail https://<your-host>/api/health
curl -i https://<your-host>/api/audits
```

Expect 200 health and 401 audits without cookies. In a browser: login with correct password; confirm a wrong password fails and HTTPS session cookie is Secure/HttpOnly/SameSite=Lax. Run a small public-site audit, close the initiating tab, then reopen to confirm progress and completion. Submit the same URL while pending and confirm the same job ID; submit a private/loopback URL and confirm rejection. Download PDF/CSV/JSON/Markdown and generate Fix with AI instructions. Fix instructions are local prompt generation and do not require Anthropic; the optional AI consultant does.

Restart the service and confirm historical data and queued audits persist. To exercise interrupted work, restart during a scan: allow roughly 90 seconds for stale heartbeat recovery and up to two claim attempts. Ordinary terminal crawl errors are not automatically retried; rerun them explicitly. Check PageSpeed mobile/desktop and real GSC snapshots/refresh with your own keys. These live Railway/Google checks are mandatory before declaring deployment verified.

## Domains, monitoring, cost and rollback

For custom domain: **Settings → Networking → Custom Domain**, enter hostname, copy Railway's displayed DNS records into your DNS provider, wait for validation/TLS issuance. Update APP_URL and Google OAuth URI to the final origin. Verify login and OAuth on that hostname; use a single canonical origin.

Check **Metrics** for RAM/CPU during both idle and worst-case scans and **Logs** for worker failures/startup issues. Never enable request-header logging or export Railway variables. Start with 1 GB RAM and 1 audit at a time; DOM parsing and PDF generation can have transient memory spikes. Disable sleeping. Set Workspace **Usage → Compute Usage** email alert around $10 and optional hard limit $20 for beta. A hard limit takes workloads offline; choose it deliberately. Anthropic budgets and Google quotas are separate. See [cost control](https://docs.railway.com/pricing/cost-control) and the scenario estimates in the roadmap.

Before upgrading code, make a backup and inspect migration compatibility. **Deployments → previous known-good deploy → ⋯ → Rollback** restores code AND its custom variables, so confirm DATABASE_PATH/APP_SECRET before proceeding. SQLite is not rolled back with code. A schema-changing rollback can require a separate data restore; prefer forward fixes if the old binary cannot read the new schema. Existing migrations have not changed in this release. Railway currently retains removed Hobby images for 72 hours and Pro images for 120 hours; older releases may need rebuilding. See [rollback guide](https://docs.railway.com/guides/roll-back-bad-deploy).

## Official documentation checked 2026-10-14

- [Volumes and runtime mount timing](https://docs.railway.com/volumes)
- [Volume permissions, replicas and deployment downtime](https://docs.railway.com/volumes/reference)
- [Healthcheck/PORT behavior](https://docs.railway.com/deployments/healthchecks)
- [Deployment teardown](https://docs.railway.com/deployments/deployment-teardown)
- [Pricing and included usage](https://docs.railway.com/pricing/plans)
- [Backups](https://docs.railway.com/volumes/backups)

Volume-backed redeployments have brief downtime even with healthchecks. No claim of zero downtime, automated backups already enabled, Linux image validation or live integration validation is made.
