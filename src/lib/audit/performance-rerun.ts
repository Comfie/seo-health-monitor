import "server-only";
import { and, eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import { runPerformanceJobs } from "@/lib/performance/run";
import { runChecks } from "./checks";
import { performanceChecks } from "./checks/performance";
import { getFullAudit } from "./repository";
import { selectPerformancePages } from "./runner";
import { computeCounts, computeScores } from "./scoring";
import type { AuditContext, CrawlResult, PageData } from "./types";

const inFlight = ((globalThis as unknown as { __perfRerun?: Set<number> }).__perfRerun ??= new Set<number>());

export class RerunError extends Error {}

/** Rebuilds the inbound-link map from stored pages so page selection matches the original audit. */
function inlinksFrom(pages: PageData[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const p of pages) for (const l of p.extracted?.links ?? []) if (l.internal) (map[l.href] ??= []).push(p.finalUrl);
  return map;
}

/**
 * Re-runs only PageSpeed Insights for a completed audit (e.g. after a quota
 * error or adding an API key), replaces its performance checks and issues, and
 * recomputes the audit's scores. Other categories are untouched.
 */
export async function rerunAuditPerformance(auditId: number): Promise<{ measured: number; total: number }> {
  const full = getFullAudit(auditId);
  if (!full) throw new RerunError("Audit not found.");
  if (full.audit.status !== "completed") throw new RerunError("Only completed audits can be re-tested.");
  if (inFlight.has(auditId)) throw new RerunError("PageSpeed tests are already running for this audit.");
  if (config.pagespeed.maxPages === 0) throw new RerunError("PageSpeed testing is disabled (PAGESPEED_MAX_PAGES=0).");

  inFlight.add(auditId);
  try {
    const pages = full.pages.map((p) => p.data);
    const previousUrls = [...new Set(full.performance.map((p) => p.url))];
    const urls = previousUrls.length ? previousUrls : selectPerformancePages({ pages, inlinks: inlinksFrom(pages) } as CrawlResult, config.pagespeed.maxPages);
    if (!urls.length) throw new RerunError("No crawled HTML pages are available to test.");

    const results = await runPerformanceJobs(urls, { apiKey: config.pagespeedApiKey, timeoutMs: config.pagespeed.timeoutMs, concurrency: config.pagespeedApiKey ? 2 : 1 });
    // Performance checks only read ctx.performance; the rest of the context is not needed.
    const perfChecks = runChecks({ performance: results } as AuditContext, performanceChecks);
    const perfIssues = perfChecks.flatMap((c) => c.issues);

    const db = getDb();
    db.transaction((tx) => {
      tx.delete(schema.performanceResults).where(eq(schema.performanceResults.auditId, auditId)).run();
      tx.delete(schema.checks).where(and(eq(schema.checks.auditId, auditId), eq(schema.checks.category, "performance"))).run();
      tx.delete(schema.issues).where(and(eq(schema.issues.auditId, auditId), eq(schema.issues.category, "performance"))).run();
      for (const r of results) {
        tx.insert(schema.performanceResults)
          .values({ auditId, url: r.url, strategy: r.strategy, status: r.status, error: r.error ?? null, performanceScore: r.performanceScore ?? null, lcpMs: r.lcpMs ?? null, cls: r.cls ?? null, tbtMs: r.tbtMs ?? null, fcpMs: r.fcpMs ?? null, speedIndexMs: r.speedIndexMs ?? null, ttfbMs: r.ttfbMs ?? null, fieldLcpMs: r.fieldLcpMs ?? null, fieldInpMs: r.fieldInpMs ?? null, fieldCls: r.fieldCls ?? null, fieldCategory: r.fieldCategory ?? null, fieldSource: r.fieldSource ?? null, opportunities: r.opportunities })
          .run();
      }
      for (const c of perfChecks) {
        tx.insert(schema.checks).values({ auditId, checkId: c.id, category: c.category, title: c.title, description: c.description, status: c.status, score: c.score, weight: c.weight, summary: c.summary, unavailableReason: c.unavailableReason ?? null, affectedCount: c.issues.length }).run();
      }
      for (const i of perfIssues) {
        tx.insert(schema.issues).values({ auditId, issueKey: i.key, checkId: i.checkId, category: i.category, severity: i.severity, title: i.title, url: i.url, evidence: i.evidence, why: i.why, fix: i.fix, implementation: i.implementation, benefit: i.benefit, impact: i.impact, confidence: i.confidence, effort: i.effort, priorityScore: i.priorityScore }).onConflictDoNothing().run();
      }
      // Recompute scores from every stored check so other categories keep their results.
      const allChecks = tx.select().from(schema.checks).where(eq(schema.checks.auditId, auditId)).all();
      const allIssues = tx.select().from(schema.issues).where(eq(schema.issues.auditId, auditId)).all();
      const scores = computeScores(allChecks);
      const meta = { ...(full.audit.meta ?? {}), performanceSkippedReason: null, pagespeedKeyConfigured: !!config.pagespeedApiKey };
      tx.update(schema.audits)
        .set({ overallScore: scores.overall, categoryScores: scores.categories, counts: { ...computeCounts(allChecks, allIssues) }, meta })
        .where(eq(schema.audits.id, auditId))
        .run();
    });
    return { measured: results.filter((r) => r.status === "ok").length, total: results.length };
  } finally {
    inFlight.delete(auditId);
  }
}
