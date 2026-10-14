# Google Search Console integration (planned)

The app is structured so Search Console can be added without touching the audit engine.

## Principles

- Search Console data comes only from the official API for a property the user has authorised.
- It is stored and displayed separately from audits and **never** feeds the technical scores.
- Nothing is simulated. When not connected, every Search Console field is shown as unavailable.
- The audit never claims a page is indexed; the `tech-index-status` check stays "not verified" until URL Inspection data exists.

## What is already in place

- `src/lib/integrations/search-console/types.ts` defines the `SearchConsoleProvider` contract: connection status, OAuth URL, code exchange, properties, performance totals, top queries, top pages and URL inspection.
- The `search_console_connections` table (migration `0000_init`) stores the property, scopes and an encrypted refresh token per site.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are reserved in `.env.example`.

## Implementation outline

1. Create an OAuth client in Google Cloud (type "Web application"), enable the **Google Search Console API**, and add the redirect URI `http://localhost:3000/api/integrations/search-console/callback`.
2. Implement `SearchConsoleProvider` with the `googleapis` package:
   - Scope `https://www.googleapis.com/auth/webmasters.readonly`, `access_type=offline`, `prompt=consent`, a signed `state` containing the site ID.
   - Encrypt the refresh token (AES-256-GCM with a key from a new `TOKEN_ENCRYPTION_KEY` env var) before storing it.
3. Data sources:
   - Clicks, impressions, CTR, average position, top queries and top pages: `searchanalytics.query` with `dimensions: ["query"]` or `["page"]`.
   - Index status: URL Inspection API (`urlInspection.index.inspect`), quota of roughly 2,000 requests/day per property. Inspect only crawled pages.
4. UI: a "Search Console" panel per site with its own date range, clearly labelled as Google data rather than audit findings.
