import type { PerformanceResult } from "@/lib/audit/types";
import { runPageSpeed, type PageSpeedOptions } from "./pagespeed";

export interface RunJobsOptions extends PageSpeedOptions {
  concurrency: number;
  onProgress?: (done: number, total: number, label: string) => void;
  /** Called before each test; a returned string skips the test with that reason (e.g. a spent budget). */
  beforeTest?: (job: { url: string; strategy: "mobile" | "desktop" }) => Promise<string | null>;
  /** Test seam; defaults to the real PageSpeed Insights client. */
  run?: typeof runPageSpeed;
  signal?: AbortSignal;
}

/**
 * Tests each URL on mobile and desktop. Once Google confirms the quota is
 * exhausted (after retries), remaining tests are marked skipped instead of
 * spending more requests that are certain to fail.
 */
export async function runPerformanceJobs(urls: string[], options: RunJobsOptions): Promise<PerformanceResult[]> {
  const jobs = urls.flatMap((url) => (["mobile", "desktop"] as const).map((strategy) => ({ url, strategy })));
  const results: PerformanceResult[] = [];
  let cursor = 0;
  let quotaError: string | null = null;
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, async () => {
      while (cursor < jobs.length) {
        options.signal?.throwIfAborted();
        const job = jobs[cursor++];
        if (quotaError) {
          results.push({ ...job, status: "unavailable", error: `Not tested: ${quotaError}`, errorCode: "skipped", opportunities: [] });
          continue;
        }
        const skip = options.beforeTest ? await options.beforeTest(job) : null;
        if (skip) {
          results.push({ ...job, status: "unavailable", error: `Not tested: ${skip}`, errorCode: "skipped", opportunities: [] });
          continue;
        }
        options.onProgress?.(results.length, jobs.length, `PageSpeed Insights (${job.strategy}): ${job.url}`);
        const result = await (options.run ?? runPageSpeed)(job.url, job.strategy, options);
        if (result.errorCode === "quota") quotaError = result.error ?? "quota exceeded";
        results.push(result);
      }
    }),
  );
  // Stable order: by URL order, mobile before desktop.
  const order = new Map(jobs.map((j, i) => [`${j.url}|${j.strategy}`, i]));
  return results.sort((a, b) => order.get(`${a.url}|${a.strategy}`)! - order.get(`${b.url}|${b.strategy}`)!);
}
