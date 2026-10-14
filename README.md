# SEO Health Monitor

A self-hosted SEO monitoring app. It audits any public website, with up to 25 pages and 50+ explicit checks across technical SEO, on-page SEO, performance, local SEO and conversion readiness. Every finding is tied to a URL and the evidence collected. It tracks real Google search performance through Search Console and shows whether things improve between audits.

Nothing is mocked. Findings come from real HTTP responses, HTML, robots.txt, sitemaps, Google PageSpeed Insights and Google Search Console. Anything that can't be measured is shown as **not verified**: it's excluded from scores, and the score is labelled **provisional** when important parts are missing.

## Quick start (local)

Requirements: Node.js ≥ 22.9, npm.

```bash
npm install
cp .env.example .env.local   # add keys as needed (see Configuration)
npm run dev                  # http://localhost:3000
```

In development, if `AUTH_PASSWORD` is empty the app runs without sign-in. The SQLite database is created at `./data/seo-health.db`, and migrations run automatically.

## Configuration

All configuration comes from environment variables, documented in [`.env.example`](.env.example). Keys are never stored in the database or sent to the browser.

| Variable | Needed for | Notes |
| --- | --- | --- |
| `APP_SECRET` | Sign-in, Search Console | 32+ random characters (`openssl rand -base64 32`). Signs sessions and OAuth state, and encrypts the Google refresh token. |
| `AUTH_PASSWORD` | Production | Owner password, 12+ characters. Production refuses to serve data without it, unless `AUTH_DISABLED=true` behind your own SSO proxy. |
| `APP_URL` | Search Console, deployment | Public base URL. The OAuth redirect URI is `${APP_URL}/api/integrations/google/callback`. |
| `TRUST_PROXY` | Deployment behind a proxy | Number of reverse proxies adding `X-Forwarded-For`, used for per-client rate limits. |
| `PAGESPEED_API_KEY` | Performance category | A free key from Google Cloud with the **PageSpeed Insights API** enabled. Without it Google's anonymous quota usually returns HTTP 429. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Search Console | OAuth web client; step-by-step setup in [docs/search-console.md](docs/search-console.md). |
| `ANTHROPIC_API_KEY` | AI consultant (optional) | Default model `claude-opus-5-5` (`AI_MODEL`). |

## Features

- **Audits**: a polite, SSRF-safe crawler (respects robots.txt, uses sitemaps and internal links) feeding 50+ checks, each with evidence, an explanation, the exact fix, implementation guidance, expected benefit and priority.
- **On-site SEO health score**: weighted from explicit checks (methodology in Settings). It shows **audit coverage**, the share of the scoring model actually measured, and is marked **provisional** when coverage is under 90% or a major category (weighted 15% or more) wasn't measured.
- **Google search performance** (Search Console): real clicks, impressions, CTR, average position, top queries, top landing pages and URL-inspection index status. Shown separately from the on-site score and never estimated.
- **PageSpeed Insights**: mobile and desktop lab and field metrics with Lighthouse diagnostics. The API key is sent as a header. 429s are retried with backoff that honours `Retry-After`, and further calls stop once the quota is exhausted. **Re-run PageSpeed tests** re-measures an existing audit and recomputes its scores.
- **Fix with Claude**: a ready-to-paste prompt for Claude Code built only from verified findings. It includes the detected platform (for example Astro, Next.js or WordPress) with where to look, exact URLs and evidence, guardrails, acceptance criteria and a verification command per task. Available for the whole plan or a single task. Lower-confidence findings are excluded unless you opt in.
- **SEO Progress**: on-site health, technical score, detected issues (fixed, new, outstanding) and Search Console metrics between audits, with trend charts. Coverage changes are flagged so a newly measured category isn't mistaken for improvement.
- **Reports**: PDF, JSON, CSV and Markdown developer tasks, plus a printable report with Developer Fix Instructions.
- **Compare**: any two scans of a site, with issues matched by deterministic IDs.

## Deployment

Built for a single instance with a persistent disk. A Dockerfile and docker-compose file are included. See **[docs/deployment.md](docs/deployment.md)** for requirements, Docker and Node options, the TLS reverse proxy, backups and the pre-launch checklist. The security model and tests are in **[docs/security.md](docs/security.md)**.

```bash
npm run build && npm start     # production server (loads .env.production / .env.local)
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / standalone server |
| `npm test` | Vitest suite (crawler safety, checks, scoring, compare, PageSpeed, Search Console, Fix with Claude, auth/CSRF/rate limits/queue) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:generate` / `npm run db:migrate` | Create / apply Drizzle migrations |
| `npm run db:backup` | Consistent online backup of the SQLite database |
| `npm run audit:cli -- <url> [--psi]` | Headless audit without the UI or database |

## Architecture

```
src/proxy.ts                  auth + CSRF enforcement for pages and API routes
src/instrumentation.ts        starts the background audit worker
src/lib/crawler/              SSRF-safe HTTP client, robots, sitemaps, extraction (incl. platform detection), crawl
src/lib/audit/                checks/*, scoring + coverage, issue IDs/priority, queue (jobs), runner, compare, progress
src/lib/performance/          PageSpeed client (retry/backoff) and job runner (quota circuit breaker)
src/lib/integrations/search-console/  OAuth + Search Console API client, encrypted token storage, snapshots
src/lib/reports/              action plan, Fix with Claude prompt, CSV/JSON/PDF
src/lib/security/             crypto (AES-GCM, HKDF, HMAC, PKCE), auth, route guard
src/lib/rate-limit.ts         SQLite-backed rate limits
src/app/(app)/                dashboard and feature pages (sidebar layout)
src/app/login, src/app/api/   sign-in page and API routes
drizzle/                      SQL migrations
```

## Known limitations

- **JavaScript-rendered sites**: content is read from the server HTML. Pages that look JavaScript-rendered are flagged and their content findings marked low-confidence. There's no headless-browser fallback.
- **Crawl scope**: 25 pages per audit (configurable up to 100), and up to 60 extra internal links status-checked. External links aren't checked.
- **PageSpeed**: lab results vary between runs, and field data (INP) exists only for sites with enough Chrome traffic.
- **Search Console**: data lags 2–3 days. Snapshots are 28-day windows that may overlap. While the OAuth consent screen is in "Testing", Google expires the connection after 7 days.
- **Local SEO**: address and place detection is heuristic. Google Business Profile, reviews, citations and rankings need external data and are shown as not verified.
- **Single instance**: SQLite and the in-process worker mean one replica only. An audit interrupted by a crash is retried automatically about 90 seconds after restart.
- **Scheduling**: scans are started manually or through the API; there are no recurring scheduled scans yet.
