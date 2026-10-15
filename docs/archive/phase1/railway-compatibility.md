# Railway compatibility and test report

Prepared 2026-10-14. Selected Option A; no Railway deployment, billing setup, remote push or registration was performed.

## Git and workspace

Remote references fetched before branching. `main` and `origin/main` both at `5ea87785168ab67d5962de8c9d80866eb00e772a`. Local `vercel-deployment` remains `9b504c4` (one commit ahead of remote `fef1f59`); `cloudflare-migration` and its remote remain `108ac7a`. Local `railway-deployment` created directly from `origin/main`. No merge/cherry-pick of platform branches.

Pre-existing untracked `.workflow-data/` and `.workflow-vitest/` remain untouched and excluded from Docker context/lint. Ignored generated workflow routes left by earlier Vercel work were moved intact to `/private/tmp/seo-preserved-workflow-flocl7ru/workflow` so the main-based build cannot pick them up; restore them only when returning to that workflow branch. They were never tracked in main. The Docker context explicitly excludes generated workflow routes. No operation in this preparation opens, migrates, overwrites or restores the working local SQLite database. Tests/build/smoke use disposable paths instead; existing local Google data was not used to claim new live integration verification.

## Compatibility audit

| Component | Finding / action |
| --- | --- |
| Next.js production | Existing standalone output, Node external packages, runtime migration tracing retained; static/public assets copied by Docker. Relevant installed Next 16.4 docs were read before edits. |
| Docker/Compose | Existing Debian Node 22 multi-stage image reused. Runtime owns mounted DB directory/sidecars then drops to UID 1001 using gosu; HTTP probe uses PORT. Compose already maps a volume and is unchanged. Linux image not built here: Docker absent. |
| Node | Tested local Node 22.19.0. Installed undici 8.12.1 requires >=22.19.0, better-sqlite3 13.0.3 >=22; package and lock engines aligned from >=22.9 to >=22.19.0. Image uses current Node 22 bookworm slim. |
| SQLite/Drizzle | Schema/migrations unchanged (0000 init, 0001 GSC, 0002 jobs/rate limits). DB opens with WAL/foreign keys; migrations now explicitly complete before runtime readiness. Railway validation requires absolute path within runtime mount. No build/pre-deploy migration. |
| Worker/queue | Already DB-backed, atomic claim, 2s poll, 10s heartbeat, 90s stale expiry, max 2 attempts/20 queued. Added configurable 1–2 full audits, same-pending-URL deduplication and shutdown stop-claim behavior. Next handles HTTP draining; audits may exceed drain time and recover next boot. |
| Retry semantics | Interrupted claims requeue once; terminal audit/crawl failures stay failed for explicit rerun. Google transient PSI errors already have bounded retries/backoff and quota short-circuit. Do not claim every failure is automatically retried. |
| Progress | DB-backed stages/logs/results retained; request completion is independent of interval worker. Queue and interrupted claims exercised through real standalone restart. |
| Google OAuth | APP_URL-derived callback, owner-authenticated callback, encrypted state and PKCE S256/read-only scopes retained. Provider errors now use safe messages/codes; revoke token moved from URL query to POST body. Live redirect/consent not tested on Railway. |
| Token security | AES-256-GCM + purpose-specific HKDF keys retained. Exact APP_SECRET required across import/restore. Backup test verifies ciphertext survives and decrypts under same secret. No real refresh token read or printed. |
| PageSpeed | Existing mobile/desktop sampling, header API key, timeouts/retries/quota behavior retained. HTTP/network errors no longer echo provider response detail. Mock tests pass; live API not invoked. |
| PDFKit/exports | Node runtime/font tracing works in local standalone; actual HTTP PDF has `%PDF-` signature before/after restart. CSV/JSON/Markdown endpoints return data. Docker/Linux font/native ABI still requires test. |
| Authentication | Password/signature cookies, proxy + route guard, database rate limits retained. Production HTTP tests verify wrong password, success, 401, CSRF 403, Secure/HttpOnly/Lax cookies with HTTPS forwarding. Railway startup refuses auth bypass/missing secrets. |
| SSRF/resources | Existing socket-time all-DNS-answer validation, IPv4/IPv6 public-address filtering, manual redirect checks and private network denial remain. Existing regression tests retained. Crawl page/byte/concurrency/time limits remain; no local browser launched. Limit worker to one audit for beta. |
| Health/logging | Existing unauthenticated `select 1` probe retained. Startup DB/volume failures prevent readiness. Worker status/error messages use console output; provider raw error bodies removed from user-facing Google/Anthropic/PSI HTTP failures. Never add full headers/env/callback URL logs. |
| Backups | New online SQLite snapshot tool validates integrity/FKs, mode 0600, rejects existing targets; supports non-destructive import/restore to new files. Railway automated volume schedules documented, not configured without deployment. |

