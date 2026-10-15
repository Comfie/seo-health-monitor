import "server-only";
import { eq, sql } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import { crawlSite, CrawlError } from "@/lib/crawler/crawl";
import { runPerformanceJobs } from "@/lib/performance/run";
import { analyseAudit, buildAuditMeta, selectPerformancePages, slimPage } from "./pipeline";
import { fetchSnapshot, getSiteConnection } from "@/lib/integrations/search-console/service";
import { searchConsoleContext } from "./index-status";
import type { AuditContext, CrawlResult, PerformanceResult } from "./types";

function progressUpdater(auditId: number) {
  const db = getDb();
  let lastWrite = 0;
  return (percent: number, message: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 400) return;
    lastWrite = now;
    db.update(schema.audits)
      .set({
        progress: Math.min(99, Math.round(percent)),
        stage: message.slice(0, 300),
        log: sql`json_insert(${schema.audits.log}, '$[#]', ${`${new Date().toISOString().slice(11, 19)} ${message.slice(0, 300)}`})`,
      })
      .where(eq(schema.audits.id, auditId))
      .run();
  };
}

export { selectPerformancePages };

async function runPerformance(crawl: CrawlResult, report: (p: number, m: string, force?: boolean) => void): Promise<{ results: PerformanceResult[]; skipped?: string }> {
  if (config.pagespeed.maxPages === 0) return { results: [], skipped: "PageSpeed testing is disabled (PAGESPEED_MAX_PAGES=0)." };
  const urls = selectPerformancePages(crawl, config.pagespeed.maxPages);
  if (!urls.length) return { results: [], skipped: "No successfully crawled HTML pages were available for PageSpeed testing." };
  const results = await runPerformanceJobs(urls, {
    apiKey: config.pagespeedApiKey,
    timeoutMs: config.pagespeed.timeoutMs,
    // Anonymous quota is tiny; don't burst it.
    concurrency: config.pagespeedApiKey ? 2 : 1,
    onProgress: (done, total, label) => report(70 + (done / total) * 22, label, true),
  });
  return { results };
}

/** Runs one claimed audit end to end. Called by the queue worker. Never throws. */
export async function executeAudit(auditId: number, startUrl: string): Promise<void> {
  const db = getDb();
  const report = progressUpdater(auditId);

  try {
    const crawl = await crawlSite(startUrl, { ...config.crawl, onProgress: (p, m) => report(p, m) });
    report(68, `Crawled ${crawl.pages.length} pages. Running PageSpeed Insights…`, true);
    const perf = await runPerformance(crawl, report);

    report(94, "Analysing findings", true);
    // Search Console: store a fresh snapshot (separate from scores) and give the
    // weight-0 "Google index coverage" check Google's index status for these pages.
    const siteId = db.select({ siteId: schema.audits.siteId }).from(schema.audits).where(eq(schema.audits.id, auditId)).get()!.siteId;
    const pageUrls = crawl.pages.filter((p) => p.status === 200 && p.isHtml).map((p) => p.finalUrl);
    if (getSiteConnection(siteId)) {
      report(93, "Fetching Google Search Console data", true);
      await fetchSnapshot(siteId, { auditId, pageUrls }).catch((err) => console.error(`[audit ${auditId}] Search Console snapshot failed`, err));
    }
    const ctx: AuditContext = { ...crawl, performance: perf.results, performanceSkippedReason: perf.skipped, searchConsole: searchConsoleContext(siteId, pageUrls) };
    const { checks, issues, scores, counts, local } = analyseAudit(ctx);

    const meta = buildAuditMeta(crawl, perf, local, { pagespeedKeyConfigured: !!config.pagespeedApiKey, limits: { maxPages: config.crawl.maxPages, pagespeedPages: config.pagespeed.maxPages } });

    db.transaction((tx) => {
      for (const page of crawl.pages) {
        tx.insert(schema.pages)
          .values({
            auditId,
            url: page.url,
            finalUrl: page.finalUrl,
            status: page.status,
            depth: page.depth,
            source: page.source,
            title: page.extracted?.title ?? null,
            metaDescription: page.extracted?.metaDescription ?? null,
            h1: page.extracted?.h1s[0] ?? null,
            canonical: page.extracted?.canonicals[0] ?? null,
            metaRobots: page.extracted?.metaRobots ?? page.xRobotsTag ?? null,
            wordCount: page.extracted?.wordCount ?? null,
            responseTimeMs: page.responseTimeMs,
            data: slimPage(page),
          })
          .run();
      }
      for (const c of checks) {
        tx.insert(schema.checks)
          .values({ auditId, checkId: c.id, category: c.category, title: c.title, description: c.description, status: c.status, score: c.score, weight: c.weight, summary: c.summary, unavailableReason: c.unavailableReason ?? null, affectedCount: c.issues.length })
          .run();
      }
      for (const i of issues) {
        tx.insert(schema.issues)
          .values({ auditId, issueKey: i.key, checkId: i.checkId, category: i.category, severity: i.severity, title: i.title, url: i.url, evidence: i.evidence, why: i.why, fix: i.fix, implementation: i.implementation, benefit: i.benefit, impact: i.impact, confidence: i.confidence, effort: i.effort, priorityScore: i.priorityScore })
          .onConflictDoNothing()
          .run();
      }
      for (const r of perf.results) {
        tx.insert(schema.performanceResults)
          .values({
            auditId,
            url: r.url,
            strategy: r.strategy,
            status: r.status,
            error: r.error ?? null,
            performanceScore: r.performanceScore ?? null,
            lcpMs: r.lcpMs ?? null,
            cls: r.cls ?? null,
            tbtMs: r.tbtMs ?? null,
            fcpMs: r.fcpMs ?? null,
            speedIndexMs: r.speedIndexMs ?? null,
            ttfbMs: r.ttfbMs ?? null,
            fieldLcpMs: r.fieldLcpMs ?? null,
            fieldInpMs: r.fieldInpMs ?? null,
            fieldCls: r.fieldCls ?? null,
            fieldCategory: r.fieldCategory ?? null,
            fieldSource: r.fieldSource ?? null,
            opportunities: r.opportunities,
          })
          .run();
      }
      tx.update(schema.audits)
        .set({
          status: "completed",
          stage: "Completed",
          progress: 100,
          overallScore: scores.overall,
          categoryScores: scores.categories,
          counts: { ...counts },
          pagesScanned: crawl.pages.length,
          meta,
          completedAt: new Date(),
        })
        .where(eq(schema.audits.id, auditId))
        .run();
    });

  } catch (err) {
    const message =
      err instanceof CrawlError || (err as Error).name === "UrlValidationError" || (err as { code?: string }).code === "SSRF_BLOCKED"
        ? (err as Error).message
        : `The audit failed unexpectedly: ${(err as Error).message}`;
    console.error(`[audit ${auditId}]`, err);
    db.update(schema.audits).set({ status: "failed", error: message, stage: "Failed", completedAt: new Date() }).where(eq(schema.audits.id, auditId)).run();
  }
}
