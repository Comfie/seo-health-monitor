import "server-only";
import { desc, eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import type { InspectionData, SearchRowData } from "@/lib/db/schema";
import { decrypt, encrypt, hasAppSecret } from "@/lib/security/crypto";
import {
  GoogleApiError,
  emailFromIdToken,
  exchangeCode,
  inspectUrl,
  listProperties,
  propertyCovers,
  querySearchAnalytics,
  refreshAccessToken,
  reportingWindow,
  revokeToken,
  type AnalyticsRow,
  type OAuthClient,
} from "./google";

export type SnapshotRow = typeof schema.searchSnapshots.$inferSelect;
export type GoogleAccountRow = typeof schema.googleAccounts.$inferSelect;

const TOKEN_PURPOSE = "google-refresh-token";
export const REPORT_DAYS = 28;

export function searchConsoleSetup(): { configured: boolean; missing: string[]; redirectUri: string } {
  const missing = [
    !config.searchConsole.clientId && "GOOGLE_CLIENT_ID",
    !config.searchConsole.clientSecret && "GOOGLE_CLIENT_SECRET",
    !hasAppSecret() && "APP_SECRET",
  ].filter((v): v is string => !!v);
  return { configured: missing.length === 0, missing, redirectUri: `${config.appUrl}/api/integrations/google/callback` };
}

export function oauthClient(): OAuthClient {
  const { clientId, clientSecret } = config.searchConsole;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured.");
  return { clientId, clientSecret, redirectUri: searchConsoleSetup().redirectUri };
}

export function getGoogleAccount(): GoogleAccountRow | null {
  return getDb().select().from(schema.googleAccounts).orderBy(desc(schema.googleAccounts.id)).limit(1).get() ?? null;
}

/** Short-lived access token cache (process memory only; never persisted). */
type CachedToken = { accountId: number; token: string; expiresAt: number } | null;
const tokenStore = globalThis as unknown as { __gscToken?: CachedToken };
const cachedToken = (): CachedToken => tokenStore.__gscToken ?? null;
function cacheToken(value: CachedToken) {
  tokenStore.__gscToken = value;
}

/** Stores a fresh connection, replacing any previous account. */
export async function completeConnection(code: string, codeVerifier: string): Promise<GoogleAccountRow> {
  const tokens = await exchangeCode(oauthClient(), code, codeVerifier);
  if (!tokens.refresh_token) {
    throw new GoogleApiError("Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.", 400);
  }
  if (!tokens.scope.includes("webmasters.readonly")) {
    throw new GoogleApiError("Search Console access was not granted. Tick the Search Console permission on Google's consent screen.", 400);
  }
  const db = getDb();
  const account = db.transaction((tx) => {
    tx.delete(schema.googleAccounts).run();
    return tx
      .insert(schema.googleAccounts)
      .values({ email: emailFromIdToken(tokens.id_token), encryptedRefreshToken: encrypt(tokens.refresh_token!, TOKEN_PURPOSE), scopes: tokens.scope, connectedAt: new Date() })
      .returning()
      .get();
  });
  cacheToken({ accountId: account.id, token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 });
  return account;
}

/** Revokes the grant at Google and deletes stored tokens and property links. */
export async function disconnect(): Promise<void> {
  const account = getGoogleAccount();
  if (account) {
    const refresh = decrypt(account.encryptedRefreshToken, TOKEN_PURPOSE);
    if (refresh) await revokeToken(refresh);
  }
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schema.searchConsoleConnections).run();
    tx.delete(schema.googleAccounts).run();
  });
  cacheToken(null);
}

export async function getAccessToken(): Promise<string> {
  const account = getGoogleAccount();
  if (!account) throw new GoogleApiError("Google Search Console is not connected.", 401, "not_connected");
  const cached = cachedToken();
  if (cached && cached.accountId === account.id && cached.expiresAt > Date.now()) return cached.token;
  const refresh = decrypt(account.encryptedRefreshToken, TOKEN_PURPOSE);
  if (!refresh) throw new GoogleApiError("The stored Google token can't be decrypted (APP_SECRET changed?). Reconnect Search Console.", 401, "invalid_grant");
  try {
    const tokens = await refreshAccessToken(oauthClient(), refresh);
    cacheToken({ accountId: account.id, token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 });
    if (account.lastError) getDb().update(schema.googleAccounts).set({ lastError: null }).where(eq(schema.googleAccounts.id, account.id)).run();
    return tokens.access_token;
  } catch (err) {
    if (err instanceof GoogleApiError && err.needsReconnect) {
      getDb().update(schema.googleAccounts).set({ lastError: "Google access was revoked or expired. Reconnect Search Console." }).where(eq(schema.googleAccounts.id, account.id)).run();
    }
    throw err;
  }
}

export async function availableProperties(): Promise<string[]> {
  return (await listProperties(await getAccessToken())).map((p) => p.siteUrl);
}

export function getSiteConnection(siteId: number) {
  return getDb().select().from(schema.searchConsoleConnections).where(eq(schema.searchConsoleConnections.siteId, siteId)).get() ?? null;
}

