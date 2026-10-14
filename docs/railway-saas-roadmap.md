# Architecture decision, costs and SaaS roadmap

Decision: **Option A for the first private deployment**. The existing application is a long-running Node server with durable SQLite audit state, not a serverless-only implementation. No evidence requires a rewrite. Public multi-user access remains disabled and would require Option B plus tenant-aware authorisation first.

## A versus B

| Concern | A: Next.js + SQLite volume + in-process worker | B: web + PostgreSQL + separate worker |
| --- | --- | --- |
| Development effort | Small deployment hardening; this branch | Estimated 3–6 engineer-weeks for persistence and worker migration; additional 4–8 weeks for accounts/isolation and production validation, before billing |
| Monthly operating cost | Roughly $5–15 private beta; measured idle RAM dominates | Roughly $20–60+ at small SaaS scale; three resident processes |
| Reliability | Single service failure affects web and processing; queue survives; brief redeploy outage | Worker failures isolated; web can replicate; database remains single point unless HA is separately configured |
| Persistence | Volume holds DB/WAL/SHM; online logical backup and platform snapshots | PostgreSQL WAL/backups; test PITR/restore separately; DB service is not inherently managed HA |
| Scalability | One instance, 1–2 full audits; bounded queue of 20 | Horizontal web/worker scale, pooled DB, leased jobs, per-tenant fairness |
| Security | Private password gate; single owner; no tenant boundary exists | Tenant IDs, membership checks, scoped data access, worker credentials, optional PostgreSQL RLS |
| Maintenance | Native SQLite module and volume/backup operations | PostgreSQL migrations, pools, leases, monitoring, tenant policies, billing webhooks |
| Migration | No data conversion for first release | SQLite integer timestamps/JSON, sync queries and SQL functions must become PostgreSQL-compatible asynchronous operations |

These effort figures are planning assumptions, not commitments. Audit checks, crawler, report builders and Google fetch client can largely be reused. PostgreSQL requires moving from `sqliteTable` to `pgTable`, integer-millisecond timestamps to an agreed timezone-aware representation, JSON text to jsonb, SQLite auto-increment to identity/sequence, and `.get()/.all()/.run()` sync calls to awaited queries. SQLite `json_insert` progress logging and conflict/claim semantics need replacements. Backfill ID sequences after importing existing numeric IDs. Do not simply point the existing Drizzle driver at DATABASE_URL.

## Cost assumptions and confirmed unit prices

