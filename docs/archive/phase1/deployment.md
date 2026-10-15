# Deployment

SEO Health Monitor is a single Node.js process with an embedded SQLite database. Audits run as background jobs inside that process. That makes it simple to host, but it must run as **one instance** with **persistent disk**. Serverless platforms such as Vercel are not suitable: they have no persistent filesystem and no long-running background work.

> Nothing has been deployed. These are the steps to follow once you approve a target.

## Requirements

| Need | How it's met |
| --- | --- |
| Runtime | Node.js ≥ 22.9, or the provided Docker image |
| Persistent storage | SQLite file at `DATABASE_PATH` on a persistent volume (the Docker image uses `/data`). Migrations run automatically at startup. |
| TLS | A reverse proxy (Caddy, nginx, Cloudflare Tunnel, or a platform load balancer) in front of the app |
| Authentication | `AUTH_PASSWORD` (12+ characters) and `APP_SECRET` (32+ random characters). Without them the app refuses to serve data in production. |
| Background jobs | Built in: a SQLite-backed queue with heartbeats and automatic retry after crashes or restarts |

## Production environment variables

```bash
NODE_ENV=production
APP_URL=https://seo.example.com          # public URL; used for OAuth redirects and origin checks
APP_SECRET=...                           # openssl rand -base64 32 (keep it stable)
AUTH_PASSWORD=...                        # owner password, 12+ characters
TRUST_PROXY=1                            # number of reverse proxies adding X-Forwarded-For
DATABASE_PATH=/data/seo-health.db
PAGESPEED_API_KEY=...                    # strongly recommended
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...   # optional, Search Console
ANTHROPIC_API_KEY=...                    # optional, AI consultant
```

Add `<APP_URL>/api/integrations/google/callback` to the OAuth client's authorised redirect URIs.

## Option A: Docker (any VPS, Fly.io, Railway, Render with a disk)

```bash
cp .env.example .env.production   # fill in the values above
docker compose up -d --build      # builds the image and stores data in the "seo-data" volume
```

The compose file binds to `127.0.0.1:3000`. Put a TLS reverse proxy in front, for example with Caddy:

```
seo.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

On platforms like Fly.io, Railway or Render, deploy the Dockerfile, attach a persistent volume at `/data`, set the environment variables as secrets, and keep the service at **one instance**. The container has a health check on `/api/health`.

## Option B: Plain Node.js

```bash
npm ci
npm run build
npm start          # runs .next/standalone/server.js and loads .env.production / .env.local
```

Run it under a process manager such as systemd or pm2 so it restarts on failure.

## Operations

- **Backups:** `npm run db:backup` writes a consistent online copy next to the database. You can also copy the volume while the app is stopped, or use `sqlite3 seo-health.db ".backup backup.db"`.
- **Upgrades:** deploy the new version. Pending migrations in `drizzle/` apply automatically at startup.
- **Interrupted audits:** if the process dies mid-audit, the audit is re-queued once its heartbeat is stale (about 90 seconds) and retried once. A second interruption marks it failed. Results are written in one transaction, so retries never leave partial data.
- **Scaling:** one instance only. SQLite and the in-process worker are designed for a single node. Running several replicas would need a shared database and an external queue.

## Pre-launch checklist

- [ ] `APP_SECRET` and `AUTH_PASSWORD` are set and stored as secrets, not committed
- [ ] Served over HTTPS only, and `APP_URL` uses `https://`
- [ ] `TRUST_PROXY` matches the number of proxies in front (0 if none)
- [ ] Persistent volume is mounted at `DATABASE_PATH`'s directory, and backups are scheduled
- [ ] Exactly one instance is running
- [ ] `/api/health` returns `{"ok":true}`
- [ ] Signing in works, and unauthenticated requests redirect to `/login`
- [ ] Google OAuth redirect URI matches `APP_URL`
