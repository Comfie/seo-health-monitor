/**
 * Owner-authorised Google Search Console data attached to a report. Kept apart from the
 * on-site health score: it describes how the site performs in Google, not the site itself.
 */
type Row = { key: string; clicks: number; impressions: number; ctr: number; position: number };
export type ReportSearchConsole =
  | { verified: false; note: string }
  | {
      verified: true;
      source: string;
      property: string;
      period: { start: string; end: string };
      fetchedAt: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number | null;
      previous: { clicks: number; impressions: number; ctr: number; position: number } | null;
      topQueries: Row[];
      topPages: Row[];
      indexing: { inspected: number; notIndexed: { url: string; coverage: string }[] };
    };
