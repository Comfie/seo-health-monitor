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
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthUrl(client: OAuthClient, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: SEARCH_CONSOLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

async function parseError(res: Response): Promise<GoogleApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string | { message?: string; status?: string }; error_description?: string };
  if (typeof body.error === "string") {
    return new GoogleApiError(body.error_description ?? body.error, res.status, body.error);
  }
  const message = body.error?.message ?? `Google API returned HTTP ${res.status}`;
  return new GoogleApiError(message, res.status, body.error?.status);
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

export async function revokeToken(token: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
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
