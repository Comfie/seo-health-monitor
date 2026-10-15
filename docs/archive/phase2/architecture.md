# Architecture report

## Existing deployed system

Next.js 16.4/React 19, standalone Docker output, one Railway web process with a persistent SQLite volume. Drizzle's SQLite driver runs migrations on first open. The runtime validates its Railway volume, starts an in-process database-backed audit queue and stops admissions on shutdown. Audit claims are conditional updates with heartbeat recovery and bounded attempts. This is appropriate for its existing private single-instance deployment, not distributed tenant workloads.

Authentication is a shared `AUTH_PASSWORD` and signed `shm_session` cookie. It has no user identity, membership, verified email or per-session database revocation. Site hosts are globally unique. Audit/report pages query global repositories. Search Console stores a global Google account and process-wide token cache, replacing previous grants on connection. These must all change together before customer access.

The existing crawler validates URLs/redirects, checks destination IPs at connection time, bounds responses and timeouts, and honours robots. Its implementation is untouched in this stage. Fix with AI/export generators and all existing Phase 1 pages are retained.

## Implemented foundation

`src/lib/saas/` is an isolated server-only package. No automatic environment switch, SQLite fallback, database migration or worker starts when these modules are imported.

| Layer | Design and reason |
| --- | --- |
| Identity | Better Auth 1.7.7 with its maintained Drizzle adapter; library scrypt hashing, verification/recovery, persisted sessions and rate limits. [Adapter documentation](https://better-auth.com/docs/adapters/drizzle), [configuration](https://better-auth.com/docs/reference/options). |
| Auth configuration | Canonical HTTPS origin, distinct random auth secret and `shm_beta` cookies. Verification required; automatic signin and identity-provider linking disabled. Registration defaults closed; only an explicit invite-only configuration is supported in this stage. |
| Sessions | Seven-day expiry, one-day update interval, fifteen-minute freshness setting; database revalidation instead of cookie caching. Recovery revokes sessions. Freshness must be enforced explicitly by future sensitive application actions. |
| Authorisation | `requireTenant()` derives an immutable context from a verified library session. Personal account provisioning consumes a valid email-bound invitation transactionally. Every repository operation checks active membership/suspension and filters tenant IDs. |
| PostgreSQL | Separate explicit connection pool, max five connections, bounded connection timeout. Timestamp-with-time-zone and jsonb replace SQLite timestamp integers and JSON text. |
| Tenant model | Personal accounts now; membership table supports later teams. Administrator grants live in a separate table; personal-account owner role never means system administrator. |
| Referential isolation | Every domain table has a non-null tenant key. Composite foreign keys bind sites, audits, findings, performance and Google records to the same tenant. Host uniqueness is per tenant, so customers can independently audit the same public domain. |
| Operational limits | Two websites, five audits per UTC calendar month, 25 pages and one active audit by default. Tenant-row locks serialize website creation and audit admission. Usage survives website/audit deletion to prevent quota resets. Page limit is snapshotted in audit metadata; the new worker still needs to enforce it. |
| Import | Read-only standalone source backup, empty destination domain, explicit administrator ownership, transactional inserts/count checks, preserved IDs and ciphertext, identity advancement and source checksum ledger. |

No runtime PostgreSQL RLS policy is claimed. Application checks and composite keys are implemented first. Add transaction-local tenant RLS only with a separate non-owner, non-BYPASSRLS runtime role and tests for pooled-connection context reset; never rely on RLS instead of repository checks.

The staging operator connection can migrate schemas and grant the initial administrator. The eventual runtime role must not be able to update the administrator table, modify schemas or bypass future RLS. The staging confirmation flag reduces operator mistakes; a typed hostname cannot prove that a database is staging. Independently verify Railway environment/service IDs and use separate credentials.

## Integration requirements

All pages, reports, exports, comparisons, AI actions, Google routes and the CLI must move to an asynchronous tenant-aware service interface. A legacy shared-password session must never be converted into an arbitrary customer tenant, and a customer session must never authorise legacy global queries.

The present PostgreSQL repository covers websites, audit reads/exports, snapshots and atomic admission. Background jobs have durable schema, but distributed execution/recovery is **not implemented**. Admission does not yet enforce global queue/resource limits; do not start a tenant-facing scanner until those limits and the PostgreSQL runner exist. Queue records must carry tenant/audit identity and lease tokens; completion writes must reject expired leases to prevent an interrupted worker overwriting a retry.

OAuth must use Search Console read-only scopes, bind state to user + tenant + target + nonce, validate current membership on callback, and select grants by tenant + connection + actor. Access-token caches must include those keys. Adding a website is permission to store that customer's public audit target, not proof of domain ownership. Owner-only Google features must use actual authorised properties.

No subscriptions, plans, checkout, payment provider, billing tables or entitlement restrictions are included. Quotas are operational safety settings.

## Stage 2 customer surface

The beta runs inside the same Next.js app but on a separate path and cookie, and touches PostgreSQL only:

| Piece | Location | Notes |
| --- | --- | --- |
| Feature gate and config | `src/lib/saas/config.ts` | `PHASE2_ENABLED`; refuses unsafe combinations (see ledger) |
| Runtime | `src/lib/saas/server.ts` | Lazily builds one pool/auth/mailer per config; `withCustomer()` applies the gate, canonical-Origin CSRF check and session-derived tenant to every API |
| Pages | `src/app/beta/(auth)`, `src/app/beta/(customer)` | `getCustomerPage()` (React `cache`) derives tenant per request; layout picks the beta or beta-admin navigation |
| Auth HTTP | `/api/beta/auth/*` | Better Auth behind a per-method endpoint allowlist; no sign-up, session-listing or token-returning endpoints |
| Registration | `src/lib/saas/registration.ts`, `invitations.ts` | Atomic token claim, then library sign-up; the before-hook requires a claimed invitation |
| Provisioning | `provisionPersonalTenant()` in `tenant.ts` | Runs on email verification and lazily in `requireTenant()` |
| Email | `src/lib/saas/email.ts` | Resend HTTP API; recipient allowlist for staging |
| Proxy | `src/proxy.ts` | Beta paths skip the owner check only when enabled; signed-out beta pages go to `/beta/login` |

Phase 1 continues to use its own SQLite repositories and owner cookie. The two identity systems never convert into each other.

## Stage 3 audit engine

```
browser ──► /api/beta/audits (withCustomer: gate, Origin, session → tenant)
              │ enqueueAudit: tenant row lock → per-account quotas → advisory lock → global queue limit
              ▼
        audits + background_jobs (+ usage_records ledger)
              ▲ claim: advisory lock, global running + per-tenant concurrency, fence+1, new lease token
worker(s) ────┘ heartbeat (extends lease, sees cancel) · fenced progress · fenced completion transaction
   │
   └─ crawler (unchanged SSRF/robots/limits, + AbortSignal) → pipeline.analyseAudit → PageSpeed (budget per test)
```

| Concern | Mechanism |
| --- | --- |
| No double execution | Advisory-locked claim; conditional `queued → running` update on the previous fence |
| Stale workers | Every write requires `(job id, tenant, fence, lease token, state = running)`; completion locks that row `FOR UPDATE` in the result transaction |
| Crash recovery | Expired leases are requeued with backoff (or failed after `max_attempts`, or cancelled if requested); any worker may run recovery |
| Idempotency | Results are written only in the completion transaction, which first deletes any rows for the audit; a completed job can't be claimed |
| Trusted identity | The worker's tenant comes from the job row; all reads and writes filter by it, and composite foreign keys prevent cross-tenant rows |
| Budgets | `usage_records(kind, units)`: account monthly counts under the tenant row lock; global daily counts under per-kind advisory locks |
| Settings | `readLimitSettings()` (environment) with nullable tenant overrides; global limits are not overridable per account |
| Hosting | `PHASE2_WORKER=in-process` (instrumentation) or `npm run worker:beta` processes; neither is configured in production |
