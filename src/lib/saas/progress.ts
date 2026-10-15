import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { SaasDb } from "./db";
import { assertTenant, type TenantContext } from "./tenant";
import { tenantRepository } from "./repository";
import { customerAudits } from "./audits";
type SnapshotRow = typeof schema.searchSnapshots.$inferSelect;
import { compareAudits, type CompareInput, type Trend } from "../audit/compare";
import { assessScore } from "../audit/scoring";
import { CATEGORY_LABELS, type Category } from "../audit/types";

export interface AuditPoint {
  id: number;
  completedAt: Date;
  overall: number | null;
  categories: Partial<Record<Category, number | null>>;
  counts: Record<string, number>;
  coverage: number;
  provisional: boolean;
  pagesScanned: number | null;
}

export interface MetricChange {
  label: string;
  previous: number | null;
  current: number | null;
  trend: Trend;
  /** Shown when the comparison has a caveat (e.g. coverage changed). */
  note?: string;
  format: "score" | "count" | "percent" | "position";
}

export interface SiteProgress {
  audits: AuditPoint[];
  snapshots: SnapshotRow[];
  onSite: MetricChange[];
  issues: { fixed: number; introduced: number; outstanding: number } | null;
  search: MetricChange[];
  searchBasis: string | null;
}

function trend(previous: number | null, current: number | null, higherIsBetter: boolean, tolerance = 0): Trend {
  if (previous === null || current === null) return "unavailable";
  if (Math.abs(current - previous) <= tolerance) return "unchanged";
  return current > previous === higherIsBetter ? "improved" : "regressed";
}

/** Completed audits of a site, oldest first, with their score coverage. */
export async function auditSeries(db: SaasDb, context: TenantContext, siteId: number): Promise<AuditPoint[]> {
  await assertTenant(db, context);
  await tenantRepository(db, context).getWebsite(siteId);
  const audits = (await db
    .select()
    .from(schema.audits)
    .where(and(eq(schema.audits.tenantId, context.tenantId), eq(schema.audits.siteId, siteId)))
    .orderBy(asc(schema.audits.completedAt)))
    .filter((a) => a.status === "completed" && a.completedAt);
  if (!audits.length) return [];
  const checks = await db.select().from(schema.checks).where(and(eq(schema.checks.tenantId, context.tenantId), inArray(schema.checks.auditId, audits.map((a) => a.id))));
  return audits.map((a) => {
    const assessment = assessScore(checks.filter((c) => c.auditId === a.id), CATEGORY_LABELS);
    return {
      id: a.id,
      completedAt: a.completedAt!,
      overall: a.overallScore,
      categories: (a.categoryScores ?? {}) as Partial<Record<Category, number | null>>,
      counts: a.counts ?? {},
      coverage: assessment.coverage,
      provisional: assessment.provisional,
      pagesScanned: a.pagesScanned,
    };
  });
}

async function compareInput(db: SaasDb, context: TenantContext, id: number): Promise<CompareInput | null> {
  const full = await customerAudits(db, context).full(id);
  if (!full) return null;
  return { overallScore: full.audit.overallScore, categoryScores: full.audit.categoryScores as CompareInput["categoryScores"], counts: full.audit.counts ?? null, issues: full.issues, pages: full.pages, performance: full.performance };
}

/**
 * Progress between the two most recent audits, plus Search Console movement.
 * Search data comes from stored snapshots only; with a single snapshot the
 * comparison uses Google's own previous 28-day period from that snapshot.
 */
