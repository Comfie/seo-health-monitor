/**
 * Thin, dependency-free client for Google OAuth 2.0 and the Search Console APIs.
 * Pure functions over fetch so they can be unit-tested with a mocked fetch.
 */

export const SEARCH_CONSOLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const WEBMASTERS = "https://www.googleapis.com/webmasters/v3";
const INSPECTION_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
  }
  /** The stored grant no longer works; the user must reconnect. */
  get needsReconnect(): boolean {
    return this.reason === "invalid_grant" || this.status === 401;
  }
  /** Google's quota or rate limit was hit; retry later rather than immediately. */
  get quotaExceeded(): boolean {
    return this.status === 429 || this.reason === "RESOURCE_EXHAUSTED";
  }
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthUrl(client: OAuthClient, state: string, codeChallenge: string, options: { includeGrantedScopes?: boolean } = {}): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: SEARCH_CONSOLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  // Incremental authorisation can merge scopes granted earlier to the same client; the beta
  // asks for exactly the read-only set so a stored grant never carries wider access.
  if (options.includeGrantedScopes ?? true) params.set("include_granted_scopes", "true");
  return `${AUTH_URL}?${params}`;
}

async function parseError(res: Response): Promise<GoogleApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string | { status?: string } };
  const reason = typeof body.error === "string" ? body.error : body.error?.status;
  // Provider responses can echo credentials or request details. Keep only known codes.
  const safeReason = reason && ["invalid_grant", "invalid_client", "access_denied", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "UNAUTHENTICATED"].includes(reason) ? reason : undefined;
  const message = safeReason === "invalid_grant"
    ? "Google access was revoked or expired. Reconnect Search Console."
    : `Google API returned HTTP ${res.status}. Check credentials, permissions and quota.`;
  return new GoogleApiError(message, res.status, safeReason);
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

export async function exchangeCode(client: OAuthClient, code: string, codeVerifier: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(client: Omit<OAuthClient, "redirectUri">, refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TokenResponse;
}

/** Revokes a grant at Google. Resolves true when Google confirmed it (or already considered it invalid). */
export async function revokeToken(token: string): Promise<boolean> {
  const res = await fetch(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res) return false;
  if (res.ok) return true;
  // 400 invalid_token: the grant is already gone, which is the outcome we wanted.
  return res.status === 400 && ((await res.json().catch(() => ({}))) as { error?: string }).error === "invalid_token";
}

/**
 * Reads the email claim from an ID token received directly from Google's token
 * endpoint over TLS (Google documents that such tokens need no signature check).
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

/** Google's stable account ID (`sub`) and email from the same directly received ID token. */
export function identityFromIdToken(idToken: string | undefined): { subject: string; email: string | null } | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { sub?: unknown; email?: unknown };
    if (typeof payload.sub !== "string" || !/^[\w-]{1,255}$/.test(payload.sub)) return null;
    return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email.slice(0, 320) : null };
  } catch {
    return null;
  }
}

async function api<T>(accessToken: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

/** Properties the user can read. Unverified entries are excluded. */
export async function listProperties(accessToken: string): Promise<SiteEntry[]> {
  const data = await api<{ siteEntry?: SiteEntry[] }>(accessToken, `${WEBMASTERS}/sites`);
  return (data.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export interface AnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface AnalyticsQuery {
  startDate: string;
  endDate: string;
  dimensions?: ("query" | "page" | "date" | "country" | "device")[];
  rowLimit?: number;
  type?: "web";
}

export async function querySearchAnalytics(accessToken: string, property: string, query: AnalyticsQuery): Promise<AnalyticsRow[]> {
  const data = await api<{ rows?: AnalyticsRow[] }>(accessToken, `${WEBMASTERS}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { type: "web", ...query });
  return data.rows ?? [];
}

export interface InspectionResult {
  inspectionResult?: {
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      indexingState?: string;
      robotsTxtState?: string;
      pageFetchState?: string;
      lastCrawlTime?: string;
      googleCanonical?: string;
      userCanonical?: string;
    };
  };
}

export async function inspectUrl(accessToken: string, property: string, url: string): Promise<InspectionResult> {
  return api<InspectionResult>(accessToken, INSPECTION_URL, { inspectionUrl: url, siteUrl: property, languageCode: "en" });
}

/** Whether a page URL belongs to a property ("sc-domain:example.com" or a URL prefix). */
export function propertyCovers(property: string, url: string): boolean {
  try {
    const u = new URL(url);
    if (property.startsWith("sc-domain:")) {
      const domain = property.slice("sc-domain:".length).toLowerCase();
      return u.hostname === domain || u.hostname.endsWith(`.${domain}`);
    }
    return url.startsWith(property);
  } catch {
    return false;
  }
}

/**
 * Whether a property is appropriate for a website: a domain property for the site's domain
 * (or a parent domain), or a URL-prefix property on the site's own host, with or without
 * www and on either scheme. A prefix property may cover only part of the site; inspections
 * are still limited to the URLs it covers.
 */
export function propertyMatchesSite(property: string, siteHost: string): boolean {
  const bare = siteHost.toLowerCase().replace(/^www\./, "");
  if (property.startsWith("sc-domain:")) {
    const domain = property.slice("sc-domain:".length).toLowerCase();
    return !!domain && (bare === domain || bare.endsWith(`.${domain}`));
  }
  try {
    const u = new URL(property);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.toLowerCase().replace(/^www\./, "") === bare;
  } catch {
    return false;
  }
}

/** Ranks the user's properties by how well they match a site host (best first). */
export function suggestProperty(host: string, properties: string[]): string | null {
  const bare = host.replace(/^www\./, "");
  const order = [`sc-domain:${bare}`, `https://${bare}/`, `https://www.${bare}/`, `http://${bare}/`, `http://www.${bare}/`];
  return order.find((p) => properties.includes(p)) ?? properties.find((p) => propertyCovers(p, `https://${bare}/`) || propertyCovers(p, `https://www.${bare}/`)) ?? null;
}

/** Search Console data is finalised with a ~2-3 day lag; windows end 3 days ago. */
export function reportingWindow(days: number, today = new Date()): { current: { startDate: string; endDate: string }; previous: { startDate: string; endDate: string } } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 3));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(start.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevEnd.getUTCDate() - (days - 1));
  return { current: { startDate: iso(start), endDate: iso(end) }, previous: { startDate: iso(prevStart), endDate: iso(prevEnd) } };
}

/**
 * Search Analytics omits days with no impressions. Fill every day in the window
 * so charts show the real timeline; a missing day genuinely means zero.
 */
export function fillDailySeries<T extends { date: string; clicks: number; impressions: number }>(
  rows: T[],
  startDate: string,
  endDate: string,
): { date: string; clicks: number; impressions: number; ctr: number; position: number | null }[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: { date: string; clicks: number; impressions: number; ctr: number; position: number | null }[] = [];
  for (let d = new Date(`${startDate}T00:00:00Z`); d <= new Date(`${endDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const row = byDate.get(key) as (T & { ctr?: number; position?: number }) | undefined;
    out.push(row ? { date: key, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr ?? 0, position: row.position ?? null } : { date: key, clicks: 0, impressions: 0, ctr: 0, position: null });
  }
  return out;
}
