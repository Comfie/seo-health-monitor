# Controlled beta launch gates

Unchecked gates are incomplete. No external invitations or production deployment are authorised by this document.

- [x] Phase 2 branch based on the recorded deployed SHA; production history preserved locally.
- [x] Local SQLite backup and independent-file restore validated.
- [x] PostgreSQL migration/import rehearsed against synthetic data and the verified local backup.
- [x] Foundation tests exercise real auth handler, two customers, separate administrator, tenant reads/writes and recovery.
- [ ] Independently confirm current running Railway SHA and preserve deployment/configuration identifiers.
- [ ] Back up the production volume and original encryption secret securely; restore-test a separate copy. *(Stage 4A: procedure and read-only verifier ready, including token decryptability; awaiting gate G5 approval.)*
- [ ] Create and verify separate Railway staging PostgreSQL/app services, secrets, domain and restricted email transport. *(Stage 4A: PostgreSQL migrated; web and worker images, config-as-code and runbook prepared; password rotation, service creation and deploy await gates G1–G3.)*
- [x] Connect auth pages/routes without exposing any global SQLite data to customer sessions. *(Stage 2; route tests, static import guard and local browser run. Hosted re-test pending.)*
- [ ] Complete verification/recovery/email delivery and account/session/password settings UX. *(Stage 2: implemented and tested locally against a mocked provider. Open until Resend delivery is verified in staging.)*
- [x] Complete personal dashboard, onboarding, empty states and website management with the existing visual style. *(Stage 2)*
- [ ] Port SEO runner, progress and performance reruns; prove distributed claims/fencing, retry/cancel and global/per-account resource limits. *(Stage 3: implemented; multi-process claims, fencing, kill/freeze recovery and quota races verified on Railway PostgreSQL 18. Open until repeated with workers deployed on Railway.)*
- [ ] Enforce the snapshotted page limit and expensive AI/PageSpeed/Google budgets in workers and services. *(Stage 3: page limit, PageSpeed and AI budgets done. Google budgets wait for tenant Search Console.)*
- [ ] Complete tenant-aware OAuth state, token refresh/cache, property checks and disconnect; test two separate authorised Google accounts.
- [x] Complete tenant-safe PDF/CSV/JSON/Markdown reports, comparisons and provider-neutral Fix with AI. *(Stage 3; hosted re-test pending.)*
- [ ] Complete protected admin dashboard, invitations, quotas, suspension, aggregate monitoring and privileged action logs. *(Stage 2: invitations with status/expiry/revoke and a config kill switch. Quotas, suspension UI, monitoring and log UI remain.)*
- [ ] Complete fresh-session account export/deletion, Google disconnection and scheduled retention.
- [ ] Review privacy policy, terms and crawling explanation with the responsible business/legal reviewer.
- [ ] State the actual data collected, purposes, retention, processors/hosting, contact and deletion options. Evaluate POPIA obligations using the [Information Regulator's material](https://inforegulator.org.za/popia/); do not present generated wording as approved legal advice.
- [ ] Resolve dependency findings or approve documented reachability/risk decisions. *(Stage 4A re-check: still 13; no safe patch fixes them. Absent from the web standalone output. The worker image excludes the 9 high findings; the 4 moderate drizzle-kit/esbuild findings remain on disk unused. Needs your acceptance.)*
- [ ] Run full tests, types, lint, production build and Docker/Railway smoke tests on the release SHA.
- [ ] Attempt Account A access using Account B through browser and direct HTTP for every object ID/action/export/Google endpoint. Confirm denial; include one admin without customer impersonation.
- [ ] Run hosted PostgreSQL multi-process contention/load tests and an independent security assessment using relevant OWASP guidance.
- [ ] Restore PostgreSQL backup to a different service and rehearse traffic rollback and post-cutover data reconciliation.
- [ ] Configure redacted error monitoring, job failure alerts, CPU/memory/connection alerts, provider quotas and backup-failure alerts; verify delivery. *(Stage 4A: web readiness probe and worker liveness log added; queue metrics and alerts still to build.)*
- [ ] Obtain explicit approval for production infrastructure/traffic changes, with exact target IDs and rollback evidence.
- [ ] Obtain explicit approval before inviting approximately 10–20 real testers. Verify they receive ordinary customer roles.
- [ ] Capture beta feedback on authentication, onboarding, latency, database performance, reports and excessive API usage.
- [ ] Keep unrestricted public registration unavailable. Prepare it only as a separate reviewed change and approval.

There are no payment, subscription, plan, checkout or billing gates in this phase.
