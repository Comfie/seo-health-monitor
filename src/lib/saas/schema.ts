import { sql } from "drizzle-orm";
import { foreignKey, index, integer, doublePrecision, pgTable, text, timestamp, jsonb, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { memberships, tenants } from "./tenancy-schema";
export * from "./auth-schema";
export * from "./tenancy-schema";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow();

export const sites = pgTable("sites", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  host: text("host").notNull(),
  displayName: text("display_name"),
  displayUrl: text("display_url").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sites_tenant_host_idx").on(t.tenantId, t.host), unique("sites_tenant_id_idx").on(t.tenantId, t.id)]);

export const audits = pgTable(
  "audits",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    siteId: integer("site_id")
      .notNull(),
    inputUrl: text("input_url").notNull(),
    startUrl: text("start_url").notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed", "cancelled"] }).notNull(),
    stage: text("stage"),
    progress: integer("progress").notNull().default(0),
    log: jsonb("log").$type<string[]>().notNull().default(sql`'[]'`),
    error: text("error"),
    overallScore: doublePrecision("overall_score"),
    categoryScores: jsonb("category_scores").$type<Record<string, number | null>>(),
    counts: jsonb("counts").$type<Record<string, number>>(),
    pagesScanned: integer("pages_scanned"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    aiReport: text("ai_report"),
    aiModel: text("ai_model"),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Background job bookkeeping: claims, liveness and retry count. */
    attempts: integer("attempts").notNull().default(0),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique("audits_tenant_id_idx").on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id] }).onDelete("cascade"), index("audits_site_idx").on(t.tenantId, t.siteId, t.createdAt), index("audits_status_idx").on(t.tenantId, t.status)],
);

export const pages = pgTable(
  "pages",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    auditId: integer("audit_id")
      .notNull(),
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
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.auditId], foreignColumns: [audits.tenantId, audits.id] }).onDelete("cascade"), index("pages_audit_idx").on(t.tenantId, t.auditId)],
);

export const checks = pgTable(
  "checks",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    auditId: integer("audit_id")
      .notNull(),
    checkId: text("check_id").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull(),
    score: doublePrecision("score"),
    weight: doublePrecision("weight").notNull(),
    summary: text("summary").notNull(),
    unavailableReason: text("unavailable_reason"),
    affectedCount: integer("affected_count").notNull().default(0),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.auditId], foreignColumns: [audits.tenantId, audits.id] }).onDelete("cascade"), index("checks_audit_idx").on(t.tenantId, t.auditId)],
);

export const issues = pgTable(
  "issues",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    auditId: integer("audit_id")
      .notNull(),
    issueKey: text("issue_key").notNull(),
    checkId: text("check_id").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    evidence: jsonb("evidence").$type<string[]>().notNull(),
    why: text("why").notNull(),
    fix: text("fix").notNull(),
    implementation: text("implementation").notNull(),
    benefit: text("benefit").notNull(),
    impact: integer("impact").notNull(),
    confidence: text("confidence").notNull(),
    effort: text("effort").notNull(),
    priorityScore: doublePrecision("priority_score").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.auditId], foreignColumns: [audits.tenantId, audits.id] }).onDelete("cascade"),
    index("issues_audit_idx").on(t.tenantId, t.auditId),
    uniqueIndex("issues_audit_key_idx").on(t.auditId, t.issueKey),
  ],
);

export const performanceResults = pgTable(
  "performance_results",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    auditId: integer("audit_id")
      .notNull(),
    url: text("url").notNull(),
    strategy: text("strategy", { enum: ["mobile", "desktop"] }).notNull(),
    status: text("status", { enum: ["ok", "unavailable"] }).notNull(),
    error: text("error"),
    performanceScore: doublePrecision("performance_score"),
    lcpMs: doublePrecision("lcp_ms"),
    cls: doublePrecision("cls"),
    tbtMs: doublePrecision("tbt_ms"),
    fcpMs: doublePrecision("fcp_ms"),
    speedIndexMs: doublePrecision("speed_index_ms"),
    ttfbMs: doublePrecision("ttfb_ms"),
    fieldLcpMs: doublePrecision("field_lcp_ms"),
    fieldInpMs: doublePrecision("field_inp_ms"),
    fieldCls: doublePrecision("field_cls"),
    fieldCategory: text("field_category"),
    fieldSource: text("field_source"),
    opportunities: jsonb("opportunities")
      .$type<{ id: string; title: string; displayValue?: string; savingsMs?: number; savingsBytes?: number }[]>()
      .notNull()
      .default(sql`'[]'`),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.auditId], foreignColumns: [audits.tenantId, audits.id] }).onDelete("cascade"), index("perf_audit_idx").on(t.tenantId, t.auditId)],
);

/**
 * The Google account authorised for Search Console (read-only scope).
 * The refresh token is AES-256-GCM encrypted with a key derived from APP_SECRET.
 */
export const googleAccounts = pgTable("google_accounts", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  email: text("email"),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scopes: text("scopes").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
}, (t) => [unique("google_tenant_id_idx").on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId] }).onDelete("cascade")]);

/**
 * Links a site to a Search Console property. Search Console data is stored
 * separately from audits and never feeds the technical scores.
 */
export const searchConsoleConnections = pgTable("search_console_connections", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  siteId: integer("site_id")
    .notNull(),
  googleAccountId: integer("google_account_id").notNull(),
  property: text("property").notNull(),
  status: text("status", { enum: ["connected", "revoked", "error"] }).notNull(),
  scopes: text("scopes").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id] }).onDelete("cascade"), foreignKey({ columns: [t.tenantId, t.googleAccountId], foreignColumns: [googleAccounts.tenantId, googleAccounts.id] }).onDelete("cascade"), uniqueIndex("connection_tenant_site_idx").on(t.tenantId, t.siteId)]);

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
export const searchSnapshots = pgTable(
  "search_snapshots",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    siteId: integer("site_id")
      .notNull(),
    auditId: integer("audit_id"),
    property: text("property").notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    error: text("error"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    clicks: doublePrecision("clicks"),
    impressions: doublePrecision("impressions"),
    ctr: doublePrecision("ctr"),
    position: doublePrecision("position"),
    previous: jsonb("previous").$type<{ clicks: number; impressions: number; ctr: number; position: number } | null>(),
    daily: jsonb("daily").$type<{ date: string; clicks: number; impressions: number; ctr: number; position: number }[]>(),
    topQueries: jsonb("top_queries").$type<SearchRowData[]>(),
    topPages: jsonb("top_pages").$type<SearchRowData[]>(),
    inspections: jsonb("inspections").$type<InspectionData[]>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id] }).onDelete("cascade"), foreignKey({ columns: [t.tenantId, t.auditId], foreignColumns: [audits.tenantId, audits.id] }).onDelete("cascade"), index("snapshots_site_idx").on(t.tenantId, t.siteId, t.fetchedAt)],
);