export async function siteProgress(db: SaasDb, context: TenantContext, siteId: number): Promise<SiteProgress> {
  const audits = await auditSeries(db, context, siteId);
  const snapshots = await db.select().from(schema.searchSnapshots).where(and(eq(schema.searchSnapshots.tenantId, context.tenantId), eq(schema.searchSnapshots.siteId, siteId), eq(schema.searchSnapshots.status, "ok"))).orderBy(asc(schema.searchSnapshots.fetchedAt)).limit(200);
  const [prev, curr] = [audits.at(-2) ?? null, audits.at(-1) ?? null];

  const onSite: MetricChange[] = [];
  let issues: SiteProgress["issues"] = null;
  if (curr) {
    const coverageNote =
      prev && Math.abs(prev.coverage - curr.coverage) > 0.01
        ? `Coverage changed (${Math.round(prev.coverage * 100)}% → ${Math.round(curr.coverage * 100)}%), so part of this change reflects categories measured in only one audit.`
        : undefined;
    onSite.push({ label: "On-site SEO health", previous: prev?.overall ?? null, current: curr.overall, trend: trend(prev?.overall ?? null, curr.overall, true), note: coverageNote, format: "score" });
    onSite.push({ label: "Technical health", previous: prev?.categories.technical ?? null, current: curr.categories.technical ?? null, trend: trend(prev?.categories.technical ?? null, curr.categories.technical ?? null, true), format: "score" });
    const total = (p: AuditPoint | null) => (p ? (p.counts.critical ?? 0) + (p.counts.high ?? 0) + (p.counts.medium ?? 0) + (p.counts.low ?? 0) : null);
    onSite.push({ label: "Detected issues", previous: total(prev), current: total(curr), trend: trend(total(prev), total(curr), false), format: "count" });
    onSite.push({ label: "Critical + high issues", previous: prev ? (prev.counts.critical ?? 0) + (prev.counts.high ?? 0) : null, current: (curr.counts.critical ?? 0) + (curr.counts.high ?? 0), trend: trend(prev ? (prev.counts.critical ?? 0) + (prev.counts.high ?? 0) : null, (curr.counts.critical ?? 0) + (curr.counts.high ?? 0), false), format: "count" });
    if (prev) {
      const a = await compareInput(db, context, prev.id);
      const b = await compareInput(db, context, curr.id);
      if (a && b) {
        const r = compareAudits(a, b);
        issues = { fixed: r.fixed.length, introduced: r.introduced.length, outstanding: r.outstanding.length };
      }
    }
  }

  const search: MetricChange[] = [];
  let searchBasis: string | null = null;
  const latest = snapshots.at(-1);
  if (latest) {
    // Prefer the latest snapshot taken at or before the previous audit; fall back to Google's previous period.
    const earlier = prev ? [...snapshots].reverse().find((s) => s !== latest && s.fetchedAt <= curr!.completedAt && s.endDate < latest.endDate) : undefined;
    const base = earlier
      ? { clicks: earlier.clicks, impressions: earlier.impressions, ctr: earlier.ctr, position: earlier.position }
      : latest.previous ?? null;
    searchBasis = earlier
      ? `28 days to ${latest.endDate} compared with the 28 days to ${earlier.endDate} (snapshot taken ${earlier.fetchedAt.toISOString().slice(0, 10)}).`
      : `28 days to ${latest.endDate} compared with the preceding 28 days (from Google's data).`;
    const hasPos = (latest.impressions ?? 0) > 0 && (base?.impressions ?? 0) > 0;
    search.push({ label: "Clicks", previous: base?.clicks ?? null, current: latest.clicks, trend: trend(base?.clicks ?? null, latest.clicks, true), format: "count" });
    search.push({ label: "Impressions", previous: base?.impressions ?? null, current: latest.impressions, trend: trend(base?.impressions ?? null, latest.impressions, true), format: "count" });
    search.push({ label: "CTR", previous: base?.ctr ?? null, current: latest.ctr, trend: trend(base?.ctr ?? null, latest.ctr, true, 0.0005), format: "percent" });
    search.push({ label: "Average position", previous: hasPos ? base!.position : null, current: (latest.impressions ?? 0) > 0 ? latest.position : null, trend: hasPos ? trend(base!.position, latest.position, false, 0.1) : "unavailable", format: "position", note: "Lower is better." });
  }

  return { audits, snapshots, onSite, issues, search, searchBasis };
}
