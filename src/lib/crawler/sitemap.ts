import zlib from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import type { SitemapFile, SitemapInfo } from "@/lib/audit/types";
import { safeFetch } from "./http";
import { isSameSite, normalizeUrl } from "./url";

const COMMON_LOCATIONS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap-index.xml", "/sitemap/sitemap.xml"];
const MAX_FILES = 12;
const MAX_URLS = 5_000;

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, processEntities: true });

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function locOf(entry: unknown): string | null {
  if (entry && typeof entry === "object" && "loc" in entry) {
    const loc = (entry as { loc: unknown }).loc;
    return typeof loc === "string" ? loc.trim() : loc != null ? String(loc).trim() : null;
  }
  return null;
}

export function parseSitemapXml(xml: string): { kind: "urlset" | "index" | "invalid"; locs: string[]; error?: string } {
  try {
    const doc = parser.parse(xml);
    if (doc?.urlset) return { kind: "urlset", locs: toArray(doc.urlset.url).map(locOf).filter((v): v is string => !!v) };
    if (doc?.sitemapindex) {
      return { kind: "index", locs: toArray(doc.sitemapindex.sitemap).map(locOf).filter((v): v is string => !!v) };
    }
    return { kind: "invalid", locs: [], error: "The file is not a <urlset> or <sitemapindex> document." };
  } catch (err) {
    return { kind: "invalid", locs: [], error: (err as Error).message.slice(0, 200) };
  }
}

/**
 * Discovers sitemaps from robots.txt directives and common locations, following
 * sitemap indexes. Only same-site URLs are kept.
 */
export async function discoverSitemaps(
  origin: string,
  robotsSitemaps: string[],
  siteHost: string,
  timeoutMs: number,
): Promise<SitemapInfo> {
  const queue = [...new Set([...robotsSitemaps, ...COMMON_LOCATIONS.map((p) => origin + p)])];
  const fromRobots = new Set(robotsSitemaps);
  const files: SitemapFile[] = [];
  const urls = new Set<string>();
  const visited = new Set<string>();
  let foundAny = false;

  while (queue.length && files.length < MAX_FILES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    const res = await safeFetch(url, { timeoutMs, maxBytes: 10_000_000, accept: "application/xml,text/xml,*/*" });
    const isGuess = !fromRobots.has(url) && COMMON_LOCATIONS.some((p) => url === origin + p);

    if (res.error || res.status !== 200) {
      // Guessed locations that don't exist are not errors; only report those we were told about.
      if (!isGuess) {
        files.push({ url, status: res.status, kind: "missing", urlCount: 0, error: res.error ?? `HTTP ${res.status}` });
      }
      continue;
    }
    let body = res.body;
    if (url.endsWith(".gz") || body.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) {
      try {
        body = zlib.gunzipSync(body, { maxOutputLength: 50_000_000 });
      } catch {
        files.push({ url, status: res.status, kind: "invalid", urlCount: 0, error: "Could not decompress gzip sitemap." });
        continue;
      }
    }
    const text = body.toString("utf8");
    if (isGuess && !/<(urlset|sitemapindex)\b/i.test(text)) continue; // e.g. soft-404 HTML page
    const parsed = parseSitemapXml(text);
    foundAny = foundAny || parsed.kind !== "invalid";
    files.push({ url: res.finalUrl, status: res.status, kind: parsed.kind, urlCount: parsed.locs.length, error: parsed.error });
    if (parsed.kind === "index") {
      // Prefer page sitemaps over post/product sitemaps for a representative crawl.
      const children = [...parsed.locs].sort((a, b) => Number(/page/i.test(b)) - Number(/page/i.test(a)));
      queue.unshift(...children.filter((c) => !visited.has(c)));
    } else if (parsed.kind === "urlset") {
      for (const loc of parsed.locs) {
        if (urls.size >= MAX_URLS) break;
        try {
          if (isSameSite(loc, siteHost)) urls.add(normalizeUrl(loc));
        } catch {
          /* ignore malformed loc */
        }
      }
    }
  }
  return { files, urls: [...urls], found: foundAny };
}
