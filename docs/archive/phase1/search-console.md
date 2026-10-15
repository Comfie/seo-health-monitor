# Google Search Console setup

The app connects to Search Console with Google OAuth (read-only scope `webmasters.readonly`) and shows real clicks, impressions, CTR, average position, top queries, top landing pages, and URL-inspection index status. This data is stored separately from audits and never feeds the on-site health score. Nothing is estimated: if Search Console isn't connected, the app says so.

## One-time Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or choose a project.
2. **APIs & Services → Library**: enable the **Google Search Console API**.
3. **APIs & Services → OAuth consent screen**: choose *External*. Add your Google account as a **test user** while the app is in "Testing". The scopes requested are `openid`, `email` and `.../auth/webmasters.readonly`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorised redirect URI: `<APP_URL>/api/integrations/google/callback`, for example `http://localhost:3000/api/integrations/google/callback` locally. The exact value is shown in the app under Settings and on the Search Performance page.
5. Put the credentials in `.env.local` (or `.env.production`):

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
APP_SECRET=$(openssl rand -base64 32)   # encrypts the stored refresh token
APP_URL=http://localhost:3000            # must match the redirect URI's origin
```

6. Restart the app, open **Search Performance**, click **Connect with Google**, then link each website to its property. Domain properties (`sc-domain:`) and URL-prefix properties are both supported, and the matching property is suggested automatically.

While the consent screen is in "Testing", Google expires refresh tokens after 7 days, so you'll need to reconnect weekly. Setting the consent screen to **In production** avoids that. Google may then show an "unverified app" warning or ask for verification for the Search Console scope; check Google's current OAuth policy for your situation. The app flags an expired connection and offers **Reconnect**.

## How it works

| Piece | Where |
| --- | --- |
| OAuth (state + PKCE S256, read-only scope, offline access) | `src/app/api/integrations/google/*`, `src/lib/integrations/search-console/oauth-state.ts` |
| Google API calls (no SDK dependency) | `src/lib/integrations/search-console/google.ts` |
| Token storage (AES-256-GCM, key derived from `APP_SECRET`), property links, snapshots | `src/lib/integrations/search-console/service.ts` |
| Data model | `google_accounts`, `search_console_connections`, `search_snapshots` (migration `0001`) |

- **Snapshots:** each snapshot stores the last 28 finalised days (ending 3 days ago, because Search Console data lags), the preceding 28 days for comparison, a daily series, the top 25 queries and pages, and URL Inspection results for up to `GSC_MAX_INSPECTIONS` crawled pages (the inspection quota is about 2,000 per day per property).
- **When snapshots are taken:** automatically after each audit of a linked site, and on demand with **Refresh data**. A failed fetch is stored as an error snapshot and never fails the audit.
- **Disconnecting:** revokes the token at Google and deletes the stored token and property links. Changing `APP_SECRET` makes the stored token unreadable; the app then asks you to reconnect.