export function listSiteConnections() {
  return getDb().select().from(schema.searchConsoleConnections).all();
}

/** Links a site to a property, but only one the connected account can actually read. */
export async function linkProperty(siteId: number, property: string): Promise<void> {
  const properties = await availableProperties();
  if (!properties.includes(property)) throw new GoogleApiError("That property isn't available to the connected Google account.", 403);
  const account = getGoogleAccount()!;
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schema.searchConsoleConnections).where(eq(schema.searchConsoleConnections.siteId, siteId)).run();
    tx.insert(schema.searchConsoleConnections).values({ siteId, property, status: "connected", scopes: account.scopes, connectedAt: new Date() }).run();
  });
}

export function unlinkProperty(siteId: number): void {
  getDb().delete(schema.searchConsoleConnections).where(eq(schema.searchConsoleConnections.siteId, siteId)).run();
}

const totalsOf = (rows: AnalyticsRow[]) => {
  const r = rows[0];
  return r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
};
const toRows = (rows: AnalyticsRow[]): SearchRowData[] => rows.map((r) => ({ key: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));

async function inspectPages(token: string, property: string, urls: string[]): Promise<InspectionData[]> {
  const targets = [...new Set(urls.filter((u) => propertyCovers(property, u)))].slice(0, config.searchConsole.maxInspections);
  const results: InspectionData[] = [];
  let cursor = 0;
  let quotaHit = false;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < targets.length) {
        const url = targets[cursor++];
        const empty = { url, verdict: "UNKNOWN", coverageState: null, indexingState: null, robotsTxtState: null, pageFetchState: null, lastCrawlTime: null, googleCanonical: null, userCanonical: null };
        if (quotaHit) {
          results.push({ ...empty, error: "Skipped: URL Inspection quota reached." });
          continue;
        }
        try {
          const r = (await inspectUrl(token, property, url)).inspectionResult?.indexStatusResult ?? {};
          results.push({
            url,
            verdict: r.verdict ?? "VERDICT_UNSPECIFIED",
            coverageState: r.coverageState ?? null,
            indexingState: r.indexingState ?? null,
            robotsTxtState: r.robotsTxtState ?? null,
            pageFetchState: r.pageFetchState ?? null,
            lastCrawlTime: r.lastCrawlTime ?? null,
            googleCanonical: r.googleCanonical ?? null,
            userCanonical: r.userCanonical ?? null,
          });
        } catch (err) {
          if (err instanceof GoogleApiError && err.status === 429) quotaHit = true;
          results.push({ ...empty, error: (err as Error).message.slice(0, 200) });
        }
      }
    }),
  );
  return results.sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * Pulls real Search Console data for a linked site and stores it as a snapshot.
 * Failures are stored as an error snapshot rather than thrown, so callers (e.g. the
 * audit runner) are never blocked by Google being unavailable.
 */
export async function fetchSnapshot(siteId: number, options: { auditId?: number; pageUrls?: string[] } = {}): Promise<SnapshotRow | null> {
  const link = getSiteConnection(siteId);
  if (!link) return null;
  const { current, previous } = reportingWindow(REPORT_DAYS);
  const base = { siteId, auditId: options.auditId ?? null, property: link.property, startDate: current.startDate, endDate: current.endDate, fetchedAt: new Date() };
  const db = getDb();
  try {
    const token = await getAccessToken();
    const [totals, prevTotals, daily, queries, pages] = await Promise.all([
      querySearchAnalytics(token, link.property, current),
      querySearchAnalytics(token, link.property, previous),
      querySearchAnalytics(token, link.property, { ...current, dimensions: ["date"], rowLimit: 100 }),
      querySearchAnalytics(token, link.property, { ...current, dimensions: ["query"], rowLimit: 25 }),
      querySearchAnalytics(token, link.property, { ...current, dimensions: ["page"], rowLimit: 25 }),
    ]);
    const inspections = options.pageUrls?.length ? await inspectPages(token, link.property, options.pageUrls) : [];
    const t = totalsOf(totals);
    return db
      .insert(schema.searchSnapshots)
      .values({
        ...base,
        status: "ok",
        ...t,
        previous: totalsOf(prevTotals),
        daily: daily.map((r) => ({ date: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
        topQueries: toRows(queries),
        topPages: toRows(pages),
        inspections,
      })
      .returning()
      .get();
  } catch (err) {
    return db.insert(schema.searchSnapshots).values({ ...base, status: "error", error: (err as Error).message.slice(0, 500) }).returning().get();
  }
}

export function listSnapshots(siteId: number, limit = 100): SnapshotRow[] {
  return getDb().select().from(schema.searchSnapshots).where(eq(schema.searchSnapshots.siteId, siteId)).orderBy(desc(schema.searchSnapshots.fetchedAt)).limit(limit).all();
}

export function latestSnapshot(siteId: number, okOnly = true): SnapshotRow | null {
  return listSnapshots(siteId, 20).find((s) => !okOnly || s.status === "ok") ?? null;
}
