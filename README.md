# SEO Health Monitor

A self-hosted SEO auditing app. Enter any public website and it crawls up to 25 pages, runs over 50 explicit checks across technical SEO, on-page SEO, performance, local SEO and conversion readiness, then produces evidence-based findings tied to specific URLs, a prioritised action plan, developer fix instructions and exports. Every scan is stored so you can compare scans over time.

Nothing is mocked. Every finding comes from real HTTP responses, real HTML, real robots.txt and sitemaps, and real Google PageSpeed Insights results. Anything that can't be measured is shown as **not verified** and excluded from the scores.

## Quick start

Requirements: Node.js 20.9+ (tested on 22), npm.

```bash
npm install
cp .env.example .env.local      # optional: add API keys (see below)
npm run dev                     # http://localhost:3000
```

The SQLite database is created at `./data/seo-health.db`, and migrations run automatically on first use. To apply them manually, run `npm run db:migrate`.

Production build:

```bash
npm run build && npm start
```

## API keys (all optional)

| Variable | Used for | Without it |
| --- | --- | --- |
| `PAGESPEED_API_KEY` | Google PageSpeed Insights (Lighthouse lab data plus Chrome UX Report field data) for mobile and desktop | Google allows very few anonymous calls (usually HTTP 429). Performance checks show as **not verified**, and the overall score is calculated from the other categories. |
| `ANTHROPIC_API_KEY` | AI SEO Consultant: a plain-English review written only from measured findings (model set by `AI_MODEL`, default `claude-opus-5-5`) | The button explains how to enable it. Everything else works. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Reserved for the planned Search Console integration | — |

To get a PageSpeed key, go to Google Cloud Console, enable the **PageSpeed Insights API**, then Credentials → Create API key. It's free.

Crawler and rate-limit settings are documented in `.env.example`.

## Using it

1. **New Audit**: enter a URL, for example `https://urgencyboreholes.co.za/`. Progress streams live; a typical audit takes 1–4 minutes with PageSpeed enabled.
2. **Dashboard**: overall score, category scores, critical issues, warnings, passing checks, pages scanned, last scan date, and the top fixes.
3. **Technical / On-Page / Performance / Local SEO**: every check with its status, score and weight. Each expands to per-URL issues with evidence, why it matters, the fix, how to implement it, the expected benefit and the priority. Raw crawl facts and per-page tables are included. Conversion readiness is on the Local SEO page.
4. **Recommendations**: the prioritised action plan ("Fix first / Fix next / Plan later"), filterable by severity and area, plus the optional AI consultant.
5. **Reports**: export PDF, JSON, CSV or a Markdown task list, or **copy the developer tasks** straight into Claude Code. The detailed report page includes a dedicated **Developer Fix Instructions** section and is printable.
6. **Audit History**: open or delete past scans, and **compare** any two scans of the same site to see fixed, new and outstanding issues, pages added or removed, metadata changes and performance deltas.
7. **Settings**: integration status, crawl limits and the full scoring methodology with every check's weight.

There is also a headless CLI for quick checks: `npm run audit:cli -- https://example.com [--psi]`.

## How scoring works

- Each check returns a score from 0 to 1, usually the share of applicable pages without the problem, with a status of pass, warning, fail or not verified.
- A category score is the weighted mean of its measurable checks. The overall score is the weighted mean of the category scores: Technical 30%, On-page 25%, Performance 20%, Local 15%, Conversion 10%.
- Unavailable checks, and whole unavailable categories, are excluded and the remaining weights re-normalised. They are never counted as passed or failed.
- Issue priority = severity weight × confidence × effort factor + impact bonus (formula in Settings).
- Issue IDs are `sha1(check | normalised URL | variant)`, so the same problem keeps the same ID across scans. This is what powers the comparison.

## Architecture

```
src/lib/crawler/      safe HTTP client (SSRF guard, size/time limits), robots.txt, sitemaps, HTML extraction, crawl orchestration
src/lib/performance/  PageSpeed Insights client + response parser
src/lib/audit/        check definitions (checks/*), scoring, issue IDs/priority, local signals, runner, repository, comparison
src/lib/reports/      action plan, developer tasks (Markdown), CSV/JSON export, PDF (pdfkit)
src/lib/ai/           optional Anthropic-powered consultant
src/lib/integrations/ Search Console contract (future)
src/lib/db/           Drizzle schema + SQLite client; migrations in ./drizzle
src/app/              Next.js App Router pages and API routes (/api/audits…)
```

To add a check, add a `CheckDefinition` to the relevant file in `src/lib/audit/checks/`. It's picked up automatically by scoring, the UI, exports and the methodology table.

### Safety and politeness

- Only `http(s)` on ports 80/443/8080/8443. Credentials in URLs are rejected, as are `localhost`, `.local`, `.internal` and similar.
- Every DNS answer is checked at connect time, so DNS rebinding is covered. Private, loopback, link-local, CGNAT, reserved and IPv4-mapped addresses are blocked, and every redirect hop is re-validated.
- 15s timeout per request, a 3 MB cap on decompressed responses, at most 5 redirects, and loop detection.
- robots.txt is obeyed for the crawler's user agent (`SEOHealthMonitor`), with crawl-delay honoured up to 5s and 2 concurrent requests.
- Starting audits is rate-limited per IP (default 5 per 10 minutes), with at most 2 audits running at once.

## Tests

```bash
npm test          # vitest: URL/SSRF guards, extraction, sitemap/robots parsing, checks, scoring, issue IDs, comparison, PageSpeed parsing, CSV safety, rate limiting
npm run lint
npm run typecheck
```

## Known limitations

- **JavaScript-rendered sites**: the crawler reads server HTML. When content appears to need JavaScript, the page is flagged and content findings are marked low-confidence. There is no headless-browser fallback yet.
- **Crawl scope**: 25 pages per audit (configurable up to 100). Internal links beyond the crawl are status-checked up to 60 targets. External links are not checked.
- **PageSpeed**: lab results vary between runs. Field data (INP) only exists for sites with enough Chrome traffic. Without an API key, expect performance to be unavailable.
- **Local SEO**: address and place-name detection is heuristic, and is labelled that way. Google Business Profile, reviews, citations and rankings need external data and are shown as not verified.
- **Search Console**: not connected yet (see `docs/search-console.md`). The app never claims a page is indexed.
- **Background jobs** run inside the Next.js server process. An audit interrupted by a restart is marked failed. A multi-instance deployment would need a queue and a shared rate limiter (for example Redis).
- **Tap-target and font-size checks** need a rendered mobile layout and are listed as not verified.
