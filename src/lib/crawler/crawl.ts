import crypto from "node:crypto";
import * as cheerio from "cheerio";
import type { CrawlResult, HostCheck, LinkCheck, PageData } from "@/lib/audit/types";
import { decodeBody, isHtmlResponse, safeFetch, type FetchResult } from "./http";
import { extractPage } from "./extract";
import { fetchRobots } from "./robots";
import { discoverSitemaps } from "./sitemap";
import { isCrawlableHtmlUrl, isLowValueUrl, isSameSite, normalizeInputUrl, normalizeUrl } from "./url";

export class CrawlError extends Error {}

export interface CrawlOptions {
  maxPages: number;
  concurrency: number;
  timeoutMs: number;
  maxBytes: number;
  maxLinkChecks: number;
  onProgress?: (percent: number, message: string) => void;
  /** Cooperative cancellation: checked between requests; in-flight requests keep their own timeouts. */
  signal?: AbortSignal;
}

interface QueueItem {
  url: string;
  depth: number;
  source: PageData["source"];
  tier: number;
  order: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function linkHeaderCanonical(header: string | undefined, base: string): string | null {
  if (!header) return null;
  const match = /<([^>]+)>\s*;[^,]*rel="?canonical"?/i.exec(header);
  if (!match) return null;
  try {
    return new URL(match[1], base).toString();
  } catch {
    return null;
  }
}

export function buildPageData(
  res: FetchResult,
  meta: { url: string; depth: number; source: PageData["source"]; inSitemap: boolean },
  siteHost: string,
): PageData {
  const isHtml = !res.error && isHtmlResponse(res);
  const page: PageData = {
    url: meta.url,
    finalUrl: normalizeUrl(res.finalUrl),
    status: res.status,
    redirectChain: res.redirectChain,
    contentType: res.headers["content-type"] ?? null,
    fetchError: res.error,
    responseTimeMs: res.timeMs,
    bytes: res.body.length,
    truncated: res.truncated,
    xRobotsTag: res.headers["x-robots-tag"] ?? null,
    depth: meta.depth,
    source: meta.source,
    inSitemap: meta.inSitemap,
    isHtml,
  };
  if (isHtml && res.status !== null && res.status < 400) {
    page.extracted = extractPage(decodeBody(res), page.finalUrl, siteHost);
    const headerCanonical = linkHeaderCanonical(res.headers["link"], page.finalUrl);
    if (headerCanonical && !page.extracted.canonicals.includes(headerCanonical)) {
      page.extracted.canonicals.push(headerCanonical);
    }
  }
  return page;
}

async function hostCheck(url: string, timeoutMs: number): Promise<HostCheck> {
  const res = await safeFetch(url, { timeoutMs, maxBytes: 300_000 });
  let canonical: string | null = null;
  if (!res.error && isHtmlResponse(res)) {
    const href = cheerio.load(decodeBody(res))('link[rel~="canonical" i]').attr("href");
    try {
      canonical = href ? new URL(href, res.finalUrl).toString() : null;
    } catch {
      canonical = null;
    }
  }
  return {
    testedUrl: url,
    status: res.status,
    finalUrl: res.error ? null : res.finalUrl,
    redirectChain: res.redirectChain,
    canonical,
    error: res.error,
  };
}

/** Crawls a site politely: robots.txt respected, bounded concurrency, page cap. */
export async function crawlSite(inputUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const progress = options.onProgress ?? (() => {});
  const stopIfAborted = () => options.signal?.throwIfAborted();
  const startUrl = normalizeInputUrl(inputUrl);
  const notes: string[] = [];

  progress(2, `Fetching ${startUrl}`);
  const home = await safeFetch(startUrl, { timeoutMs: options.timeoutMs, maxBytes: options.maxBytes });
  if (home.error && home.status === null) {
    throw new CrawlError(`Could not reach ${startUrl}: ${home.error}`);
  }
  const finalHome = new URL(home.finalUrl);
  if (!isSameSite(finalHome.toString(), new URL(startUrl).hostname)) {
    notes.push(`The start URL redirected to a different domain (${finalHome.hostname}); that domain was audited instead.`);
  }
  const siteHost = finalHome.hostname;
  const origin = finalHome.origin;

  stopIfAborted();
  progress(6, "Reading robots.txt");
  const robots = await fetchRobots(origin, options.timeoutMs);
  const crawlDelayMs = Math.min(5_000, Math.max(300, (robots.info.crawlDelay ?? 0) * 1000));
  if (robots.info.crawlDelay && robots.info.crawlDelay > 5) {
    notes.push(`robots.txt asks for a ${robots.info.crawlDelay}s crawl delay; the crawler capped it at 5s to keep the audit practical.`);
  }

  progress(10, "Discovering sitemaps");
  const sitemap = await discoverSitemaps(origin, robots.info.sitemaps, siteHost, options.timeoutMs);
  const sitemapSet = new Set(sitemap.urls);

  const pages: PageData[] = [];
  const linkChecks: Record<string, LinkCheck> = {};
  const inlinks = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const queued = new Map<string, QueueItem>();
  const blockedByRobots = new Set<string>();
  let order = 0;

  const enqueue = (url: string, depth: number, source: PageData["source"], tier: number) => {
    if (visited.has(url) || !isSameSite(url, siteHost) || !isCrawlableHtmlUrl(url)) return;
    const existing = queued.get(url);
    if (existing && existing.tier <= tier) return;
    queued.set(url, { url, depth, source, tier: isLowValueUrl(url) ? tier + 3 : tier, order: existing?.order ?? order++ });
  };

  const register = (page: PageData) => {
    pages.push(page);
    visited.add(page.url);
    visited.add(page.finalUrl);
    linkChecks[page.url] = { url: page.url, status: page.status, finalUrl: page.finalUrl, redirectChain: page.redirectChain, error: page.fetchError };
    for (const link of page.extracted?.links ?? []) {
      // Cloudflare email-obfuscation links are not real pages.
      if (!link.internal || /\/cdn-cgi\//.test(link.href)) continue;
      if (!inlinks.has(link.href)) inlinks.set(link.href, new Set());
      inlinks.get(link.href)!.add(page.finalUrl);
      enqueue(link.href, page.depth + 1, "link", page.depth === 0 ? 1 : 2 + page.depth);
    }
  };

  const homePage = buildPageData(home, { url: startUrl, depth: 0, source: "start", inSitemap: sitemapSet.has(normalizeUrl(home.finalUrl)) }, siteHost);
  register(homePage);
  for (const url of sitemap.urls) enqueue(url, 1, "sitemap", 2);
  if (!robots.isAllowed(homePage.finalUrl)) {
    notes.push("robots.txt disallows the homepage for this crawler; it was fetched once to run the audit but no further disallowed URLs were crawled.");
  }

  const nextItem = (): QueueItem | undefined => {
    let best: QueueItem | undefined;
    for (const item of queued.values()) {
      if (!best || item.tier < best.tier || (item.tier === best.tier && item.order < best.order)) best = item;
    }
    if (best) queued.delete(best.url);
    return best;
  };

  let inFlight = 0;
  const worker = async () => {
    while (!options.signal?.aborted && pages.length + inFlight < options.maxPages) {
      const item = nextItem();
      if (!item) {
        if (inFlight === 0) return;
        await sleep(200);
        continue;
      }
      if (visited.has(item.url)) continue;
      if (!robots.isAllowed(item.url)) {
        blockedByRobots.add(item.url);
        visited.add(item.url);
        continue;
      }
      visited.add(item.url);
      inFlight++;
      try {
        progress(12 + Math.round((pages.length / options.maxPages) * 48), `Crawling ${item.url}`);
        const res = await safeFetch(item.url, { timeoutMs: options.timeoutMs, maxBytes: options.maxBytes });
        const finalUrl = normalizeUrl(res.finalUrl);
        if (res.redirectChain.length > 0 && visited.has(finalUrl) && finalUrl !== item.url) {
          // Redirects to a page we already have: record the redirect, don't double-count the page.
          linkChecks[item.url] = { url: item.url, status: res.status, finalUrl, redirectChain: res.redirectChain, error: res.error };
        } else if (!isSameSite(finalUrl, siteHost)) {
          linkChecks[item.url] = { url: item.url, status: res.status, finalUrl, redirectChain: res.redirectChain, error: res.error };
        } else {
          register(buildPageData(res, { url: item.url, depth: item.depth, source: item.source, inSitemap: sitemapSet.has(item.url) || sitemapSet.has(finalUrl) }, siteHost));
        }
      } finally {
        inFlight--;
      }
      await sleep(crawlDelayMs);
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  stopIfAborted();

  // Check internal link targets that weren't crawled so broken links are still found.
  progress(62, "Checking internal links");
  const toCheck = [...inlinks.keys()].filter((url) => !linkChecks[url] && !visited.has(url) && isSameSite(url, siteHost));
  const checkable = toCheck.filter((url) => {
    if (robots.isAllowed(url)) return true;
    blockedByRobots.add(url);
    return false;
  });
  const batch = checkable.slice(0, options.maxLinkChecks);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      while (!options.signal?.aborted && cursor < batch.length) {
        const url = batch[cursor++];
        let res = await safeFetch(url, { method: "HEAD", timeoutMs: options.timeoutMs });
        if (res.error || (res.status !== null && [403, 405, 501].includes(res.status))) {
          res = await safeFetch(url, { timeoutMs: options.timeoutMs, maxBytes: 200_000 });
        }
        linkChecks[url] = { url, status: res.status, finalUrl: normalizeUrl(res.finalUrl), redirectChain: res.redirectChain, error: res.error };
        await sleep(crawlDelayMs);
      }
    }),
  );
  const uncheckedLinkCount = checkable.length - batch.length;
  if (uncheckedLinkCount > 0) {
    notes.push(`${uncheckedLinkCount} additional internal link targets were not status-checked because of the per-audit link-check limit.`);
  }

  stopIfAborted();
  progress(66, "Checking HTTPS and host redirects");
  const httpToHttps = origin.startsWith("https:") ? await hostCheck(`http://${siteHost}/`, options.timeoutMs) : null;
  const variantHost = siteHost.startsWith("www.") ? siteHost.slice(4) : `www.${siteHost}`;
  const hostVariant = await hostCheck(`${finalHome.protocol}//${variantHost}/`, options.timeoutMs);
  const notFoundProbe = await hostCheck(`${origin}/seo-health-monitor-404-test-${crypto.randomBytes(4).toString("hex")}`, options.timeoutMs);

  const discovered = new Set<string>([...sitemap.urls, ...inlinks.keys(), ...pages.map((p) => p.finalUrl)]);

  return {
    inputUrl,
    startUrl,
    siteHost,
    origin,
    homepage: homePage,
    pages,
    robots: robots.info,
    sitemap,
    linkChecks,
    inlinks: Object.fromEntries([...inlinks].map(([k, v]) => [k, [...v]])),
    uncheckedLinkCount,
    blockedByRobots: [...blockedByRobots],
    discoveredUrlCount: discovered.size,
    httpToHttps,
    hostVariant,
    notFoundProbe,
    notes,
  };
}
