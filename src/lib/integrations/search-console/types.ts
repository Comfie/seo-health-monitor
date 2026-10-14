/**
 * Contract for the future Google Search Console integration.
 *
 * Design rules:
 * - Data comes only from the Search Console API for a property the user has
 *   authorised via OAuth (scope: https://www.googleapis.com/auth/webmasters.readonly).
 * - Search Console metrics are stored and displayed separately and never feed
 *   the technical audit scores.
 * - Nothing here is ever simulated: when not connected, callers get
 *   `{ connected: false }` and must show the data as unavailable.
 */

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export interface SearchPerformanceTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  averagePosition: number;
}

export interface SearchRow {
  key: string; // query or page URL
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface UrlIndexStatus {
  url: string;
  verdict: "PASS" | "NEUTRAL" | "FAIL" | "VERDICT_UNSPECIFIED";
  coverageState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
}

export type ConnectionStatus =
  | { connected: false; reason: string }
  | { connected: true; property: string; connectedAt: Date };

export interface SearchConsoleProvider {
  getConnectionStatus(siteId: number): Promise<ConnectionStatus>;
  /** Builds the Google OAuth consent URL (access_type=offline, prompt=consent). */
  getAuthorizationUrl(siteId: number, redirectUri: string): string;
  /** Exchanges the OAuth code and stores the encrypted refresh token. */
  completeAuthorization(siteId: number, code: string, redirectUri: string): Promise<void>;
  listProperties(siteId: number): Promise<string[]>;
  getPerformanceTotals(siteId: number, range: DateRange): Promise<SearchPerformanceTotals>;
  getTopQueries(siteId: number, range: DateRange, limit: number): Promise<SearchRow[]>;
  getTopPages(siteId: number, range: DateRange, limit: number): Promise<SearchRow[]>;
  /** URL Inspection API; quota-limited (about 2,000/day per property). */
  inspectUrl(siteId: number, url: string): Promise<UrlIndexStatus>;
}

/** Placeholder provider used until OAuth is implemented. Never fabricates data. */
export const notConnectedProvider: Pick<SearchConsoleProvider, "getConnectionStatus"> = {
  async getConnectionStatus() {
    return { connected: false, reason: "Google Search Console is not connected yet. This integration is planned (see docs/search-console.md)." };
  },
};
