import "server-only";
import { recordEvent } from "./telemetry";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { crawlSite, CrawlError, type CrawlOptions } from "@/lib/crawler/crawl";
import { assertSafeUrl } from "@/lib/crawler/ssrf";
import { runPerformanceJobs } from "@/lib/performance/run";
import { runPageSpeed } from "@/lib/performance/pagespeed";
import { runChecks } from "@/lib/audit/checks";
import { performanceChecks } from "@/lib/audit/checks/performance";
import { analyseAudit, buildAuditMeta, inlinksFrom, pageRow, performanceRow, selectPerformancePages } from "@/lib/audit/pipeline";
import { computeCounts, computeScores } from "@/lib/audit/scoring";
import type { AuditContext, CheckResult, CrawlResult, Issue, PageData, PerformanceResult } from "@/lib/audit/types";
import type { SaasDb } from "./db";
import { completeJob, failJob, finalizeCancelled, JobCancelledError, LeaseLostError, reportProgress, type Lease, type QueueTiming } from "./jobs";
import type { GoogleConfig } from "./config";
import { BudgetExhaustedError, reserveUsage, type LimitSettings } from "./limits";
import { activity } from "./operations-schema";
import * as schema from "./schema";
import { collectForAudit, storeAuditSnapshot } from "./search-console";

export type RunnerDeps = {
  db: SaasDb;
  settings: LimitSettings;
  timing?: QueueTiming;
  /** Test seams; default to the real crawler and PageSpeed client. */
  crawl?: (url: string, options: CrawlOptions) => Promise<CrawlResult>;
  pagespeed?: typeof runPageSpeed;
  pagespeedApiKey?: string;
  /** Customer Search Console; omitted or unavailable means index status is reported as not verified. */
  google?: GoogleConfig;
  now?: () => Date;
};

export type RunOutcome = "completed" | "retry" | "failed" | "cancelled" | "stale";

type Tx = Parameters<Parameters<SaasDb["transaction"]>[0]>[0];
const CHUNK = 100;

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

const checkRow = (tenantId: string, auditId: number, c: CheckResult) => ({
  tenantId, auditId, checkId: c.id, category: c.category, title: c.title, description: c.description, status: c.status, score: c.score,
  weight: c.weight, summary: c.summary, unavailableReason: c.unavailableReason ?? null, affectedCount: c.issues.length,
});
const issueRow = (tenantId: string, auditId: number, i: Issue) => ({
  tenantId, auditId, issueKey: i.key, checkId: i.checkId, category: i.category, severity: i.severity, title: i.title, url: i.url, evidence: i.evidence,
  why: i.why, fix: i.fix, implementation: i.implementation, benefit: i.benefit, impact: i.impact, confidence: i.confidence, effort: i.effort, priorityScore: i.priorityScore,
});

/** Customer-facing message for an error; internal details stay in server logs. */
function classify(error: unknown): { message: string; retryable: boolean } {
  const e = error as Error & { code?: string };
  if (error instanceof CrawlError || e?.name === "UrlValidationError" || e?.code === "SSRF_BLOCKED" || e?.name === "SsrfError") {
    return { message: e.message, retryable: false };
  }
  return { message: "The audit failed unexpectedly. It is retried automatically a limited number of times.", retryable: true };
}

/** PageSpeed tests with per-test budget reservation (tenant monthly + global daily). */
async function measure(deps: RunnerDeps, lease: Lease, urls: string[], signal: AbortSignal, onProgress?: (done: number, total: number, label: string) => void) {
  const apiKey = deps.pagespeedApiKey ?? config.pagespeedApiKey;
  const results = await runPerformanceJobs(urls, {
    apiKey,
    timeoutMs: config.pagespeed.timeoutMs,
    concurrency: apiKey ? 2 : 1,
    run: async (...args) => {
      const result = await (deps.pagespeed ?? runPageSpeed)(...args);
      if (result.status === "unavailable") await recordEvent(deps.db, "pagespeed.failure", lease.tenantId);
      return result;
    },
    signal,
    onProgress,
    beforeTest: async () => {
      try {
        await reserveUsage(deps.db, { tenantId: lease.tenantId, auditId: lease.auditId, kind: "pagespeed", settings: deps.settings, now: deps.now?.() });
        return null;
      } catch (error) {
        if (error instanceof BudgetExhaustedError) return error.message;
        throw error;
      }
    },
  });
  return results;
}

