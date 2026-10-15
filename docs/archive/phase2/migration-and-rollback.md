# Staging, migration and rollback guide

## What is already preserved

The production application was not deployed or changed. The development branch starts from the production SHA recorded in [the ledger](README.md). Local backup and restoration used the deployed online-backup helper, which creates a new destination exclusively and runs integrity/foreign-key checks.

| Local artifact (ignored, private) | Verification |
| --- | --- |
| `data/backups/phase2-baseline-20261014.db` | Integrity `ok`; zero foreign-key violations |
| `data/backups/phase2-restore-check-20261014.db` | Integrity `ok`; zero foreign-key violations; identical table counts and SHA-256 |
| Both SQLite files | SHA-256 `28f48b27d870c38db79765813ccca34ff1b9382020ded639dd545ee970e3ed8b` |
| `data/backups/phase1-production-b3a8670.bundle` | Complete Git history; `git bundle verify` passed |

The SQLite helper sets file permissions to 0600. These backups contain customer data and OAuth ciphertext. Do not commit them, publish them as build artifacts or copy them to an unprotected staging service. The bundle contains tracked repository history, not a secrets backup.

These files represent the **local** database. A live Railway backup is outstanding. Save the original production `APP_SECRET` separately in a restricted secret store: its exact value is required to decrypt existing Google refresh tokens. `PHASE2_AUTH_SECRET` can later be independent; do not rotate the encryption key by changing the original secret.

## Reproduce local verification

Choose new, nonexistent destination names for each run:

```sh
node scripts/sqlite-backup.cjs backup data/backups/NEW-BACKUP.db
node scripts/sqlite-backup.cjs restore data/backups/NEW-BACKUP.db data/backups/NEW-RESTORE.db
npm run test:saas
node --env-file=.env.local --conditions=react-server --import tsx scripts/rehearse-saas.ts data/backups/NEW-BACKUP.db
```

The rehearsal creates disposable in-memory PostgreSQL (PGlite), migrates it, constructs a synthetic operator identity, imports the backup and closes the database. It does not call Google, send email, start a scanner or access Railway. PGlite tests the PostgreSQL engine and SQL, but does not establish hosted PostgreSQL networking, TLS or multi-process behaviour.

The actual local rehearsal imported:

| Table | Records |
| --- | ---: |
| sites | 3 |
| audits | 9 |
| pages | 189 |
| checks | 495 |
| issues | 291 |
| performance_results | 54 |
| google_accounts | 1 |
| search_console_connections | 1 |
| search_snapshots | 5 |

Legacy transient rate counters and SQLite migration metadata are intentionally not copied. New authentication counters start separately. Imported historical audits are not inserted into the new operational usage ledger; explicitly decide how legacy administrator history counts before launch. Existing sites are preserved even if their number exceeds the default website limit; further additions are blocked until the administrator adjusts it.

## Isolated local staging PostgreSQL

Docker/PostgreSQL CLIs are not installed here, so this Compose environment is prepared but was not started. It references a new volume and a loopback-only port; it does not attach the production SQLite volume.

```sh
export PHASE2_LOCAL_POSTGRES_PASSWORD="$(openssl rand -hex 32)"
docker compose -f docker-compose.phase2.yml up -d
export STAGING_DATABASE_URL="postgresql://seo_phase2_operator:${PHASE2_LOCAL_POSTGRES_PASSWORD}@localhost:55432/seo_phase2_staging"
export PHASE2_DATABASE_PURPOSE=staging
npm run db:saas:staging -- migrate --confirm-staging=localhost/seo_phase2_staging
```

Keep this password and URL out of shell history/screenshots. Use a dedicated runtime role for the final application; the example operator is for local migration only. Generate SQL with `npm run db:saas:generate`; never replace the existing SQLite migration directory or run schema push against production.

## Initial administrator

The implemented `bootstrapAdministrator()` is an offline, one-time grant. It requires an existing verified identity, serializes attempts using a PostgreSQL advisory lock, refuses if any administrator exists, and logs the grant without a password or token. New registrations cannot submit a role field that grants system privileges.

Once the staging auth/email flow is integrated, an operator can prepare **their own test invitation**, verify their mailbox, provision the personal tenant through `requireTenant()`, then run:

```sh
npm run db:saas:staging -- bootstrap OPERATOR_EMAIL --confirm-staging=localhost/seo_phase2_staging
```

The `prepare-invitation` operator action additionally requires `ALLOW_TEST_INVITATION=true` and `PHASE2_ORIGIN`. Since Stage 2 it creates a hashed, single-use, email-bound invitation and prints the registration link once; it sends no email. It is not an admin grant. The full hosted procedure is in [staging-setup.md](staging-setup.md). Do not invoke it for real external users before approval. No such invitation or live administrator migration was performed during development.

