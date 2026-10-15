# Project status

**Last updated:** 15 October 2026  
**Stage:** private beta. The multi-user app is live and invite-only, with one administrator (the owner) and testers by invitation. There are no payments or public sign-up.

## What is live

| Item | Value |
| --- | --- |
| URL | https://seo-health-monitor-production.up.railway.app |
| Code | `main` on GitHub (`Comfie/seo-health-monitor`). This is the only branch. |
| Web service | Railway `seo-health-monitor`, EU West (`europe-west4`). It **deploys automatically on every push to `main`** using `Dockerfile`, with the health check at `/api/health`. |
| Worker service | Railway `seo-worker`, EU West, 1 replica. It **also deploys automatically from `main`**, using `Dockerfile.worker` (set in the service's build settings). |
| Database | One PostgreSQL 18 service (`Postgres`, EU West), database `railway`, schema migrations `0000`–`0004`. |
| App database login | `seo_app`: reads and writes rows only. It can't change the schema, isn't a superuser and has no access to other databases. Used by both services since 15 October. |
| Accounts | The owner (`comfynyatsine@gmail.com`) is the only administrator. Everyone else joins by invitation. |
| Email | Resend, sent from `SEO Health Monitor <seo-beta@dominiondesk.com>`. Invitations go to any address an administrator enters. |
| Google | The existing OAuth client and PageSpeed key are reused. The Search Console callback is `https://seo-health-monitor-production.up.railway.app/api/integrations/google/callback`. |
| AI consultant | **On since 15 October.** Uses Claude Sonnet 5.5 (`AI_MODEL=claude-sonnet-5-5`) on the web service only; the worker never calls AI. A live test report cost about $0.05 (Anthropic Console). **Fix with AI** is separate: it produces instructions and never calls a model. |

### Limits per tester account (code defaults)

| Limit | Value |
| --- | --- |
| Websites | 2 |
| Audits per month | 5 |
| Pages per audit | 25 |
| Audits running at once | 1 |
| PageSpeed tests per month | 60. Each audit tests 3 pages on mobile and desktop, so 6 per audit. |
| AI reports per month | 5. Each audit gets one report (no regenerating); viewing it again is free, and a failed generation is refunded. |

The whole system runs at most 2 audits at once, queues up to 50, allows 400 PageSpeed tests a day, and caps AI spend at **$1 a day** across all accounts (`PHASE2_GLOBAL_AI_USD_PER_DAY`), roughly 20 reports at about $0.05 each. Each report's real cost is calculated from the tokens it used; a report being written counts as $0.10 until it finishes, so a new one starts only while at least $0.10 of the day's budget is left. Admin → Operations shows today's AI spend. Administrators can override limits per account under **Admin**.

## Before inviting testers widely

1. **Google OAuth consent screen.** In Google Cloud Console → OAuth consent screen, check the publishing status.
   - While it is *Testing*, only Google accounts added as **test users** (maximum 100) can connect Search Console, and connections expire after 7 days.
   - Either add each tester's Google account, or publish the app. The read-only Search Console scope may need Google verification.
2. **Backups.** None run automatically. Take a `pg_dump` before every schema change and at least weekly until scheduled backups exist ([OPERATIONS.md](OPERATIONS.md#backups-and-restore)).
3. **Monitoring.** No uptime check or alert delivery is set up. Add an external check of `/api/health` every minute, and watch **Admin → Operations**.

## Later

- Send email from the product's own domain instead of `dominiondesk.com`.
- Set a monthly spending limit and alerts in the Anthropic Console. The app's caps limit report counts, not dollars.
- Retention clean-up is built but switched off pending a policy decision.
- Development dependencies: `npm audit` flagged development-only advisories (October 2026). Review them before a public launch.
- Have the Privacy Policy, Terms of Use and data-use pages reviewed by a lawyer before a public launch. They were rewritten for testers on 15 October; the contact is comfynyatsine@gmail.com.
- Product gaps: no scheduled or recurring scans, no headless-browser rendering for JavaScript-only sites, no team accounts, no billing (see [HOW-IT-WORKS.md](HOW-IT-WORKS.md#limitations)).

## Cutover record: 15 October 2026

The original single-owner app (SQLite and a shared password) was replaced by the multi-user app at the same URL. The owner approved a revised plan:

| Step | Outcome |
| --- | --- |
| No data import | The old app had no meaningful data, so nothing was migrated from SQLite. |
| Fresh start | A `pg_dump` was saved to `~/secure/backups/pg-railway-before-fresh-start-20261015T113618Z.sql`. All beta test users, accounts and data were deleted; only the owner's account and administrator role were kept. |
| Configuration | The unified settings were copied from beta, the origin was set to the live URL, and invitations were enabled (invite-only, no recipient allow-list). |
| Deploy 1 failed | Rewrites were proxied through the public URL, which still served the old app during the health check. Fixed in `339fe1e`: rewrites now stay on the receiving server. |
| Deploy 2 | Passed. The owner confirmed login and invitations. |
| Clean-up | The worker was pointed at the live site, moved to the EU and renamed `seo-worker`. The `seo-beta-web` service was deleted. The SQLite volume and beta volume were deleted (recoverable until 17 Oct 12:10 UTC). |
| Outage, about 10 minutes | Removing `DATABASE_PATH` made Railway rebuild from the GitHub branch, which still held the old app. That build needed the deleted volume and crashed. Fixed by redeploying and moving the deploy branch to the new code. |
| Branches | Everything was merged into `main` (`f2040bd`), Railway was switched to deploy from `main`, and all other branches were deleted. |
| Hardening | The restricted `seo_app` database login was created, verified and switched on for both services. Beta's leftover limits were removed, so 25 pages per audit and 400 PageSpeed tests a day now apply. The hosting region on the privacy page was corrected. |

**Lesson:** Railway rebuilds from the connected branch on *any* variable or volume change, so keep the deployed branch matching what is live.

**Rollback:** there is no path back to the old app. Its data volume was deleted at the owner's request. Recovery means restoring PostgreSQL ([OPERATIONS.md](OPERATIONS.md#backups-and-restore)).

## History

Earlier stage reports, staging notes and test evidence are in [`archive/`](archive/README.md).