async function runAudit(deps: RunnerDeps, lease: Lease, signal: AbortSignal, abort: (reason: Error) => void) {
  const { db } = deps;
  const [audit] = await db.select().from(schema.audits).where(and(eq(schema.audits.tenantId, lease.tenantId), eq(schema.audits.id, lease.auditId)));
  if (!audit) throw new LeaseLostError();
  // DNS-at-connect SSRF checks run again inside the crawler for every request and redirect.
  assertSafeUrl(audit.startUrl);
  const maxPages = Math.min(100, Math.max(1, lease.payload.maxPages ?? deps.settings.tenant.pagesPerScan));
  const pagespeedPages = Math.min(10, Math.max(0, lease.payload.pagespeedPages ?? deps.settings.global.pagespeedPagesPerAudit));

  let lastWrite = 0;
  const report = (percent: number, message: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 400) return;
    lastWrite = now;
    void reportProgress(db, lease, percent, message, deps.now?.()).then((ok) => { if (!ok) abort(new LeaseLostError()); }).catch(() => {});
  };

  signal.throwIfAborted();
  const crawl = await (deps.crawl ?? crawlSite)(audit.startUrl, { ...config.crawl, maxPages, signal, onProgress: (p, m) => report(p, m) });
  signal.throwIfAborted();

  let perf: { results: PerformanceResult[]; skipped?: string };
  const urls = selectPerformancePages(crawl, pagespeedPages);
  if (pagespeedPages === 0) perf = { results: [], skipped: "PageSpeed testing is disabled for the beta." };
  else if (!urls.length) perf = { results: [], skipped: "No successfully crawled HTML pages were available for PageSpeed testing." };
  else {
    report(68, `Crawled ${crawl.pages.length} pages. Running PageSpeed Insights…`, true);
    perf = { results: await measure(deps, lease, urls, signal, (done, total, label) => report(70 + (done / total) * 22, label, true)) };
  }
  signal.throwIfAborted();
  // Owner-authorised Google data for this tenant only (tenant from the lease). Never fails the audit.
  const gsc = await collectForAudit(db, deps.google, lease, audit.siteId, crawl, deps.now?.());
  if (gsc.snapshot) report(93, "Fetched Google Search Console data", true);
  signal.throwIfAborted();
  report(94, "Analysing findings", true);

  const ctx: AuditContext = { ...crawl, performance: perf.results, performanceSkippedReason: perf.skipped, searchConsole: gsc.context };
  const { checks, issues, scores, counts, local } = analyseAudit(ctx);
  const meta = buildAuditMeta(crawl, perf, local, { pagespeedKeyConfigured: !!(deps.pagespeedApiKey ?? config.pagespeedApiKey), limits: { maxPages, pagespeedPages } });
  const now = deps.now?.() ?? new Date();

  await completeJob(db, lease, async (tx: Tx) => {
    // Idempotent: a retry replaces anything a previous attempt of this audit could have stored.
    const t = lease.tenantId, a = lease.auditId;
    await tx.delete(schema.pages).where(and(eq(schema.pages.tenantId, t), eq(schema.pages.auditId, a)));
    await tx.delete(schema.checks).where(and(eq(schema.checks.tenantId, t), eq(schema.checks.auditId, a)));
    await tx.delete(schema.issues).where(and(eq(schema.issues.tenantId, t), eq(schema.issues.auditId, a)));
    await tx.delete(schema.performanceResults).where(and(eq(schema.performanceResults.tenantId, t), eq(schema.performanceResults.auditId, a)));
    await insertChunks(crawl.pages, (rows) => tx.insert(schema.pages).values(rows.map((p) => ({ tenantId: lease.tenantId, auditId: lease.auditId, ...pageRow(p) }))));
    await insertChunks(checks, (rows) => tx.insert(schema.checks).values(rows.map((c) => checkRow(lease.tenantId, lease.auditId, c))));
    await insertChunks(issues, (rows) => tx.insert(schema.issues).values(rows.map((i) => issueRow(lease.tenantId, lease.auditId, i))).onConflictDoNothing());
    await insertChunks(perf.results, (rows) => tx.insert(schema.performanceResults).values(rows.map((r) => ({ tenantId: lease.tenantId, auditId: lease.auditId, ...performanceRow(r) }))));
    await tx.delete(schema.searchSnapshots).where(and(eq(schema.searchSnapshots.tenantId, t), eq(schema.searchSnapshots.auditId, a)));
    await storeAuditSnapshot(tx, gsc.snapshot);
    await tx.update(schema.audits).set({
      status: "completed", stage: "Completed", progress: 100, overallScore: scores.overall, categoryScores: scores.categories,
      counts: { ...counts }, pagesScanned: crawl.pages.length, meta, completedAt: now, error: null,
    }).where(and(eq(schema.audits.tenantId, lease.tenantId), eq(schema.audits.id, lease.auditId)));
    await tx.insert(activity).values({ id: randomUUID(), tenantId: lease.tenantId, actorId: null, action: "audit.completed", metadata: { auditId: lease.auditId, host: crawl.siteHost } });
  }, now);
}

