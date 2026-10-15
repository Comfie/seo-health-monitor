# G6 privacy and retention — draft for review

Prepared 15 October 2026. **Operator/legal approval is outstanding; no legal-compliance claim. No destructive retention was run on staging.**

The public beta notices are `/beta/privacy`, `/beta/terms`, `/beta/data-use`; Account settings links to them and supplies export/deletion. Set a monitored `PHASE2_PRIVACY_CONTACT_EMAIL` before external invitations. Until then the draft points users to replying to their invitation/operator. Confirm the responsible business identity, information officer, request-handling process and escalation contact before launch.

## Proposed periods

| Data | Default | Implementation / purpose |
| --- | --- | --- |
| Audit history, crawled pages, findings, performance | 180 days | Deletes only terminal audits without active work; foreign keys cascade owned children. |
| Scan logs | 30 days | Clears terminal audit log arrays. |
| Finished/failed jobs (both queues) | 30 days | Removes terminal queue records; never queued/running work. |
| Authentication events | 90 days | Fixed success/failure/sign-out codes; no passwords, email, IP or cookies in event payloads. Expired sessions/reset verifications cleaned separately. |
| Invitation records | 90 days | Removes expired unused or accepted records. Claimed unverified registrations are held for operator resolution so no pending activation is broken. |
| Search Console snapshots | 90 days | History removed by fetched date. |
| Generated reports | 180 days | Stored AI report fields cleared; audit deletion removes all stored reports. PDF/CSV/JSON/Markdown downloads are generated on demand with no persistent public file. |
| Account activity/admin actions | 90 days | Explicit metadata only. Erasure removes actor/target correlation. |
| Operational events | 30 days | Fixed codes; stale process heartbeats removed after one day. Platform log retention is a separate operator setting. |
| Deletion evidence | 90 days | Random receipt, SHA-256 of random user/tenant IDs, deletion timestamp; no email/name/password/token. Must outlive every backup. |
| Backups | 30 days | Operator-managed encrypted external copies, including local/off-site copies; never managed by SQL cleanup. |

Every period has `PHASE2_RETENTION_<NAME>_DAYS` settings in `.env.example`; 1–3650-day bounds apply. Review exceptions/holds and provider retention separately. Changing settings does not silently enable cleanup. Preview: `node --conditions=react-server --import tsx scripts/beta-maintenance.ts retention-preview` with explicit separate staging target. Execution additionally requires reviewed `PHASE2_RETENTION_APPROVED_REVISION=g6-draft-1` and argument `'APPLY g6-draft-1'` to `retention-apply`. Pause admission/workers, take a verified backup and review counts first. Do not set the approval variable or execute on real accounts until the owner approves. SQL cleanup refuses receipts that expire before backups. Schedule only after review; none is installed by this change.

## Account lifecycle

`POST /api/beta/account/export` requires the library session, canonical Origin, current password and a durable per-user throttle (five attempts per 15 minutes, shared with deletion). It returns a private/no-store versioned JSON attachment directly. A repeatable-read transaction exports profile, websites, audits, crawled pages, checks, findings, performance, snapshots, non-secret property links, activity and usage. Every domain query filters the verified tenant; auth credentials/sessions, Google account credentials/OAuth state and server settings are excluded. No download object is stored publicly.

`POST /api/beta/account/delete` additionally requires exact `DELETE MY ACCOUNT`. It locks the owned tenant, removes all sessions, pending verifications/invitations, import metadata, owned domain data and both queues, then deletes the auth identity. Every stale lease fails after commit; retries do not create data. Concurrent internal repeat calls return the existing receipt; HTTP replay with revoked credentials returns 401. Admission uses the same tenant row lock. Before erasing tenant usage rows, the transaction preserves only anonymous UTC-day/provider-kind totals with no actor, tenant, email, URL or report content. Shared provider budgets include those totals, so account deletion cannot rewind global cost caps. These counters follow the account-activity retention period; retaining at least one day preserves the current UTC-day cap. Provisioning rechecks and holds the live verified identity so a previously read session cannot recreate an erased account. Administrative accounts require a separate operator handover and are protected from self-deletion. All development erasure tests use disposable synthetic accounts.

Google credentials are erased locally. Account deletion does **not** call Google's user/client-wide revoke endpoint, because that can break another tenant's independently authorised use. The notice explains how the customer can remove the grant in Google. A started network request may finish, but fenced/cascaded writes cannot store its results. Memory access-token entries expire and are unusable without reloading the owning DB credential.

Backups can temporarily retain deleted information. Before a restore can serve traffic, reapply the separately preserved, current deletion ledger, revoke all recovered sessions/reset/OAuth states and verify tenant counts. Never restore a backup with an incomplete ledger. See the recovery runbook.

## POPIA review work

The [official Act](https://www.justice.gov.za/legislation/acts/2013-004.pdf) covers purpose/retention (13–14), notices (18), safeguards/operator handling (19–21), compromise notification (22), access/correction/deletion (23–25), and cross-border transfers (72). The implementation provides minimisation, controlled access and self-service requests; the operator must still decide lawful processing grounds, retention justification and contractual safeguards. Review all processors and offshore transfers before invitations, including Railway (current region EU West, Netherlands), Google (URLs/search data), Resend (account mail) and Anthropic if AI requests are enabled. Verify actual locations, contracts and provider retention rather than inferring them from this draft.

Use the [Information Regulator's current POPIA guidance](https://inforegulator.org.za/popia/) for request and incident procedures. It directs security-compromise notifications to the eServices portal from April 2025. Assign an incident owner, assess affected data/subjects, contain and investigate, preserve restricted evidence and arrange legally reviewed notification as soon as reasonably possible. Do not substitute a GDPR-style fixed notification window or risk threshold. No notice was sent during development.
