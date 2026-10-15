# G6 operations, backups and incident recovery

Prepared 15 October 2026. Beta only. No deployment, external invitations, production changes or scheduled destructive retention is authorised by this document. The original Phase 1 service is outside every beta maintenance target.

## Monitoring and alerts

`/beta/admin/operations` and `GET /api/beta/admin/operations` check the administrator on the server and return aggregate data, never customer content or Google credentials. They expose web/worker heartbeat age, both queue depths, oldest queued time, running/failed jobs, stale leases, retry totals, completion/failure rates, fixed-code provider/database failures, and daily/monthly reservation usage versus global caps. Rates cover retained terminal jobs, so label them accordingly.

Workers write a heartbeat every 30 seconds, including when idle, and update progress time on terminal outcomes. Health probes and web requests refresh web activity. Configure an external request to `/api/beta/health` every 60 seconds; a successful old startup check alone is not ongoing availability monitoring. `node --conditions=react-server --import tsx scripts/beta-monitor.ts` is a one-shot operator probe using a separate `STAGING_DATABASE_URL` and `PHASE2_DATABASE_PURPOSE=staging`. It emits a redacted alert record and exits 2 on alerts/database failure, suitable for an operator-owned scheduler. It does not send email/webhooks or install a scheduler.

| Alert | Threshold / action |
| --- | --- |
| Worker missing | No heartbeat in 90 seconds; inspect/restart only beta worker, then verify queue movement. |
| Stale leases | Any expired running lease; check recovery, DB reachability and worker logs. Do not manually overwrite fencing tokens. |
| Delayed queue / no progress | Oldest queued over ten minutes, or queued work without a terminal outcome for ten minutes; inspect capacity, provider timeouts and backoff. |
| Repeated failed audits | At least three final failures in 24 hours; inspect fixed-code events and a disposable reproduction. |
| Database failures | Any recorded failure; alert probe nonzero on outage. SQL cannot persist its own outage, so restricted structured platform logs and external probes are mandatory. |
| Resource consumption | PageSpeed/AI reservations reach 80% of a nonzero daily cap; verify scope before changing caps. Admission still enforces hard caps. |

Events have fixed codes and timestamps, optional tenant FK, no free-text provider bodies, passwords, cookies, keys, OAuth tokens, full invitation links or crawled content. Google-refresh, PageSpeed-unavailable and AI-provider errors are instrumented. Authentication sign-in success/failure/sign-out events carry no credentials or customer identifiers. Configure Railway CPU/memory/connection and log retention separately; reservation units are not billed costs. Delivery/escalation, platform metrics and backup-failure alerts must be wired to a monitored operator channel and tested before external beta. None has been silently enabled here.

## Backup verification and limits

The existing pre-G5 staging logical backup is in the private operator backup directory named in the G5 report. G6 independently restored it on the matching 0000–0002 schema with **foreign keys enabled throughout**: all 23 public/migration tables, zero fingerprint mismatches. [Evidence](evidence/g6/existing-backup-verification.json). It contains migration metadata but did not capture sequence state. Legacy recovery must set each identity sequence beyond restored IDs before writes. Its restricted local permissions are verified; it is plaintext and must be encrypted before off-site storage. The prior G5 verifier dropped FK constraints after loading; the G6 rerun provides the stronger FK evidence. This is a staging PostgreSQL backup, not a Phase 1 production backup.

New backup code captures all `public` and `drizzle` tables in a read-only repeatable-read transaction, per-table SHA-256 fingerprints and sequence state. Restores require matching migration metadata/schema and an empty application database, load in FK dependency order, enforce FKs on every insert, compare every table fingerprint and restore sequences. The artifact uses AES-256-GCM with a random salt/nonce and scrypt-derived key; tampering/wrong-key tests fail closed. Files are created outside the repository with exclusive-create and mode 0600, directories created with mode 0700. Use a separately secured backup encryption secret; retain auth/token encryption secrets in the operator vault separately from encrypted data. A restored Google credential still needs its original beta encryption key.

Commands (secrets are supplied by a private environment/secret store, never arguments):

```sh
node --conditions=react-server --import tsx scripts/beta-maintenance.ts backup /restricted/offsite-mount/beta-YYYYMMDD.enc
node --conditions=react-server --import tsx scripts/beta-maintenance.ts deletion-ledger /restricted/offsite-mount/deletions-YYYYMMDD.enc
```

Both require explicit separate `STAGING_DATABASE_URL`, `PHASE2_DATABASE_PURPOSE=staging` and 32+ character `BETA_BACKUP_ENCRYPTION_SECRET`; shared production URLs are rejected. Never paste connection strings, artifacts or keys into tickets/Git. The logical format is versioned JSON inside encryption, not a substitute for an unrestricted PostgreSQL physical backup. It is designed for this small beta: data is read into memory, sequence values can advance during a snapshot, and large/DDL-changing databases need a maintenance window or reviewed `pg_dump` procedure. Preserve migrations with their hashes in the release archive; the artifact's migration table identifies the schema to apply.