## Actual verification

| Command | Result |
| --- | --- |
| `git fetch origin` | Passed with filesystem/network escalation; refs verified |
| `git switch -c railway-deployment origin/main` | Passed with git metadata permission; stable main base |
| `npm test` before adding deployment tests | 8 test files, 100 tests passed |
| `npm test` with deployment tests | 9 test files, 105 tests passed |
| `npm run lint` | Passed after fixing CJS lint rule and ignoring pre-existing generated test artifacts |
| `npm run typecheck` | Passed; initial ProcessEnv fixture typing issue corrected |
| `DATABASE_PATH=/private/tmp/seo-railway-build-only.db npm run build` | Passed outside sandbox for Google-font fetching/Turbopack; 27 generated static/partial routes, standalone output. First sandbox run interrupted while compiling; Node signal warnings corrected by moving bootstrap to dynamically imported Node-only module. |
| `node scripts/test-railway.cjs` (package alias: `npm run test:railway`) | Passed outside sandbox (localhost bind permission needed). Copies standalone to temporary directory excluding env files; creates fresh migrated DB and random test credentials; removes only its temp test files afterward. |
| `sh -n scripts/docker-entrypoint.sh` | Passed syntax check; not a Linux execution test |
| `git diff --check` | Passed |
| Candidate-file secret scan | 22 changed/new candidate files checked against local secret values and private-key/API-key patterns; 0 matches. Values never printed; this is not a full historical secret audit. |
| `command -v docker` | No Docker executable; build/boot not performed |

Production smoke exercises HTTP readiness, correct/wrong login, cookie flags, unauthorized 401, cross-origin 403, private URL 400, duplicate pending job ID, PDF/CSV/JSON/Markdown responses, local Fix with AI prompt generation, SIGTERM shutdown, persisted completed audit after restart, queued-job consumption and stale-running-job recovery after restart, plus online backup/restore to separate paths. Queue test jobs use loopback URLs so the SSRF engine rejects them with no external crawl. This proves scheduling/recovery mechanics, not successful live website auditing. New unit tests exercise Railway env acceptance/rejection, WAL and SHM presence, uncheckpointed WAL backup, ciphertext/token recovery, mode 0600, overwrite refusal, missing-source failure and persisted data read in a separate process. Existing tests cover actual audit checks, parsing, DNS/private addresses, exported prompt content, quota retries, state/PKCE/token sealing, mocked Google refresh/analytics and revoked grants.

## Unverified release checks

- Linux Docker build, native addon ABI, gosu execution and mounted volume ownership on Railway.
- Real Railway restart/redeploy, spending configuration, volume automatic backup schedule and platform restore drill.
- Browser login and real Google consent/callback on final HTTPS hostname; live Google refresh/data access and PSI measurements.
- Live Anthropic report generation/model entitlement/provider spending. Local Fix prompt generation is verified independently.
- Peak RSS/CPU/network/storage under representative real crawls and malicious worst-case payloads; no cost figure is presented as a benchmark.

Complete these checks using the [deployment guide](railway-deployment.md). Initial defaults cap full audits at one, crawl at 25 pages, provider sample at three pages, and queue at 20; these caps bound per-scan work but do not enforce monthly quotas. Commercial isolation and subscriptions are design-only in [SaaS roadmap](railway-saas-roadmap.md).
