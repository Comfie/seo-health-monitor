# SEO Health Monitor

A multi-user SEO auditing app. Add a website and it does the following:

- crawls up to 25 pages politely;
- runs **54 explicit checks** across technical SEO, on-page SEO, performance, local SEO and conversion readiness;
- measures speed with Google PageSpeed Insights;
- optionally adds real Google search data from Search Console.

Every finding is tied to a URL and its evidence, with the reason it matters, the fix and a priority. Anything that can't be measured is shown as **not verified**, never guessed.

**Live (private beta, invite-only):** https://seo-health-monitor-production.up.railway.app

## Documentation

| Document | Read it for |
| --- | --- |
| [docs/STATUS.md](docs/STATUS.md) | What is live, limits, open work, the cutover record |
| [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) | Features and the audit engine, with diagrams and answers to common questions |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Deploying, configuration, database, backups, monitoring, admin tasks |
| [docs/SECURITY-AND-PRIVACY.md](docs/SECURITY-AND-PRIVACY.md) | Security model, data handling, POPIA position |
| [docs/marketing/](docs/marketing/) | Beta tester recruitment kit |
| [docs/archive/](docs/archive/README.md) | Historical stage reports and evidence (not maintained) |

## Features

- **Audits** run in the background with live progress: crawler, link checks, PageSpeed, Search Console, then analysis.
- **Health score** from five weighted categories, with coverage. A score is marked **provisional** when important parts couldn't be measured.
- **Prioritised findings:** each has evidence, an explanation, exact fix steps, expected benefit, and a *Fix first / Fix next / Plan later* label.
- **Fix with AI:** a copy-paste brief for Claude Code, Cursor, Codex, Copilot or a developer, built only from verified findings.
- **SEO Progress and Compare:** what was fixed, what is new and what is outstanding between scans, with trends.
- **Google Search Console:** clicks, impressions, CTR, position, top queries and pages, and index status. Read-only access, shown separately from the score.
- **Reports:** PDF, CSV, JSON and Markdown tasks.
- **Accounts:** invitation-only sign-up with email verification, sessions, password reset, data export and self-service deletion.
- **Admin:** invitations, account usage and limits, suspension, and an operations dashboard.

## Tech stack

- Next.js 16 (App Router) and React 19 on Node 22
- PostgreSQL 18 with Drizzle ORM, and Better Auth
- A separate background worker; Resend for email
- Deployed on Railway: a web service that auto-deploys from `main`, a worker service and PostgreSQL

## Local development

You need Node.js 22.9 or later, and a PostgreSQL URL (or PGlite for development).

```bash
npm install
cp .env.example .env.local   # fill in the PHASE2_* values; see docs/OPERATIONS.md
npm run dev                  # http://localhost:3000
npm run worker:beta          # in a second terminal, to run audits
```

| Script | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Development server / production build / standalone server |
| `npm test` | Vitest suite (268 tests) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run worker:beta` | Background audit worker |
| `npm run db:saas:generate` | Generate a PostgreSQL migration in `drizzle-saas/` |
| `npm run db:saas:staging migrate` | Apply migrations with the operator login (see [OPERATIONS.md](docs/OPERATIONS.md#database)) |
| `npm run audit:cli -- <url> [--psi]` | Headless audit, without the UI or a database |

## Code map

```
src/proxy.ts                         routing, CSRF and the mapping of old URLs
src/lib/crawler/                     SSRF-safe fetching, robots.txt, sitemaps, HTML extraction, crawl
src/lib/audit/                       54 checks, scoring and coverage, issues and priority, compare, progress
src/lib/performance/                 PageSpeed Insights client
src/lib/integrations/search-console/ Google OAuth and the Search Console API
src/lib/reports/                     action plan, Fix with AI, PDF/CSV/JSON/Markdown
src/lib/saas/                        accounts, tenancy, invitations, queue and worker, limits, admin, exports
src/app/beta/, src/app/api/beta/     customer and admin pages and API
drizzle-saas/                        PostgreSQL migrations
```

## Limitations

- Pages are read from server HTML, with no headless browser.
- 25 pages per audit; external links aren't checked.
- No scheduled scans yet.

Full list: [HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md#limitations).
