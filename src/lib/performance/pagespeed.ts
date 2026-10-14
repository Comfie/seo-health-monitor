import type { PerformanceResult } from "@/lib/audit/types";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

interface LighthouseAudit {
  id: string;
  title: string;
  score: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
  displayValue?: string;
  details?: { type?: string; overallSavingsMs?: number; overallSavingsBytes?: number };
  metricSavings?: Record<string, number>;
}

interface FieldMetric {
  percentile?: number;
  category?: string;
}

interface LoadingExperience {
  metrics?: Record<string, FieldMetric>;
  overall_category?: string;
}

export interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score: number | null } };
    audits?: Record<string, LighthouseAudit>;
    runtimeError?: { code?: string; message?: string };
  };
  loadingExperience?: LoadingExperience;
  originLoadingExperience?: LoadingExperience;
  error?: { code?: number; message?: string };
}

const METRIC_AUDITS = new Set([
  "largest-contentful-paint",
  "cumulative-layout-shift",
  "total-blocking-time",
  "first-contentful-paint",
  "speed-index",
  "interactive",
  "max-potential-fid",
  "first-meaningful-paint",
]);

function hasField(exp: LoadingExperience | undefined): exp is LoadingExperience {
  return !!exp?.metrics && Object.keys(exp.metrics).length > 0;
}

/** Converts a PSI v5 response into the stored result shape. Pure, so it is unit-tested. */
export function parsePsiResponse(url: string, strategy: "mobile" | "desktop", json: PsiResponse): PerformanceResult {
  const lh = json.lighthouseResult;
  if (!lh?.audits) {
    return { url, strategy, status: "unavailable", error: json.error?.message ?? "PageSpeed returned no Lighthouse result.", errorCode: "lighthouse", opportunities: [] };
  }
  if (lh.runtimeError?.code && lh.runtimeError.code !== "NO_ERROR") {
    return { url, strategy, status: "unavailable", error: `Lighthouse error: ${lh.runtimeError.message ?? lh.runtimeError.code}`, errorCode: "lighthouse", opportunities: [] };
  }
  const audits = lh.audits;
  const num = (id: string) => (typeof audits[id]?.numericValue === "number" ? audits[id].numericValue! : null);

  const fieldExp = hasField(json.loadingExperience) ? json.loadingExperience : hasField(json.originLoadingExperience) ? json.originLoadingExperience : undefined;
  const fieldSource = fieldExp ? (fieldExp === json.loadingExperience ? "url" : "origin") : null;
  const field = fieldExp?.metrics ?? {};

  const opportunities = Object.values(audits)
    .filter((a) => {
      if (METRIC_AUDITS.has(a.id) || a.score === null || a.score >= 0.9) return false;
      if (a.scoreDisplayMode === "notApplicable" || a.scoreDisplayMode === "manual" || a.scoreDisplayMode === "informative") return false;
      return true;
    })
    .map((a) => ({
      id: a.id,
      title: a.title,
      displayValue: a.displayValue,
      savingsMs: a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? undefined,
      savingsBytes: a.details?.overallSavingsBytes ?? undefined,
    }))
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
    .slice(0, 12);

  const perf = lh.categories?.performance?.score;
  return {
    url,
    strategy,
    status: "ok",
    performanceScore: typeof perf === "number" ? Math.round(perf * 100) : null,
    lcpMs: num("largest-contentful-paint"),
    cls: num("cumulative-layout-shift"),
    tbtMs: num("total-blocking-time"),
    fcpMs: num("first-contentful-paint"),
    speedIndexMs: num("speed-index"),
    ttfbMs: num("server-response-time"),
    fieldLcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
    fieldInpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    fieldCls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
    fieldCategory: fieldExp?.overall_category ?? null,
    fieldSource,
    opportunities,
  };
}

export interface PageSpeedOptions {
  apiKey?: string;
  timeoutMs: number;
  /** Retries for 429/5xx/timeouts, with exponential backoff (honours Retry-After). */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  const fromHeader = Number.isFinite(header) && header > 0 ? header * 1000 : 0;
  return Math.min(30_000, Math.max(fromHeader, 2_000 * 2 ** attempt));
}

/**
 * Runs one PageSpeed Insights test. The API key travels in the X-Goog-Api-Key
 * header (never the URL) so it can't leak into logs or stored error messages.
 * Never throws: failures come back as status "unavailable" with an errorCode.
 */
export async function runPageSpeed(url: string, strategy: "mobile" | "desktop", options: PageSpeedOptions): Promise<PerformanceResult> {
  const { apiKey, timeoutMs, retries = 2, sleep = defaultSleep } = options;
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  const unavailable = (error: string, errorCode: PerformanceResult["errorCode"]): PerformanceResult => ({ url, strategy, status: "unavailable", error, errorCode, opportunities: [] });

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}?${params}`, { headers: apiKey ? { "x-goog-api-key": apiKey } : {}, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const e = err as Error;
      if (attempt < retries) {
        await sleep(2_000 * 2 ** attempt);
        continue;
      }
      return e.name === "TimeoutError"
        ? unavailable(`PageSpeed Insights did not respond within ${timeoutMs / 1000}s.`, "timeout")
        : unavailable(`PageSpeed Insights request failed: ${e.message}`, "network");
    }
    if (res.ok) return parsePsiResponse(url, strategy, (await res.json()) as PsiResponse);

    const json = (await res.json().catch(() => ({}))) as PsiResponse;
    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < retries) {
      await sleep(retryAfterMs(res, attempt));
      continue;
    }
    if (res.status === 429) {
      return unavailable(
        apiKey
          ? "PageSpeed Insights quota exceeded for this API key (HTTP 429). Quota resets daily; try again later or raise the quota in Google Cloud."
          : "PageSpeed Insights quota exceeded (HTTP 429). Anonymous use has a tiny shared quota; add PAGESPEED_API_KEY.",
        "quota",
      );
    }
    if (res.status === 400 || res.status === 403) {
      const message = json.error?.message ?? res.statusText;
      if (/api key|API_KEY|permission|not been used|disabled/i.test(message)) {
        return unavailable(`PageSpeed Insights rejected the API key: ${message} Check PAGESPEED_API_KEY and that the PageSpeed Insights API is enabled for its project.`, "http");
      }
      return unavailable(`PageSpeed Insights couldn't test this page: ${message}`, "lighthouse");
    }
    return unavailable(`PageSpeed Insights returned HTTP ${res.status}: ${json.error?.message ?? res.statusText}`, "http");
  }
}