/** Re-runs only PageSpeed for a completed audit and recomputes its scores (other categories untouched). */
async function runPagespeedRerun(deps: RunnerDeps, lease: Lease, signal: AbortSignal) {
  const { db } = deps;
  const where = <T extends typeof schema.pages | typeof schema.performanceResults>(t: T) => and(eq(t.tenantId, lease.tenantId), eq(t.auditId, lease.auditId));
  const [audit] = await db.select().from(schema.audits).where(and(eq(schema.audits.tenantId, lease.tenantId), eq(schema.audits.id, lease.auditId)));
  if (!audit || audit.status !== "completed") throw new CrawlError("Only completed audits can be re-tested.");
  const pages = (await db.select().from(schema.pages).where(where(schema.pages)).orderBy(asc(schema.pages.depth), asc(schema.pages.id))).map((p) => p.data as unknown as PageData);
  const previous = [...new Set((await db.select({ url: schema.performanceResults.url }).from(schema.performanceResults).where(where(schema.performanceResults))).map((p) => p.url))];
  const sample = Math.min(10, Math.max(1, lease.payload.pagespeedPages ?? deps.settings.global.pagespeedPagesPerAudit));
  const urls = previous.length ? previous : selectPerformancePages({ pages, inlinks: inlinksFrom(pages) } as CrawlResult, sample);
  if (!urls.length) throw new CrawlError("No crawled HTML pages are available to test.");
  for (const url of urls) assertSafeUrl(url);

  const results = await measure(deps, lease, urls, signal);
  signal.throwIfAborted();
  const perfChecks = runChecks({ performance: results } as AuditContext, performanceChecks);
  const now = deps.now?.() ?? new Date();
  await completeJob(db, lease, async (tx) => {
    const t = lease.tenantId, a = lease.auditId;
    await tx.delete(schema.performanceResults).where(and(eq(schema.performanceResults.tenantId, t), eq(schema.performanceResults.auditId, a)));
    await tx.delete(schema.checks).where(and(eq(schema.checks.tenantId, t), eq(schema.checks.auditId, a), eq(schema.checks.category, "performance")));
    await tx.delete(schema.issues).where(and(eq(schema.issues.tenantId, t), eq(schema.issues.auditId, a), eq(schema.issues.category, "performance")));
    await insertChunks(results, (rows) => tx.insert(schema.performanceResults).values(rows.map((r) => ({ tenantId: t, auditId: a, ...performanceRow(r) }))));
    await insertChunks(perfChecks, (rows) => tx.insert(schema.checks).values(rows.map((c) => checkRow(t, a, c))));
    await insertChunks(perfChecks.flatMap((c) => c.issues), (rows) => tx.insert(schema.issues).values(rows.map((i) => issueRow(t, a, i))).onConflictDoNothing());
    const allChecks = await tx.select().from(schema.checks).where(and(eq(schema.checks.tenantId, t), eq(schema.checks.auditId, a)));
    const allIssues = await tx.select().from(schema.issues).where(and(eq(schema.issues.tenantId, t), eq(schema.issues.auditId, a)));
    const scores = computeScores(allChecks);
    const meta = { ...(audit.meta ?? {}), performanceSkippedReason: null, pagespeedKeyConfigured: !!(deps.pagespeedApiKey ?? config.pagespeedApiKey) };
    await tx.update(schema.audits).set({ overallScore: scores.overall, categoryScores: scores.categories, counts: { ...computeCounts(allChecks, allIssues) }, meta })
      .where(and(eq(schema.audits.tenantId, t), eq(schema.audits.id, a)));
    await tx.insert(activity).values({ id: randomUUID(), tenantId: t, actorId: null, action: "pagespeed.completed", metadata: { auditId: a, measured: results.filter((r) => r.status === "ok").length } });
  }, now);
}

/**
 * Executes one claimed job end to end. Never throws: every outcome is recorded under the
 * lease, and a lost lease means another worker owns the job, so nothing is written.
 */
export async function executeJob(deps: RunnerDeps, lease: Lease, control: { signal: AbortSignal; abort: (reason: Error) => void }): Promise<RunOutcome> {
  const now = () => deps.now?.() ?? new Date();
  try {
    if (lease.kind === "audit") await runAudit(deps, lease, control.signal, control.abort);
    else await runPagespeedRerun(deps, lease, control.signal);
    return "completed";
  } catch (raw) {
    const error = control.signal.aborted && !(raw instanceof LeaseLostError || raw instanceof JobCancelledError) ? control.signal.reason : raw;
    if (error instanceof LeaseLostError) return "stale";
    if (error instanceof JobCancelledError) return (await finalizeCancelled(deps.db, lease, now())) ? "cancelled" : "stale";
    // Job identifiers only: crawled URLs and provider errors can contain customer data.
    console.error(`[beta-worker] job ${lease.jobId} attempt ${lease.attempts} failed: ${(error as Error)?.name ?? "Error"}`);
    try {
      return await failJob(deps.db, lease, classify(error), deps.timing, now());
    } catch {
      return "stale";
    }
  }
}
