# Superseding owner instruction

The later owner request replaces the dedicated-beta Google/deferred-feature strategy with a unified original-domain application. See [the current migration plan and evidence](unified-migration-plan.md). The following report preserves the earlier G6 checkpoint; its approval and credential assumptions are historical.

# G6 administration, privacy and beta readiness

15 October 2026, `phase2-multiuser`, based on accepted G5 source `04d8ca0fa3728ab175d483f1a37c187fc0dd3ad3`. **G6 is implemented locally and prepared for review; external beta is not approved. No G6 deployment, push, merge or external invitation.** Existing uncommitted G5 report edits were preserved and extended with the closeout.

## PASS — implemented and locally verified

| Requirement | Result and practical scope |
| --- | --- |
| G5 closeout/staging cleanup | Original quota ledger restored/read back for A/B (all six fields NULL); 32 usage, 2 websites, 22 audits, 55 activity records unchanged. Worker back to one running replica on the same G5 image. Phase 1 deployment unchanged. [G5 handover](g5-search-console-report.md#g6-handover--g5-accepted-live-google-deferred-15-october-2026). |
| Authentication/tenant isolation | Existing G4/G5 regressions retained; additional DB identity recheck prevents deleted-identity reprovisioning. Server privilege/tenant checks remain mandatory. |
| Administration | `/beta/admin`: registered/active/suspended/pending counts, email search, creation dates, usage/limits, set/remove bounded per-account overrides, suspend/reactivate with session revocation and job fencing, administrative old/new change log. Existing invitation creation/revoke/reissue/status remains; no invitation secrets in listings, no impersonation or implicit report/token access. |
| Export | Current password + session + Origin + durable throttle; owned versioned JSON attachment, private/no-store, no auth/session/Google credentials, no public download storage. Includes profile, websites, audit history, findings/pages/checks, performance, Search Console snapshots, activity/usage. |
| Account lifecycle | Explicit phrase/password confirmation; atomic owned-tenant erasure, all sessions/queues/credentials/history removed, minimal hashed-ID receipt. Empty/completed/queued/running/Google/multiple-session/repeated/concurrent cases tested; stale workers cannot resurrect data. Other tenants and shared Google grants preserved. Administrators require handover instead of self-deletion. |
| Retention framework | Settings/defaults and operator preview/apply commands; cleanup off until reviewed revision/explicit confirmation. Tests preserve active jobs/usage and remove old terminal data only. No staging cleanup executed. [Policy](g6-privacy-retention.md). |
| Draft notices | Public beta privacy/terms/crawling-Google-data explanations, export/deletion information, account links and draft status. POPIA/processor/cross-border review actions documented; contact currently invitation reply/operator unless configured. No legal-compliance claim. |
| Monitoring | Protected aggregate web/worker/queue/failure/lease/retry/rate/usage dashboard, structured fixed-code events, threshold alerts, one-shot operator monitor with nonzero failure exit. No customer report/token content in operational views. |
| PostgreSQL recovery tooling | New encrypted, complete logical backup/restore, matching migration metadata, per-table fingerprints, sequence preservation, FKs enforced throughout, empty isolated target guard and newer deletion-ledger reconciliation. Existing pre-G5 backup independently restored: **23/23 tables, 0 mismatches**; legacy sequence-state limitation documented. |
| Security | Focused auth/admin/tenant/SSRF/queue/OAuth/CSRF/headers/secrets/SQL review and negative tests. [Security review](g6-security-review.md). Source scan: no known local secret or credential-pattern hits. No new dependency. |
| Audit execution and cost limits | G4 bounded runner/queue/provider reservations and G5 mock isolation regressions retained. Global/per-account limits remain effective; account deletion preserves anonymous daily resource totals so it cannot reset shared provider budgets; admin overrides are validated and bounded. |
| Incident/rollback procedures | Named owner, escalation/recovery checklist, image/source preservation, additive migration review, code-vs-data rollback distinction, deletion reconciliation and no production changes documented. [Runbook](g6-operations-runbook.md). |

Local verification covers the real auth library and PostgreSQL engine in PGlite; Google/provider responses remain mocked where noted. Current automated suite: **261 passed in 20 files** (239 G5 baseline + 18 G6 lifecycle/admin/retention tests + 4 backup/migration/reconciliation tests). TypeScript and ESLint passed. Production build and browser/standalone evidence are recorded in [local verification](g6-local-verification.md). These are local results, not hosted G6 results.

## DEFERRED — safe to keep unavailable during private beta

- **Live Search Console:** G5 is accepted as implementation-complete; OAuth credentials and real Google scenarios remain deferred. Leave unconfigured/unavailable. The app must show not verified, not fabricated figures. [Exact pending scenarios](g6-google-verification.md).
- **Successful live PageSpeed:** leave unavailable and do not advertise it as working. Minimum enablement gate: beta-restricted key; actual mobile and desktop metrics from the deployed worker; source/time and plausible values; tested error/unavailable handling, budgets and A/B report isolation. An anonymous 429 is not verification.
- **Streamed HTML 200 not-found:** reproduced and documented Next.js behaviour after the shell commits; no protected content is queried/exposed and APIs return real denial statuses. Optional routing improvement must preserve server checks.
- **Automated retention execution:** framework is ready, but destructive scheduling intentionally waits for policy review. Manual preview is safe. Agree a time-bound review before retention periods are exceeded.

**Google-disabled launch assessment:** technically safe to invite a controlled private beta with Search Console disabled and PageSpeed unavailable **after all blockers below are cleared**, since technical crawls, findings, comparisons and reports remain independent. Do not describe either optional integration as live-verified.

## BLOCKER — before external invitations

1. **Approved G6 migration/deployment and hosted verification.** Local work is not on Railway. Approve beta-only 0004 plus web/worker deployment after source/secret/rollback review and a fresh verified backup. Run hosted A/B/admin permission/export/isolation tests and disposable deletion cases (including real concurrent worker completion/claims), plus G4/G5 regressions and recovery. Never delete the existing administrator/internal A/B accounts. No external invitation is authorised by deployment approval alone.
2. **Phase 1 production SQLite backup/restore.** Explicit release prerequisite; still not performed/authorised. Local SQLite smoke and staging PostgreSQL restore are different evidence.
3. **Recurring backup operations.** Approve encrypted external storage, secrets/access, retention and responsible deputy; install/run the schedule, preserve a current independent deletion ledger, verify failure alerts and perform a timed full PostgreSQL/environment restore. Proposed RPO 24h/RTO 4h are not measured guarantees. The available local PGlite restore does not prove a hosted PostgreSQL failover.
4. **Privacy/business review.** Confirm legal operator identity and monitored privacy contact, approve notices/retention, request and incident procedures, processor contracts and cross-border handling. Draft pages alone are insufficient.
5. **Operational alert delivery and capacity watch.** Dashboard/probe rules exist; wire and verify operator delivery/escalation, periodic health probing, platform CPU/memory/connection/cost and backup-failure monitoring. Confirm the beta's actual resource caps after deployment.
6. **Residual dependency risk disposition.** Live npm audit still reports 9 high/4 moderate development/optional tooling findings. Final runtime tracing/image review plus an accepted reachability decision or tested fixes is required. No advisory was silently treated as fixed.

## Deployment review packet

0004 is additive: three new tables (`account_deletion_records`, `operational_events`, `system_heartbeats`), indexes and an event tenant FK. Existing populated G5 table rows remain identical in the migration test. No destructive data migration or schema rollback is required for G5 code rollback. Take a fresh post-G5 backup, preserve the current G5 images/source and scan the complete candidate archive before approval. The worker replica restoration reused G5; it was not a G6 release. All G5 reports/test evidence remain available.

There is no monetisation, payment flow, subscription, unrestricted registration, cross-tenant impersonation or Phase 1 infrastructure change in this work.
