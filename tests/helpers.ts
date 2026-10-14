import { buildPageData } from "@/lib/crawler/crawl";
import type { FetchResult } from "@/lib/crawler/http";
import type { AuditContext, PageData } from "@/lib/audit/types";

export const SITE = "example.com";
export const ORIGIN = "https://example.com";

export function htmlPage(path: string, html: string, opts: Partial<{ status: number; depth: number; inSitemap: boolean; headers: Record<string, string> }> = {}): PageData {
  const url = `${ORIGIN}${path}`;
  const res: FetchResult = {
    requestedUrl: url,
    finalUrl: url,
    status: opts.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...opts.headers },
    body: Buffer.from(html),
    redirectChain: [],
    truncated: false,
    timeMs: 120,
  };
  return buildPageData(res, { url, depth: opts.depth ?? (path === "/" ? 0 : 1), source: path === "/" ? "start" : "link", inSitemap: opts.inSitemap ?? false }, SITE);
}

export function page(body: string, head = ""): string {
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1">${head}</head><body>${body}</body></html>`;
}

export function context(pages: PageData[], overrides: Partial<AuditContext> = {}): AuditContext {
  const inlinks: Record<string, string[]> = {};
  for (const p of pages) {
    for (const l of p.extracted?.links ?? []) {
      if (!l.internal) continue;
      (inlinks[l.href] ??= []).push(p.finalUrl);
    }
  }
  const linkChecks = Object.fromEntries(pages.map((p) => [p.url, { url: p.url, status: p.status, finalUrl: p.finalUrl, redirectChain: p.redirectChain }]));
  return {
    inputUrl: ORIGIN,
    startUrl: `${ORIGIN}/`,
    siteHost: SITE,
    origin: ORIGIN,
    homepage: pages.find((p) => p.depth === 0) ?? null,
    pages,
    robots: { url: `${ORIGIN}/robots.txt`, status: 200, found: true, sitemaps: [`${ORIGIN}/sitemap.xml`], blocksAllForAll: false, blocksAllForGoogle: false },
    sitemap: { files: [{ url: `${ORIGIN}/sitemap.xml`, status: 200, kind: "urlset", urlCount: pages.length }], urls: pages.map((p) => p.url), found: true },
    linkChecks,
    inlinks,
    uncheckedLinkCount: 0,
    blockedByRobots: [],
    discoveredUrlCount: pages.length,
    httpToHttps: { testedUrl: `http://${SITE}/`, status: 200, finalUrl: `${ORIGIN}/`, redirectChain: [{ url: `http://${SITE}/`, status: 301, location: `${ORIGIN}/` }] },
    hostVariant: { testedUrl: `https://www.${SITE}/`, status: 200, finalUrl: `${ORIGIN}/`, redirectChain: [{ url: `https://www.${SITE}/`, status: 301, location: `${ORIGIN}/` }] },
    notFoundProbe: { testedUrl: `${ORIGIN}/missing-xyz`, status: 404, finalUrl: `${ORIGIN}/missing-xyz`, redirectChain: [] },
    notes: [],
    performance: [],
    performanceSkippedReason: "Not run in tests.",
    ...overrides,
  };
}
