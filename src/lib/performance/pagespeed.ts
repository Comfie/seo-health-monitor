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
    return { url, strategy, status: "unavailable", error: json.error?.message ?? "PageSpeed returned no Lighthouse result.", opportunities: [] };
  }
  if (lh.runtimeError?.code && lh.runtimeError.code !== "NO_ERROR") {
    return { url, strategy, status: "unavailable", error: `Lighthouse error: ${lh.runtimeError.message ?? lh.runtimeError.code}`, opportunities: [] };
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

export async function runPageSpeed(
  url: string,
  strategy: "mobile" | "desktop",
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<PerformanceResult> {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (apiKey) params.set("key", apiKey);
  try {
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
    const json = (await res.json().catch(() => ({}))) as PsiResponse;
    if (!res.ok) {
      const reason =
        res.status === 429
          ? "PageSpeed Insights quota exceeded (HTTP 429). Add a PAGESPEED_API_KEY to get a dedicated quota."
          : `PageSpeed Insights returned HTTP ${res.status}: ${json.error?.message ?? res.statusText}`;
      return { url, strategy, status: "unavailable", error: reason, opportunities: [] };
    }
    return parsePsiResponse(url, strategy, json);
  } catch (err) {
    const e = err as Error;
    const message = e.name === "TimeoutError" ? `PageSpeed Insights did not respond within ${timeoutMs / 1000}s.` : `PageSpeed Insights request failed: ${e.message}`;
    return { url, strategy, status: "unavailable", error: message, opportunities: [] };
  }
}