Proposed recurring policy, pending operator approval:

- Responsible operator: repository owner (Comfort), with a named backup/recovery deputy before launch.
- Nightly complete encrypted backup and an additional backup before migrations/deployments; keep 30 daily copies in restricted external storage outside the live database/volume. Storage account, access policy and location require approval. Do not assume Railway Pro native backups; Railway previously refused them on this plan.
- Preserve an encrypted deletion ledger outside the live DB frequently and immediately before a planned restore. For an outage, reconcile deletion requests since the last ledger from restricted operator evidence; do not serve a restore while completeness is uncertain. Retain receipts longer than every recoverable backup. A durable external ledger/scheduler is an operational gate, not an installed feature.
- Keep encryption keys in an independently accessible vault; verify offline recovery access, least privilege and separation of data/key access. Delete expired copies including workstation/off-site copies under the reviewed policy.
- Verify artifact creation, decryption and fingerprints after each run; alert on missing backup older than 26 hours, encryption/upload failure or a failed restore drill. Monthly restore drill and after schema/tool changes.
- Proposed **RPO 24 hours**, **RTO 4 hours** for the small beta. These are targets awaiting timed full-environment rehearsal, not measured guarantees.

## Restore and deletion reconciliation

1. Declare incident, pause beta admission/worker; preserve current restricted evidence and the last working image/release archive. Never repoint Phase 1.
2. Provision an isolated local PostgreSQL target with the backup's exact migrations. No application rows, traffic or worker. Obtain artifact, encryption key and **current separately preserved deletion ledger**; confirm complete deletion coverage.
3. Set `ISOLATED_RESTORE_DATABASE_URL`, `BETA_BACKUP_ENCRYPTION_SECRET`, `BETA_DELETION_LEDGER_FILE`, `PHASE2_DATABASE_PURPOSE=staging`, then run:

   ```sh
   node --conditions=react-server --import tsx scripts/beta-maintenance.ts restore /restricted/beta.enc --confirm-isolated=localhost/beta_restore
   ```

   The CLI only allows a confirmed loopback PostgreSQL target. For a different isolated hosted target, review/extend the explicit guard before use; it does not silently permit cloud database replacement.
4. Verify complete schema, migration hashes, counts/fingerprints and FK consistency; reapply newer deletion receipts before traffic. All recovered sessions, reset verifications and OAuth states are invalidated; users sign in again. Review queued/running jobs and recover leases only after confirming receipts and tenant status. Fenced workers must use the restored database, never the old and new concurrently.
5. Test A/B/admin isolation, export/deletion on disposable tenants, audit execution and health. Verify Google credential decryptability only if configured; never print tokens. Rehearse DNS/application connection changes separately with owner approval. Record actual RTO/RPO and missing writes. No restore or traffic cutover is automatic.

## Rollback and deployment review

Last working source is `04d8ca0fa3728ab175d483f1a37c187fc0dd3ad3`. Preserved image IDs and G5 deployment IDs are in the G5 handover. The G6 migration `0004_g6_operations` only creates three tables, indexes and a nullable tenant FK; it has no updates/deletes/drops. Review its generated snapshot/journal. Deployments do not migrate on startup. **Before approved G6 rollout, take and verify a new post-G5 backup**, scan all candidate files for secrets, preserve a clean source archive and inspect the worker bundle/runtime dependencies. Apply 0004 through the guarded staging migration command only after approval, then deploy beta web/worker only and run hosted G4/G5/G6 regressions. Keep one worker replica and the restored original quotas.

Code rollback can run G5 on the additive G6 schema; leave 0004 applied. Account deletion is intentionally irreversible: code rollback must not restore deleted data. To revert images, explicitly redeploy the preserved beta images/archive after approval, keep current data, and verify health/worker isolation. Database rollback requires isolated restore plus deletion reconciliation and separate traffic approval. No automatic push, merge, deploy or external invitation.

## Incident response

The operator owns triage and notification decisions. Alert → confirm beta target → contain by closing invitations/pausing jobs/suspending the affected synthetic or customer account only where justified → preserve redacted/restricted evidence → rotate affected secrets and revoke sessions → reproduce/fix → validate isolation → approved recovery → review. Never paste raw logs/exports or tokens into public issues. Use the privacy contact for requests, and track identity verification and minimum necessary evidence. For a personal-information compromise, involve the responsible party/information officer and follow the [Information Regulator's current process](https://inforegulator.org.za/popia/); notifications require reviewed facts and are not sent by this development workflow.

## Phase 1 production SQLite — separate blocker

The local SQLite verifier and local standalone smoke do **not** prove a Railway production backup. Before any release/external beta approval, the owner must separately authorise a consistent production-volume SQLite backup with its original encryption secret, encrypted restricted storage, and an independent isolated restore validating integrity, FKs, all tables, record counts and token decryptability. The procedure already exists in [migration-and-rollback.md](migration-and-rollback.md). No Phase 1 backup, secret or infrastructure change was performed in G6. This remains a **release blocker** by the owner's requirement.