Prices checked 2026-10-14, USD before tax: RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, service egress $0.05/GB. Hobby is $5/month including $5 usage; Pro $20/month including $20 usage. Total is approximately `max(plan minimum, total resource usage)`, not subscription plus the full usage again. Builds are free. [Railway pricing](https://docs.railway.com/pricing/plans).

Volume snapshots are incremental copy-on-write and billed at volume rates. [Railway backups](https://docs.railway.com/volumes/backups). Database operations have no separate per-query line item in this model: their CPU/RAM/I/O contribute to resource usage. Private database/worker traffic avoids unnecessary public egress. [Cost control/private networking](https://docs.railway.com/pricing/cost-control).

The following workloads are ESTIMATES, not benchmarks. Assume 30 days/720 hours, 25 crawled pages/audit, 3 PageSpeed pages × mobile/desktop, 25 GSC inspections/audit when linked, a 3-minute audit using 0.5 vCPU for CPU-equivalent work, and 10 MB of stored report/result data per audit. HTML transfers are bounded but actual DOM memory and retained content vary. Model additional 0.2 GB RAM during each audit (approximately 0.00014–0.014 GB-month across scenarios). No browser/Lighthouse process is hosted locally; Google performs PageSpeed computation. PageSpeed waiting is wall time, not necessarily full CPU use.

| Scenario | App/services average RAM A / B | Baseline CPU A / B | Live volume + incremental backups | Egress | CPU-equivalent audit hours | Estimated A bill | Estimated B bill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1: owner, 2 sites, 10 scans/month | 0.35 / 0.9 GB | .01 / .025 vCPU | .2 + .3 GB | .2 GB | .25 h | $5 minimum; budget $5–10 | about $20 on Pro; $10–20 on Hobby if evaluating privately |
| 2: 20 users, 50 sites, 200 scans/month | .5 / 1.4 GB | .02 / .04 vCPU | 2 + 2 GB | 2 GB | 5 h | about $6–12 usage; $20 minimum if Pro | about $20–35 on Pro |
| 3: 100 customers, 300 sites, 1000 scans/month | .75 / 2.5 GB | .04 / .08 vCPU | 10 + 10 GB | 10 GB | 25 h | about $13–25 usage; $20 minimum if Pro | about $32–60 on Pro |

A point calculation: scenario 1 A ~`3.5 + .2 + .007 + .075 + .01 = $3.79` resources, billed $5 on Hobby. Scenario 2 A ~`5 + .4 + .139 + .6 + .1 + .03 = $6.27`. Scenario 3 A ~`7.5 + .8 + .694 + 3 + .5 + .14 = $12.63`. For B, scenario 1 ~`9 + .5 + .007 + .075 + .01 = $9.59`; scenario 2 ~`14 + .8 + .139 + .6 + .1 + .03 = $15.67`; scenario 3 ~`25 + 1.6 + .694 + 3 + .5 + .14 = $30.93`. Table ranges include uncertain memory, DB overhead and network bursts; real deployments can exceed them. B RAM totals include resident web, worker and PostgreSQL. Storage shown is an initial retained dataset, NOT a constant perpetual footprint. Apply retention/archive policy or storage grows monthly. Raw fetched HTML is mostly incoming traffic, while crawl requests/reports are outgoing; these estimates allow small outbound payloads and report downloads. Backups of changed data accumulate separately.

Scenario 1: A is cheapest and appropriate. Scenario 2: B is recommended because accounts/security require architectural work even if raw A compute remains cheap. Scenario 3: B with quotas/fair scheduling and measured worker sizing; throughput alone at 1000/month does not imply many workers. A's figures at scenarios 2/3 are cost comparisons only, not permission to expose the single-owner application to customers. Keep the beta private until tenant isolation is tested.

### Provider quotas and optional AI

Nominal PageSpeed tests/month: **60 / 1200 / 6000**; worst-case with two retries **180 / 3600 / 18000**. Extra reruns increase these. Quota exhaustion stops remaining jobs per audit; two keyed PageSpeed calls can run concurrently per audit. There is no cross-audit provider token bucket yet. Verify YOUR Cloud project's daily and per-minute quotas and set API restrictions/budget alerts; do not assume a shared/unkeyed quota works. [PageSpeed getting started](https://developers.google.com/speed/docs/insights/v5/get-started). No direct Google API charge is budgeted here; check your own project's enabled products/billing before use.

GSC URL inspections/month: **250 / 5000 / 25000** spread across properties. Per property limit is 2000/day, 600/minute; Search Analytics has additional load/user/project limits. Cache snapshots and use scheduled spreads rather than rescanning all sites simultaneously. [Google limits](https://developers.google.com/webmaster-tools/limits).

Anthropic is separate from Railway. Default Opus 5.5 pricing checked: $4/million input tokens and $20/million output tokens. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). Assume one optional report per scan, 20k input + 4k output tokens: **$0.16/report**, or **$1.60 / $32 / $160** across scenarios. At the current 16k output ceiling, the same input can reach ~$0.40/report before retries/fallbacks. Payload size, actual tokenizer, selected model, fallback routing and regeneration change totals. Leave ANTHROPIC_API_KEY unset for initial beta; local Fix with AI prompt exports cost no provider calls. Set Anthropic workspace budgets/alerts before enabling its key; current app rate limits are not a monthly billing quota.

### Cost controls

Start with concurrency 1, 25 pages, 3 PSI pages, 2 audit submissions per 10 minutes, global 5 per 10 minutes, queue max 20 and RAM/CPU limits 1 GB/1 vCPU. These are burst controls, not a monthly scan allowance. For private beta manually aim for 10 scans/month and inspect usage weekly. Set Railway Compute alert $10 and optional cap $20; hitting cap stops services. Keep the app awake for durable work. Monitor volume free space, retained DB size, queue age, audit duration, retry count, RSS peaks, PSI 429s and provider spend. Future example plans might allow 10/50/200 scans per org/month with maximum pages and limited AI credits, but define commercially after measuring. Reserve quotas atomically before queueing; record consumed/refunded usage and prevent retry double billing.

## Proposed future data model (design only)

| Entity | Key fields and constraints |
| --- | --- |
| users | id, verified_email, external_auth_id/password_hash, status, created_at; email uniqueness, MFA/session revocation |
| organisations | id, name, slug, status, created_by; billing/tenant root |
| memberships | organisation_id + user_id unique, role owner/admin/member/viewer, accepted_at; invite expiry and last-owner protection |
| websites | id, organisation_id, canonical_origin, display_name; uniqueness `(organisation_id, canonical_origin)` instead of global host |
| website_verifications | organisation_id, website_id, method DNS/HTML/GSC, challenge_hash, expires_at, verified_at; proof independent from arbitrary user-supplied URLs |
| audits | id, organisation_id, website_id, requested_by, status, limits_snapshot, attempts, heartbeat, results/progress; tenant + status/time indexes |
| pages/checks/findings/performance | organisation_id, audit_id, stable finding key; composite foreign keys enforce matching tenant, current records retained |
| google_oauth_connections | id, organisation_id, connected_by, provider_subject/email, scopes, encrypted_refresh_token, key_version, expiry/revocation; many accounts per org |
| website_google_properties | organisation_id, website_id, oauth_connection_id, property_uri, permissions; validate property covers website and connection authorisation |
| search_snapshots | organisation_id, website_id, connection_id, optional audit_id, dates, query/page/inspection data; no global token lookup |
| jobs | id, organisation_id, audit_id, type, payload_ref, state, run_after, lease_owner, lease_expiry, attempts, dedup_key; unique tenant-aware idempotency |
| schedules | organisation_id, website_id, timezone, cadence, next_run, enabled, dedup key per schedule/time bucket |
| plans | id/version, price_reference, scan/page/AI limits, retention; immutable entitlements snapshot |
| subscriptions | organisation_id, provider_subscription_id unique, plan_id, state, period_start/end, cancellation; no card data |
| quota_buckets/reservations | organisation_id, period, resource, limit, reserved, consumed; atomic locking, unique job reservation |
| usage_records | organisation_id, job/audit_id, resource, units, timestamp, idempotency_key; append-only ledger for retries/refunds |
| payments | organisation_id, provider_payment_id unique, amount_minor, currency, state; provider-hosted checkout, no PAN/CVC |
| billing_events | provider_event_id unique, organisation_id, signature_verified, received_at, processed_at, retry/error; no raw secrets/card payloads |
| security_events | organisation_id, actor_id, action, resource_ref, outcome, timestamp; redacted audit trail |

## Tenant security boundary

Every repository operation must accept a server-derived `TenantContext { userId, organisationId, roles }`, validate active membership, and filter by organisation ID. Clients cannot supply authority via headers or object IDs. Composite tenant/resource foreign keys prevent linking another customer's site/audit/Google grant. Workers receive only a job ID, claim a tenant-scoped job and load its authorised connection; never accept arbitrary token/property/organisation from queue payloads.

Add PostgreSQL RLS as defence in depth with `SET LOCAL` tenant context inside each transaction and a DB role without BYPASSRLS; pooled connections must never retain a previous tenant's session context. Separate narrowly scoped worker/system roles for schedules and billing. Test repository policies directly, then API/report/download/search/compare/AI endpoints, joins and background jobs with two organisations and malicious guessed IDs. Cache keys and generated artifact paths include tenant; downloads reauthorise every request. Use private object storage and short-lived URLs only after authorisation. No globally cached Google access token: cache by org+connection and expiry. The present `getGoogleAccount()` and global replacement on connect must be removed before multi-user access.

OAuth state binds actor, organisation, connection target and CSRF nonce; require current membership on callback and link actions. Use minimal read-only scopes, envelope encryption or versioned keys, revoke on disconnect, and do not place secrets in logs/provider errors/exports. Rotate encryption with explicit re-encryption; do not silently replace APP_SECRET. Only authorised org admins see billing. Verify webhook signature against raw body, deduplicate events and apply state changes idempotently; never trust checkout redirect as entitlement proof. DNS/socket-time SSRF defenses remain mandatory in workers, including Railway private networking/metadata IPv4/IPv6 and redirect hops. Site verification, bounded crawls, per-host pacing and quotas reduce abuse.

## Incremental migration plan

1. Deploy private A, complete Linux/container and Railway restore drill, establish baseline memory/CPU/provider quotas. Keep owner gate.
2. Introduce a repository boundary around DB operations with explicit async contracts; keep the audit engine's input/result types. Add PostgreSQL schema/migrations and durable job claim tests. Avoid editing all audit checks.
3. Export SQLite via online snapshot, run an offline transformation into a NEW PostgreSQL staging DB, preserve IDs/relationships, map dates/booleans/JSON, verify row counts/FKs/result comparisons, set sequences, and test refresh-token decryption with the existing secret. Do not decrypt tokens into export files. Retain the original SQLite snapshot.
4. Create web + PostgreSQL + worker services in one Railway environment/region. Use private DATABASE_URL reference variables, no public database endpoint unless temporarily required for an authorised import. Do not share a SQLite volume between services. Cap connection pools per process. Web only enqueues; worker only processes. Disable web worker via an explicit runtime mode introduced in that phase.
5. Extract the existing runner unchanged behind an `audit_jobs` loop. PostgreSQL claims use row locks/`FOR UPDATE SKIP LOCKED`, lease ownership, heartbeats and bounded exponential backoff. Fence writes with lease owner/version so a stalled old worker cannot commit after re-lease. Commit completion transactionally; unique dedup keys and usage reservations prevent duplicates and double charging. Introduce per-tenant fairness and per-host/provider throttles. Redis is unnecessary initially; add only after measured need.
6. Add users/orgs/memberships, assign existing data to an owner organisation, migrate global host/account semantics, and scope all reads/writes/caches/exports. Test adversarial cross-tenant access before any signup. Roll out an invite-only cohort with verified sites, plan entitlements and scan reservations.
7. Add scheduler and usage metering, then externally hosted payment flow and idempotent billing events after separate approval. Public registration/payments are a later release gate; no implementation in this branch.
8. Freeze new audits for cutover, wait/drain current jobs, final SQLite snapshot/import, verify staging checks, switch services, monitor. Avoid dual writing initially. Rollback means owner-gated SQLite plus an explicit reconciliation plan for any PostgreSQL-only post-cutover records; code rollback alone cannot reverse data migration.

Capacity gates: move before sharing owner credentials or offering public accounts; also move when web availability needs independent worker restarts, queues routinely saturate, write contention or multiple worker replicas are needed. At least one restore drill and tenant security review precede commercial launch.
