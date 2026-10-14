import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  host: text("host").notNull().unique(),
  displayUrl: text("display_url").notNull(),
  createdAt: createdAt(),
});

export const audits = sqliteTable(
  "audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    inputUrl: text("input_url").notNull(),
    startUrl: text("start_url").notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull(),
    stage: text("stage"),
    progress: integer("progress").notNull().default(0),
    log: text("log", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    error: text("error"),
    overallScore: real("overall_score"),
    categoryScores: text("category_scores", { mode: "json" }).$type<Record<string, number | null>>(),
    counts: text("counts", { mode: "json" }).$type<Record<string, number>>(),
    pagesScanned: integer("pages_scanned"),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    aiReport: text("ai_report"),
    aiModel: text("ai_model"),
    aiGeneratedAt: integer("ai_generated_at", { mode: "timestamp_ms" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    /** Background job bookkeeping: claims, liveness and retry count. */
    attempts: integer("attempts").notNull().default(0),
    heartbeatAt: integer("heartbeat_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("audits_site_idx").on(t.siteId, t.createdAt), index("audits_status_idx").on(t.status)],
);

export const pages = sqliteTable(
  "pages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    auditId: integer("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    finalUrl: text("final_url").notNull(),
    status: integer("status"),
    depth: integer("depth").notNull(),
    source: text("source").notNull(),
    title: text("title"),
    metaDescription: text("meta_description"),
    h1: text("h1"),
    canonical: text("canonical"),
    metaRobots: text("meta_robots"),
    wordCount: integer("word_count"),
    responseTimeMs: integer("response_time_ms"),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("pages_audit_idx").on(t.auditId)],
);

export const checks = sqliteTable(
  "checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    auditId: integer("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    checkId: text("check_id").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull(),
    score: real("score"),
    weight: real("weight").notNull(),
    summary: text("summary").notNull(),
    unavailableReason: text("unavailable_reason"),
    affectedCount: integer("affected_count").notNull().default(0),
  },
  (t) => [index("checks_audit_idx").on(t.auditId)],
);

export const issues = sqliteTable(
  "issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    auditId: integer("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    issueKey: text("issue_key").notNull(),
    checkId: text("check_id").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    why: text("why").notNull(),
    fix: text("fix").notNull(),
    implementation: text("implementation").notNull(),
    benefit: text("benefit").notNull(),
    impact: integer("impact").notNull(),
    confidence: text("confidence").notNull(),
    effort: text("effort").notNull(),
    priorityScore: real("priority_score").notNull(),
  },
  (t) => [
    index("issues_audit_idx").on(t.auditId),
    uniqueIndex("issues_audit_key_idx").on(t.auditId, t.issueKey),
  ],
);

export const performanceResults = sqliteTable(
  "performance_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    auditId: integer("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    strategy: text("strategy", { enum: ["mobile", "desktop"] }).notNull(),
    status: text("status", { enum: ["ok", "unavailable"] }).notNull(),
    error: text("error"),
    performanceScore: real("performance_score"),
    lcpMs: real("lcp_ms"),
    cls: real("cls"),
    tbtMs: real("tbt_ms"),
    fcpMs: real("fcp_ms"),
    speedIndexMs: real("speed_index_ms"),
    ttfbMs: real("ttfb_ms"),
    fieldLcpMs: real("field_lcp_ms"),
    fieldInpMs: real("field_inp_ms"),
    fieldCls: real("field_cls"),
    fieldCategory: text("field_category"),
    fieldSource: text("field_source"),
    opportunities: text("opportunities", { mode: "json" })
      .$type<{ id: string; title: string; displayValue?: string; savingsMs?: number; savingsBytes?: number }[]>()
      .notNull()
      .default(sql`'[]'`),
  },
  (t) => [index("perf_audit_idx").on(t.auditId)],
);

/**
 * The Google account authorised for Search Console (read-only scope).
 * The refresh token is AES-256-GCM encrypted with a key derived from APP_SECRET.
 */
export const googleAccounts = sqliteTable("google_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email"),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scopes: text("scopes").notNull(),
  connectedAt: integer("connected_at", { mode: "timestamp_ms" }).notNull(),
  lastError: text("last_error"),
});

/**
 * Links a site to a Search Console property. Search Console data is stored
 * separately from audits and never feeds the technical scores.
 */
export const searchConsoleConnections = sqliteTable("search_console_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  property: text("property").notNull(),
  status: text("status", { enum: ["connected", "revoked", "error"] }).notNull(),
  scopes: text("scopes").notNull(),
  connectedAt: integer("connected_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export interface SearchRowData {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface InspectionData {
  url: string;
  verdict: string;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  error?: string;
}

/** A point-in-time pull of real Search Console data for one site/property. */
export const searchSnapshots = sqliteTable(
  "search_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    auditId: integer("audit_id").references(() => audits.id, { onDelete: "set null" }),
    property: text("property").notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    error: text("error"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    clicks: real("clicks"),
    impressions: real("impressions"),
    ctr: real("ctr"),
    position: real("position"),
    previous: text("previous", { mode: "json" }).$type<{ clicks: number; impressions: number; ctr: number; position: number } | null>(),
    daily: text("daily", { mode: "json" }).$type<{ date: string; clicks: number; impressions: number; ctr: number; position: number }[]>(),
    topQueries: text("top_queries", { mode: "json" }).$type<SearchRowData[]>(),
    topPages: text("top_pages", { mode: "json" }).$type<SearchRowData[]>(),
    inspections: text("inspections", { mode: "json" }).$type<InspectionData[]>(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("snapshots_site_idx").on(t.siteId, t.fetchedAt)],
);

/** Fixed-window rate-limit counters, persisted so limits survive restarts. */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});
