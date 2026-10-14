import "server-only";
import { eq, sql } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import { crawlSite, CrawlError } from "@/lib/crawler/crawl";
import { assertSafeUrl } from "@/lib/crawler/ssrf";
import { isUtilityPage } from "./checks/helpers";
import { normalizeInputUrl, stripWww } from "@/lib/crawler/url";
import { runPageSpeed } from "@/lib/performance/pagespeed";
import { runChecks } from "./checks";
import { collectLocalSignals } from "./local-signals";
import { computeCounts, computeScores } from "./scoring";
import type { AuditContext, CrawlResult, PageData, PerformanceResult } from "./types";

export class AuditBusyError extends Error {}

const MAX_CONCURRENT_AUDITS = 2;
const running = ((globalThis as unknown as { __seoRunning?: Set<number> }).__seoRunning ??= new Set<number>());

export function runningAuditCount(): number {
  return running.size;
}

/** Validates the URL, records a queued audit and starts it in the background. */
export function startAudit(inputUrl: string): number {
  const startUrl = normalizeInputUrl(inputUrl);
  assertSafeUrl(startUrl);
  if (running.size >= MAX_CONCURRENT_AUDITS) {
    throw new AuditBusyError(`${running.size} audits are already running. Please wait for one to finish.`);
  }
  const db = getDb();
  const host = stripWww(new URL(startUrl).hostname);
  const site = db
    .insert(schema.sites)
    .values({ host, displayUrl: startUrl })
    .onConflictDoUpdate({ target: schema.sites.host, set: { displayUrl: startUrl } })
    .returning()
    .get();
  const audit = db
    .insert(schema.audits)
    .values({ siteId: site.id, inputUrl, startUrl, status: "queued", stage: "Queued", progress: 0 })
    .returning()
    .get();
  running.add(audit.id);
  void runAudit(audit.id, startUrl).finally(() => running.delete(audit.id));
  return audit.id;
}

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

/** Homepage plus the most-linked content pages: a representative PageSpeed sample. */
export function selectPerformancePages(crawl: CrawlResult, max: number): string[] {
  const candidates = crawl.pages.filter((p) => p.extracted && p.status === 200 && !p.extracted.metaRobots?.includes("noindex"));
  const home = candidates.find((p) => p.depth === 0);
  const others = candidates
    .filter((p) => p !== home && !isUtilityPage(p.finalUrl))
    .map((p) => ({ url: p.finalUrl, inbound: (crawl.inlinks[p.finalUrl] ?? crawl.inlinks[p.url] ?? []).length }))
    .sort((a, b) => b.inbound - a.inbound);
  return [...new Set([home?.finalUrl, ...others.map((o) => o.url)].filter((u): u is string => !!u))].slice(0, max);
}

async function runPerformance(crawl: CrawlResult, report: (p: number, m: string, force?: boolean) => void): Promise<{ results: PerformanceResult[]; skipped?: string }> {
  if (config.pagespeed.maxPages === 0) return { results: [], skipped: "PageSpeed testing is disabled (PAGESPEED_MAX_PAGES=0)." };
  const urls = selectPerformancePages(crawl, config.pagespeed.maxPages);
  if (!urls.length) return { results: [], skipped: "No successfully crawled HTML pages were available for PageSpeed testing." };
  const jobs = urls.flatMap((url) => (["mobile", "desktop"] as const).map((strategy) => ({ url, strategy })));
  const results: PerformanceResult[] = [];
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        report(70 + (done / jobs.length) * 22, `PageSpeed Insights (${job.strategy}): ${job.url}`, true);
        let result = await runPageSpeed(job.url, job.strategy, config.pagespeedApiKey, config.pagespeed.timeoutMs);
        // One retry for transient failures (not quota errors).
        if (result.status === "unavailable" && !/429|quota/i.test(result.error ?? "")) {
          result = await runPageSpeed(job.url, job.strategy, config.pagespeedApiKey, config.pagespeed.timeoutMs);
        }
        results.push(result);
        done++;
      }
    }),
  );
  return { results };
}

function slimPage(page: PageData): Record<string, unknown> {
  if (!page.extracted) return { ...page };
  const { shingles: _shingles, bodyText, ...extracted } = page.extracted;
  return { ...page, extracted: { ...extracted, bodyText: bodyText.slice(0, 1500) } };
}

async function runAudit(auditId: number, startUrl: string): Promise<void> {
  const db = getDb();
  const report = progressUpdater(auditId);
  db.update(schema.audits).set({ status: "running", startedAt: new Date(), stage: "Starting" }).where(eq(schema.audits.id, auditId)).run();

  try {
    const crawl = await crawlSite(startUrl, { ...config.crawl, onProgress: (p, m) => report(p, m) });
    report(68, `Crawled ${crawl.pages.length} pages. Running PageSpeed Insights…`, true);
    const perf = await runPerformance(crawl, report);

    report(94, "Analysing findings", true);
    const ctx: AuditContext = { ...crawl, performance: perf.results, performanceSkippedReason: perf.skipped };
    const checks = runChecks(ctx);
    const issues = checks.flatMap((c) => c.issues);
    const scores = computeScores(checks);
    const counts = computeCounts(checks, issues);
    const local = collectLocalSignals(ctx);

    const meta = {
      siteHost: crawl.siteHost,
      origin: crawl.origin,
      robots: { ...crawl.robots, content: crawl.robots.content?.slice(0, 5000) },
      sitemap: { files: crawl.sitemap.files, found: crawl.sitemap.found, urlCount: crawl.sitemap.urls.length, sampleUrls: crawl.sitemap.urls.slice(0, 100) },
      httpToHttps: crawl.httpToHttps,
      hostVariant: crawl.hostVariant,
      notFoundProbe: crawl.notFoundProbe,
      blockedByRobots: crawl.blockedByRobots.slice(0, 100),
      discoveredUrlCount: crawl.discoveredUrlCount,
      uncheckedLinkCount: crawl.uncheckedLinkCount,
      linkTargetsChecked: Object.keys(crawl.linkChecks).length,
      notes: crawl.notes,
      local,
      performanceSkippedReason: perf.skipped ?? null,
      pagespeedKeyConfigured: !!config.pagespeedApiKey,
      limits: { maxPages: config.crawl.maxPages, pagespeedPages: config.pagespeed.maxPages },
    };

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
