# G6 local verification evidence

15 October 2026, uncommitted working tree on `phase2-multiuser`, baseline `04d8ca0fa3728ab175d483f1a37c187fc0dd3ad3`. No G6 hosted release or hosted G6 test claim. G5's 71/71 hosted regressions and multi-worker tests are preserved in the G5 report.

| Check | Final result |
| --- | --- |
| `npm test` | **261 passed, 20 files**. All 239 G5 baseline tests retained. Added 18 administration/lifecycle/retention cases and four backup/migration/reconciliation cases. Account deletion preserves anonymous global cost counters; no quota reset through erasure. Existing provider tests additionally prove skipped quota reservations are not API failures. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed without warnings. |
| Production build | Passed with the repository's exact Next.js configuration in an isolated source copy with physical dependencies, no `.env.local` and no real database. All new APIs are dynamic/request-time. Workspace attempts failed at a Turbopack internal local-port bind; the isolated build avoids that environment problem. An earlier scratch root override was removed before the final build. |
| Phase 1 standalone smoke | Passed from the isolated normal-layout build: readiness, login/cookie, denial, CSRF, SSRF, duplicate admission, PDF/CSV/JSON/Markdown, Fix instructions, graceful restart/persistence, queued/interrupted recovery and local SQLite backup/restore. This is not a Phase 1 production backup. |
| Worker bundle | **264,803 bytes (258.6 KiB)**; only runtime external imports. No SQLite/PGlite/tsx/drizzle-kit/esbuild/shadcn import. Actual Linux image build waits for approved deployment. |
| Standalone trace | `pg` present; PGlite, tsx, braces, fast-glob, drizzle-kit, esbuild and shadcn absent. Final worker production-image dependency risk remains documented separately. |
| Existing staging backup | Independent restore into isolated PGlite with the pre-G5 migrations: **23 tables verified, zero mismatches, FKs enforced throughout**. Source directory mode 0700; all 24 files have no group/other permissions. Original plaintext backup needs encryption before off-site storage and lacks sequence state. |
| New backups | Synthetic 28-table full schema/migration coverage, fingerprints, wrong-key/tamper rejection, sequence state and next identity value, foreign keys during insertion, mismatched schema/nonempty target refusal, newer deletion-ledger reconciliation protecting another tenant. |
| Migration 0004 | Populated G5 migration test preserves every pre-existing public table byte-for-byte; only three new tables added. Not applied to staging. G5 migration test still isolates exactly 0003. |
| Secret scan | Candidate tracked changes + nonignored untracked files scanned for known private `.env.local` values and credential patterns: **zero hits**. Evidence count is recorded in the scan JSON. Scan the complete release archive again before approved deployment. |
| SQLite preservation | SHA-256 of local `.db`, `-wal`, `-shm` unchanged across G6 checks. |
| Dependency audit | Live npm advisory query: **13 findings (9 high, 4 moderate, 0 critical)**, unchanged baseline. Reachability and approval gates in the security review; no unsafe forced downgrade or new G6 dependency. |
| Final staging readback | One running beta worker; same G5 images; original quota fields restored; global PageSpeed 40/day, five-page scans and worker concurrency one. Google/PageSpeed credentials unconfigured. Beta and Phase 1 health 200. No G6 deployment. |

## Browser evidence

An isolated Next development copy, local PGlite, log-only mail and disposable synthetic `example.com` accounts were used. No real email or Google request. Chrome at desktop 1440×1050 and mobile 390×844 verified:

- Public draft privacy/terms/data-use pages without login.
- Administrator counts, bounded quota save/removal, operational health/queue/failure/resource views.
- Mobile account controls without horizontal overflow; password-confirmed account JSON download belongs to Alice and excludes her password.
- Customer guessing `/beta/admin` receives a streamed not-found UI with no admin data. The HTML status is 200 as documented by this Next version; API denial tests return 404.
- Unconfigured Search Console shows unavailable/not-verified, with no fabricated data.
- Disposable browser account deletion completes, redirects to sign-in and displays the deletion confirmation.

The initial walkthrough found a server/browser date-locale hydration mismatch in the new admin list. It was fixed with stable date formatting; override forms now also remount after saved values change. **Follow-up: 13/13 checks passed, with no page errors.** The two deletion checks had passed before the follow-up; that disposable identity remained erased and was not recreated. [Structured evidence](evidence/g6/browser-walkthrough.json).

Screenshots: [admin desktop](evidence/g6/admin-desktop.png), [monitoring desktop](evidence/g6/monitor-desktop.png), [account mobile](evidence/g6/account-mobile.png). These show synthetic accounts only.

## Hosted work still required

Approval is required for fresh backup/migration/deployment, then G6 hosted A/B/admin isolation/export and disposable deletion (including concurrent worker claims/completion), G4/G5 regressions, monitoring delivery and full environment restore. Current G6 PostgreSQL-engine concurrency tests run in PGlite; they do not replace a multi-process hosted PostgreSQL race test. Keep evidence separate. Never delete the existing staging administrator or A/B accounts to run lifecycle tests.

The earlier pre-G5 backup is verified for its historical snapshot only; obtain a new post-G5 backup before migration. Phase 1 production-volume SQLite restore verification remains a separate release blocker. Live Google OAuth/Search Console and successful PageSpeed API measurements remain deferred and unverified.
