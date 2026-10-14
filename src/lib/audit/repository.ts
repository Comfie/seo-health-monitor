import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { LocalSignals } from "./local-signals";
import type { HostCheck, PageData, RobotsInfo, SitemapFile } from "./types";

export type AuditRow = typeof schema.audits.$inferSelect;
export type SiteRow = typeof schema.sites.$inferSelect;
export type CheckRow = typeof schema.checks.$inferSelect;
export type IssueRow = typeof schema.issues.$inferSelect;
export type PageRow = Omit<typeof schema.pages.$inferSelect, "data"> & { data: PageData };
export type PerfRow = typeof schema.performanceResults.$inferSelect;

export interface AuditMeta {
  siteHost: string;
  origin: string;
  robots: RobotsInfo;
  sitemap: { files: SitemapFile[]; found: boolean; urlCount: number; sampleUrls: string[] };
  httpToHttps: HostCheck | null;
  hostVariant: HostCheck | null;
  notFoundProbe: HostCheck | null;
  blockedByRobots: string[];
  discoveredUrlCount: number;
  uncheckedLinkCount: number;
  linkTargetsChecked: number;
  notes: string[];
  local: LocalSignals;
  performanceSkippedReason: string | null;
  pagespeedKeyConfigured: boolean;
  limits: { maxPages: number; pagespeedPages: number };
}

export interface AuditSummary extends AuditRow {
  host: string;
}

export interface FullAudit {
  audit: AuditRow;
  meta: AuditMeta | null;
  site: SiteRow;
  checks: CheckRow[];
  issues: IssueRow[];
  pages: PageRow[];
  performance: PerfRow[];
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function listAudits(options: { siteId?: number; limit?: number; status?: AuditRow["status"] } = {}): AuditSummary[] {
  const db = getDb();
  const conditions = [
    options.siteId ? eq(schema.audits.siteId, options.siteId) : undefined,
    options.status ? eq(schema.audits.status, options.status) : undefined,
  ].filter(Boolean);
  const rows = db
    .select({ audit: schema.audits, host: schema.sites.host })
    .from(schema.audits)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.audits.siteId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.audits.createdAt), desc(schema.audits.id))
    .limit(options.limit ?? 200)
    .all();
  return rows.map((r) => ({ ...r.audit, host: r.host }));
}

export function listSites(): SiteRow[] {
  return getDb().select().from(schema.sites).orderBy(asc(schema.sites.host)).all();
}

export function getAuditRow(id: number): AuditSummary | null {
  const row = getDb()
    .select({ audit: schema.audits, host: schema.sites.host })
    .from(schema.audits)
    .innerJoin(schema.sites, eq(schema.sites.id, schema.audits.siteId))
    .where(eq(schema.audits.id, id))
    .get();
  return row ? { ...row.audit, host: row.host } : null;
}

export function getFullAudit(id: number): FullAudit | null {
  const db = getDb();
  const audit = db.select().from(schema.audits).where(eq(schema.audits.id, id)).get();
  if (!audit) return null;
  const site = db.select().from(schema.sites).where(eq(schema.sites.id, audit.siteId)).get()!;
  const checks = db.select().from(schema.checks).where(eq(schema.checks.auditId, id)).orderBy(asc(schema.checks.id)).all();
  const issues = db
    .select()
    .from(schema.issues)
    .where(eq(schema.issues.auditId, id))
    .all()
    .sort((a, b) => b.priorityScore - a.priorityScore || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.url.localeCompare(b.url));
  const pages = db.select().from(schema.pages).where(eq(schema.pages.auditId, id)).orderBy(asc(schema.pages.depth), asc(schema.pages.id)).all() as unknown as PageRow[];
  const performance = db.select().from(schema.performanceResults).where(eq(schema.performanceResults.auditId, id)).orderBy(asc(schema.performanceResults.id)).all();
  return { audit, meta: (audit.meta as AuditMeta | null) ?? null, site, checks, issues, pages, performance };
}

/** The audit to show by default: the requested one, otherwise the newest completed audit. */
export function resolveAuditId(requested?: string | string[]): number | null {
  const value = Array.isArray(requested) ? requested[0] : requested;
  const id = value ? Number.parseInt(value, 10) : NaN;
  if (Number.isFinite(id) && getAuditRow(id)) return id;
  return listAudits({ status: "completed", limit: 1 })[0]?.id ?? null;
}

export function deleteAudit(id: number): boolean {
  const result = getDb().delete(schema.audits).where(eq(schema.audits.id, id)).run();
  return result.changes > 0;
}

export function saveAiReport(id: number, report: string, model: string): void {
  getDb().update(schema.audits).set({ aiReport: report, aiModel: model, aiGeneratedAt: new Date() }).where(eq(schema.audits.id, id)).run();
}
