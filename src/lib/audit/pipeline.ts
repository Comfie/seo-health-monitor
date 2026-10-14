import { isUtilityPage } from "./checks/helpers";
import { runChecks } from "./checks";
import { collectLocalSignals } from "./local-signals";
import { computeCounts, computeScores } from "./scoring";
import type { AuditContext, CrawlResult, PageData, PerformanceResult } from "./types";

/**
 * Storage-independent audit steps shared by the Phase 1 SQLite runner and the
 * tenant PostgreSQL runner, so both produce identical checks, scores and metadata.
 */

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

/** Rebuilds the inbound-link map from stored pages so page selection matches the original audit. */
export function inlinksFrom(pages: PageData[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const p of pages) for (const l of p.extracted?.links ?? []) if (l.internal) (map[l.href] ??= []).push(p.finalUrl);
  return map;
}

export function slimPage(page: PageData): Record<string, unknown> {
  if (!page.extracted) return { ...page };
  const { shingles: _shingles, bodyText, ...extracted } = page.extracted;
  return { ...page, extracted: { ...extracted, bodyText: bodyText.slice(0, 1500) } };
}

export function analyseAudit(ctx: AuditContext) {
  const checks = runChecks(ctx);
  const issues = checks.flatMap((c) => c.issues);
  return { checks, issues, scores: computeScores(checks), counts: computeCounts(checks, issues), local: collectLocalSignals(ctx) };
}

export function buildAuditMeta(
  crawl: CrawlResult,
  perf: { results: PerformanceResult[]; skipped?: string },
  local: ReturnType<typeof collectLocalSignals>,
  extra: { pagespeedKeyConfigured: boolean; limits: { maxPages: number; pagespeedPages: number } },
) {
  return {
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
    pagespeedKeyConfigured: extra.pagespeedKeyConfigured,
    limits: extra.limits,
  };
}

/** Column values for one stored page row (shared by both storage engines). */
export function pageRow(page: PageData) {
  return {
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
  };
}

export function performanceRow(r: PerformanceResult) {
  return {
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
  };
}
