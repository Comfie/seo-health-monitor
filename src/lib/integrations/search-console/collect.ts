import type { InspectionData, SearchRowData } from "@/lib/saas/schema";
import { GoogleApiError, inspectUrl, propertyCovers, querySearchAnalytics, reportingWindow, type AnalyticsRow } from "./google";

export const REPORT_DAYS = 28;

export type Totals = { clicks: number; impressions: number; ctr: number; position: number };
export type CollectedSnapshot = {
  startDate: string;
  endDate: string;
  totals: Totals;
  previous: Totals;
  daily: { date: string; clicks: number; impressions: number; ctr: number; position: number }[];
  topQueries: SearchRowData[];
  topPages: SearchRowData[];
  inspections: InspectionData[];
};

const totalsOf = (rows: AnalyticsRow[]): Totals => {
  const r = rows[0];
  return r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
};
const toRows = (rows: AnalyticsRow[]): SearchRowData[] => rows.map((r) => ({ key: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));

/** Customer-safe text for a Google failure (provider bodies are never passed through). */
export function googleFailureMessage(error: unknown): string {
  if (error instanceof GoogleApiError) {
    if (error.needsReconnect) return "Google access was revoked or expired. Reconnect Search Console.";
    if (error.quotaExceeded) return "Google's Search Console quota was reached. Data will be fetched again later.";
    if (error.status === 403) return "The connected Google account no longer has access to this property.";
    return `Google Search Console returned an error (HTTP ${error.status}). Try again later.`;
  }
  return "Google Search Console could not be reached. Try again later.";
}

/**
 * Inspects up to `max` URLs covered by the property, most important first (the caller passes
 * them in priority order). Stops sending requests once Google reports the quota exhausted;
 * the remaining URLs are recorded as not checked, never as indexed or not indexed.
 */
async function inspectPages(token: string, property: string, urls: string[], max: number): Promise<InspectionData[]> {
  const targets = [...new Set(urls.filter((u) => propertyCovers(property, u)))].slice(0, max);
  const results: InspectionData[] = [];
  let cursor = 0;
  let quotaHit = false;
  await Promise.all(
    Array.from({ length: Math.min(3, targets.length) }, async () => {
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
        } catch (error) {
          if (error instanceof GoogleApiError && error.needsReconnect) throw error;
          if (error instanceof GoogleApiError && error.quotaExceeded) quotaHit = true;
          results.push({ ...empty, error: googleFailureMessage(error) });
        }
      }
    }),
  );
  return results.sort((a, b) => a.url.localeCompare(b.url));
}

/** Pulls real Search Console data for one property with an already authorised access token. */
export async function collectSnapshot(token: string, property: string, options: { pageUrls?: string[]; maxInspections: number; today?: Date }): Promise<CollectedSnapshot> {
  const { current, previous } = reportingWindow(REPORT_DAYS, options.today);
  const [totals, prevTotals, daily, queries, pages] = await Promise.all([
    querySearchAnalytics(token, property, current),
    querySearchAnalytics(token, property, previous),
    querySearchAnalytics(token, property, { ...current, dimensions: ["date"], rowLimit: 100 }),
    querySearchAnalytics(token, property, { ...current, dimensions: ["query"], rowLimit: 25 }),
    querySearchAnalytics(token, property, { ...current, dimensions: ["page"], rowLimit: 25 }),
  ]);
  const inspections = options.pageUrls?.length && options.maxInspections > 0 ? await inspectPages(token, property, options.pageUrls, options.maxInspections) : [];
  return {
    startDate: current.startDate,
    endDate: current.endDate,
    totals: totalsOf(totals),
    previous: totalsOf(prevTotals),
    daily: daily.map((r) => ({ date: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    topQueries: toRows(queries),
    topPages: toRows(pages),
    inspections,
  };
}