## Railway staging preparation

The exact Stage 2 procedure (variables, Resend email, schema migrations `0000`–`0001`, operator bootstrap and the hosted verification list) is in [staging-setup.md](staging-setup.md). The summary below is the original Stage 1 outline.

Use the existing project ID `6682ee67-83a0-4251-a282-cabcccb26091` only after confirming it in Railway. The production environment recorded by GitHub is `437c36cc-333e-41ea-b7f5-42351b88582a`. Do not edit it as part of staging setup.

1. Create a separate staging environment with its own PostgreSQL service and app service. If using Railway environment duplication, review inherited variables, domain mappings, deploy settings and mounts before applying changes. [Railway environments](https://docs.railway.com/environments).
2. Use the Phase 2 development branch, manual deployment, separate hostname, separate PostgreSQL credentials and separate auth secret. No production volume mount, production database URL or shared Google token cache. Restrict operator access to private data used for migration rehearsals.
3. Configure only required credentials through Railway secret variables. For an authorised production-data rehearsal, transfer the existing encryption secret securely; never print variable values. Use synthetic data first.
4. Add the staging Google callback to an appropriate OAuth client; keep redirect origins explicit. No external testers yet. Configure email sandbox/test recipient restrictions before testing signup/recovery.
5. Apply explicit migrations to staging with a migration-role credential. `STAGING_DATABASE_URL` and `PHASE2_DATABASE_PURPOSE=staging` are required; append `--confirm-staging=HOST/DATABASE`. The script refuses URLs identical to `DATABASE_URL` or `PRODUCTION_DATABASE_URL`, but independent service-ID checks remain mandatory.
6. Complete runtime/worker/UI integration before deploying a customer-capable build. Merely setting a PostgreSQL URL does not switch the existing app: its runtime remains SQLite.
7. Configure backups and restore them to a separate staging service; prove isolation, lease recovery, monitoring and alert delivery. Record Railway deployment ID, SHA, environment IDs and restore evidence.

## Production backup (approval required)

Not yet performed. It runs a command inside the **production** container and writes one new file to the production volume, so it needs its own explicit approval (gate G5 in [staging-setup.md](staging-setup.md#0-approval-gates)). It changes no variable, deployment or existing file. A Git bundle is **not** a database backup.

The deployed image already contains `scripts/sqlite-backup.cjs`, which takes an online snapshot through SQLite's backup API (WAL-consistent), creates the destination exclusively with mode 0600, and runs `integrity_check` and `foreign_key_check`.

```sh
# 0. Read-only identification. Confirm the service, environment and deployment SHA in the dashboard.
railway link                       # choose the project and the *production* environment
railway status

# 1. Snapshot inside the running container (new file on the same volume).
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
railway ssh --service <production service> --environment production -- \
  node scripts/sqlite-backup.cjs backup /data/backups/prod-$STAMP.db
railway ssh --service <production service> --environment production -- sha256sum /data/backups/prod-$STAMP.db

# 2. Download through a non-PTY pipe into a private directory, then compare the checksum.
umask 077; mkdir -p ~/secure/seo-backups
railway ssh --service <production service> --environment production -- \
  cat /data/backups/prod-$STAMP.db > ~/secure/seo-backups/prod-$STAMP.db
shasum -a 256 ~/secure/seo-backups/prod-$STAMP.db       # must equal step 1

# 3. Independent restore into a NEW file, then verify both with the production secret.
node scripts/sqlite-backup.cjs restore ~/secure/seo-backups/prod-$STAMP.db ~/secure/seo-backups/prod-$STAMP-restore.db
read -rs APP_SECRET && export APP_SECRET     # paste the production APP_SECRET; nothing is echoed
npx tsx scripts/verify-sqlite-backup.ts ~/secure/seo-backups/prod-$STAMP.db ~/secure/seo-backups/prod-$STAMP-restore.db
unset APP_SECRET
```

`scripts/verify-sqlite-backup.ts` opens both files read-only. It prints, for each, the SHA-256, `integrity_check`, foreign-key violations, migration count and row counts for every table (audit history, pages, checks, issues, performance results, sites, Google accounts, Search Console connections, snapshots, rate limits). It also prints how many stored Google refresh tokens decrypt with the supplied secret. It exits non-zero unless integrity is `ok`, there are no violations, every token decrypts and the two files' counts match. It never prints tokens, email addresses, row contents or the secret. Tested by `tests/backup-verify.test.ts`. On 14 October 2026 it confirmed the existing **local** baseline and restore copy: identical counts across 11 tables and 1/1 tokens decryptable.

What the backup covers: the whole SQLite database, which holds the audit history, websites, Search Console connections and encrypted OAuth tokens. Phase 1 keeps no application configuration in the database: configuration is in Railway **variables**. Record the production variable **names** (not values) with `railway variables --service <production service> --environment production --kv | cut -d= -f1`, and store `APP_SECRET` and `AUTH_PASSWORD` in a password manager. Without the original `APP_SECRET`, the backed-up Google tokens cannot be decrypted.

Optionally, also create a Railway volume backup from the production volume's **Backups** tab. It restores only in place, so it complements the downloaded copy rather than replacing it.

## Production migration plan (prepared, not authorised)

No production cutover is authorised. This is the order of operations for when it is.

**Before the day**

1. All staging gates in [the beta checklist](beta-checklist.md) are closed, including hosted A/B/admin, worker reliability, Resend delivery, monitoring and alerts.
2. A production PostgreSQL service in the production environment, separate from staging, migrated `0000`–`0002` (and later) with a migration credential. Its own backups are enabled, and one restore into a separate service has been tested.
3. Production variables are prepared but not applied: new `PHASE2_AUTH_SECRET`; **the original `APP_SECRET` kept unchanged**, because it decrypts the existing Google tokens; `PHASE2_ORIGIN`/`APP_URL` set to the production hostname; production Resend domain; `PHASE2_REGISTRATION=invite-only`; `PHASE2_INVITATIONS_ENABLED=false`.
4. A rehearsal on staging with a fresh production backup imported (authorised separately, since it moves production data into staging), followed by reconciliation as below.

**Cutover window**

1. Announce a write freeze. Wait until there are no queued or running Phase 1 audits.
2. Take the final backup and verify it as in the section above. Keep the production volume untouched.
3. Bootstrap the administrator: an invitation for the current owner's address, registration and verification, then `bootstrap`. This preserves the current administrator as a verified identity with its own personal tenant.
4. Import: `import-sqlite BACKUP ADMIN_TENANT_ID ADMIN_USER_ID` into the empty production PostgreSQL. A production-specific wrapper of the staging command, with the same guards, is still to be written and reviewed. The importer refuses populated tables, repeats, invalid foreign keys or JSON, active jobs, ambiguous Google connections and undecryptable tokens, and records a checksum and count ledger.
5. Reconcile: compare the verifier's per-table counts with the import ledger (sites, audits, pages, checks, issues, performance results, Google accounts, Search Console connections, snapshots). Spot-check three audits' scores and an exported PDF. Confirm token decryptability with the original `APP_SECRET`.
6. Google connections: tenant-aware Search Console is Stage 4B. Until it exists, either keep the imported connection read-only and marked "reconnect required", or explicitly disconnect it. That decision must be made before cutover; nothing silently drops it.
7. Deployment order: worker service first, idle with an empty queue. Then the web service with the Phase 2 variables, on a **new** deployment, so the previous Phase 1 deployment stays available for rollback. Then switch the domain.
8. After release: health checks green; worker `alive` lines present; queue depth 0; no `[beta-db]` errors; owner sign-in, history, reports and Google status checked.

**Monitoring after release:** the alerts listed in the [ledger](README.md) (queue stall, repeated worker failures, PostgreSQL connection errors, PageSpeed failures, CPU and memory), watched closely for the first 72 hours.

## Rollback

Application rollback and database rollback are different operations. An **application rollback** redeploys a previous image. It is safe at any time, because migrations are additive and are never run by a deploy. A **database rollback** means restoring a backup. It discards every write made since that backup, so it needs a write freeze and an explicit decision.


**Development/staging:** stop the Phase 2 preview/worker, retain failed staging logs and PostgreSQL snapshot for diagnosis, and continue using the unchanged Phase 1 service. Do not run destructive down migrations or overwrite the source SQLite file.

**Approved production cutover before new customer writes:** restore traffic to the preserved Phase 1 service/deployment at `b3a86700fab74da2d0a40a5e138d445a4e9fccaa`, using its original volume and original secrets. Confirm owner login, history, reports, Google status and worker health. Prefer Railway's recorded deployment rollback over deploying the unrelated `main` tree. [Railway deployment actions](https://docs.railway.com/deployments/deployment-actions).

**If the original volume needs recovery:** restore the verified SQLite backup to a new destination using `db:restore`; verify it again; change `DATABASE_PATH` to that new file only as part of the approved recovery. Never restore over an open live database or discard its WAL. Preserve the prior file and volume for investigation.

**After Phase 2 accepts customer writes:** reverting traffic to Phase 1 cannot preserve those new users/results. Freeze writes and take a PostgreSQL backup first. Reconcile/export new tenant data and obtain an explicit recovery decision; there is no automatic PostgreSQL-to-single-owner downgrade. This is a launch gate, not a claimed lossless rollback.
