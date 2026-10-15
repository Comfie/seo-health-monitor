# Legacy route audit (Stage 2)

Recorded 14 October 2026 on `phase2-multiuser`. Every Phase 1 page and API route below reads or writes the **global** SQLite database, the process-wide audit queue, or the single global Google connection. None of them is tenant-aware.

## How customer sessions are kept out

- Phase 1 routes accept only the owner cookie `shm_session` (signed with `AUTH_PASSWORD`/`APP_SECRET`), checked in `src/proxy.ts` and again by `guard()` inside API handlers. A beta session (`shm_beta.session_token`) is a different cookie with a different secret. It never satisfies these checks: customers are redirected to `/login` or receive 401. Covered by `tests/beta-config.test.ts`.
- The beta refuses to start if `AUTH_DISABLED=true`, or in production without `AUTH_PASSWORD`. Either setting would make the global routes reachable without the owner password.
- Beta navigation (`NAV_VARIANTS.beta`) links only to `/beta`, `/beta/websites`, `/beta/account` and, for administrators, `/beta/admin`. The beta not-found page links back to `/beta`, never to Phase 1 pages.
- No beta module imports `@/lib/db`, the audit repository/views/queue/runner, the Search Console service, the SQLite rate limiter or the AI consultant. An automated source scan fails the test suite if one does.

**Local development caveat:** with no `AUTH_PASSWORD` outside production, Phase 1 runs in `open-dev` mode and its routes are open to anyone who can reach the dev server, including a browser holding a beta session. Run beta development with `AUTH_PASSWORD` set, as the browser verification in this stage did.

## Routes still on global data (disabled for customers)

| Area | Routes | Global dependency | Migration needed before customers |
| --- | --- | --- | --- |
| Dashboard and findings | `/`, `/technical`, `/on-page`, `/performance`, `/local`, `/recommendations` | `audit/repository`, `audit/views`, Search Console service | Tenant-scoped audit reads (`tenantRepository.getAudit`/`exportAudit` exist); port views |
| Audit history and comparison | `/audits`, `/audits/[id]`, `/audits/compare`, `/progress` | `audit/repository` | Tenant-scoped listing/compare |
| New audit and reruns | `/audits/new`, `POST /api/audits`, `/api/audits/[id]` (GET/DELETE), `/api/audits/[id]/performance` | `audit/queue` (in-process SQLite worker), SQLite limiter | PostgreSQL runner with leases/fencing, global limits; `enqueueAudit` admission exists |
| Reports and exports | `/reports`, `/audits/[id]/report`, `/api/audits/[id]/export` | `audit/repository`, report generators | Generators fed from tenant `exportAudit` |
| Fix with AI and AI review | `/fix`, `/api/audits/[id]/fix`, `/api/audits/[id]/ai` | `audit/repository`, AI consultant, SQLite limiter | Tenant reads plus per-tenant AI budgets |
| Google Search Console | `/search-console`, `/api/integrations/google/*`, `/api/sites/[id]/search-console*` | Single global Google account, process-wide token cache | Tenant-bound OAuth state, grants, cache keys and property checks |
| Settings | `/settings` | Global audit count, global Google account | Per-account settings |
| Owner auth and health | `/login`, `/api/auth/*`, `/api/health` | Owner password; SQLite readiness | Unchanged (owner/infra only) |

## Migrated to tenant-aware PostgreSQL in this stage

| Customer surface | Routes | Data access |
| --- | --- | --- |
| Authentication | `/beta/login`, `/beta/register`, `/beta/forgot-password`, `/beta/reset-password`, `/api/beta/register`, `/api/beta/auth/*` (allowlisted endpoints) | Better Auth over PostgreSQL; invitation tokens |
| Dashboard | `/beta` | `tenantRepository.dashboard()` |
| Websites | `/beta/websites`, `/api/beta/websites`, `/api/beta/websites/[id]` | `tenantRepository` add/get/rename/remove |
| Account | `/beta/account`, `/api/beta/account/sessions/[id]` | Library session/user tables, own rows only |
| Administration | `/beta/admin`, `/api/beta/admin/invitations`, `/api/beta/admin/invitations/[id]` | Invitations table; administrator grant checked per request |

## Migrated in Stage 3

The customer equivalents of the Phase 1 audit, report and Fix with AI routes now exist on tenant-scoped PostgreSQL. The Phase 1 routes themselves are unchanged and still refuse beta sessions.

| Phase 1 surface | Customer equivalent | Data access |
| --- | --- | --- |
| `/audits/new`, `POST /api/audits` | Run audit on `/beta`, `/beta/websites`; `POST /api/beta/audits` | `customerAudits().start` → `enqueueAudit` (quotas, global admission) → `background_jobs` |
| `/audits/[id]`, `GET /api/audits/[id]` (progress) | `/beta/audits/[id]`; `GET /api/beta/audits/[id]` | `customerAudits().status` |
| Cancel (no Phase 1 equivalent) | `POST /api/beta/audits/[id]/cancel` | `requestCancel` (fenced) |
| `/`, `/technical`, `/on-page`, `/performance`, `/local`, `/recommendations` | `/beta/audits/[id]`, `/beta/audits/[id]/findings?category=`; `GET /api/beta/audits/[id]/findings` | `customerAudits().full` / `findings` |
| `/audits`, `/audits/compare` | `/beta/audits`, `/beta/audits/compare`; `GET /api/beta/audits`, `GET /api/beta/audits/compare` | `history`, `compare` (same website, both owned) |
| `/api/audits/[id]/export` | `GET /api/beta/audits/[id]/export` | Shared generators fed by `full()` without `tenant_id` |
| `/fix`, `/api/audits/[id]/fix` | `/beta/audits/[id]/fix`; `GET /api/beta/audits/[id]/fix` | Shared Fix with AI generator |
| `/api/audits/[id]/performance` | `POST /api/beta/audits/[id]/pagespeed` | Queued `pagespeed` job, per-test budget |
| `/api/audits/[id]/ai` | `POST /api/beta/audits/[id]/ai` | Stateless consultant + tenant AI budget |

Still global-only and unavailable to customers: Search Console (`/search-console`, `/api/integrations/google/*`, `/api/sites/[id]/search-console*`), `/progress` (Search Console trends) and `/settings`. The static import guard now ignores type-only imports and allows the stateless AI consultant. It additionally checks that the shared modules beta code imports (pipeline, report generators, PageSpeed runner, crawler, consultant) do not reach global data.
