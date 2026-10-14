/**
 * Runs the crawler + checks from the command line without the web UI or database.
 * Usage: npm run audit:cli -- https://example.com [--psi]
 */
import { crawlSite } from "@/lib/crawler/crawl";
import { runChecks } from "@/lib/audit/checks";
import { computeCounts, computeScores } from "@/lib/audit/scoring";
import { runPageSpeed } from "@/lib/performance/pagespeed";
import { selectPerformancePages } from "@/lib/audit/runner";
import { config } from "@/lib/config";
import type { PerformanceResult } from "@/lib/audit/types";

async function main() {
  const url = process.argv[2];
  if (!url) throw new Error("Usage: audit-cli <url> [--psi]");
  const started = Date.now();
  const crawl = await crawlSite(url, { ...config.crawl, onProgress: (p, m) => process.stderr.write(`[${p}%] ${m}\n`) });
  const performance: PerformanceResult[] = [];
  if (process.argv.includes("--psi")) {
    for (const page of selectPerformancePages(crawl, config.pagespeed.maxPages)) {
      for (const strategy of ["mobile", "desktop"] as const) {
        process.stderr.write(`PSI ${strategy} ${page}\n`);
        performance.push(await runPageSpeed(page, strategy, { apiKey: config.pagespeedApiKey, timeoutMs: config.pagespeed.timeoutMs }));
      }
    }
  }
  const checks = runChecks({ ...crawl, performance, performanceSkippedReason: performance.length ? undefined : "PageSpeed not requested (--psi)." });
  console.log(JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), pages: crawl.pages.map((p) => `${p.status} ${p.finalUrl} (${p.extracted?.wordCount ?? "-"} words)`), sitemap: crawl.sitemap.files, robots: { found: crawl.robots.found, sitemaps: crawl.robots.sitemaps }, notes: crawl.notes, scores: computeScores(checks), counts: computeCounts(checks), performance: performance.map((p) => ({ url: p.url, strategy: p.strategy, status: p.status, score: p.performanceScore, lcp: p.lcpMs, error: p.error })), checks: checks.map((c) => `${c.status.padEnd(11)} ${c.id}: ${c.summary}`) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
