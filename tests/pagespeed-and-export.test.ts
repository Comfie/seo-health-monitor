import { describe, expect, it, vi } from "vitest";
import { parsePsiResponse } from "@/lib/performance/pagespeed";
import { issuesToCsv } from "@/lib/reports/export";
import type { FullAudit } from "@/lib/audit/repository";

describe("parsePsiResponse", () => {
  it("extracts lab, field and opportunity data", () => {
    const r = parsePsiResponse("https://x.test/", "mobile", {
      lighthouseResult: {
        categories: { performance: { score: 0.62 } },
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", title: "LCP", score: 0.3, numericValue: 4200 },
          "cumulative-layout-shift": { id: "cumulative-layout-shift", title: "CLS", score: 1, numericValue: 0.02 },
          "total-blocking-time": { id: "total-blocking-time", title: "TBT", score: 0.5, numericValue: 450 },
          "server-response-time": { id: "server-response-time", title: "TTFB", score: 1, numericValue: 180 },
          "render-blocking-resources": { id: "render-blocking-resources", title: "Eliminate render-blocking resources", score: 0.2, scoreDisplayMode: "metricSavings", details: { type: "opportunity", overallSavingsMs: 900 } },
          "uses-http2": { id: "uses-http2", title: "N/A", score: null, scoreDisplayMode: "notApplicable" },
        },
      },
      loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 250 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 } }, overall_category: "AVERAGE" },
    });
    expect(r).toMatchObject({ status: "ok", performanceScore: 62, lcpMs: 4200, cls: 0.02, tbtMs: 450, ttfbMs: 180, fieldInpMs: 250, fieldCls: 0.05, fieldSource: "url" });
    expect(r.opportunities.map((o) => o.id)).toEqual(["render-blocking-resources"]);
  });
  it("falls back to origin field data and reports missing results as unavailable", () => {
    const r = parsePsiResponse("https://x.test/", "desktop", { lighthouseResult: { audits: {}, categories: { performance: { score: 0.9 } } }, originLoadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 100 } } } });
    expect(r.fieldSource).toBe("origin");
    expect(parsePsiResponse("https://x.test/", "mobile", { error: { message: "boom" } })).toMatchObject({ status: "unavailable", error: "boom" });
  });
});

describe("CSV export", () => {
  it("escapes quotes and neutralises formula injection from crawled content", () => {
    const full = { issues: [{ issueKey: "k", priorityScore: 1, severity: "low", category: "onpage", checkId: "c", title: '=HYPERLINK("x")', url: "https://x.test/", evidence: ['Title: "a, b"'], why: "", fix: "", implementation: "", benefit: "", confidence: "high", effort: "low" }] } as unknown as FullAudit;
    const row = issuesToCsv(full).split("\r\n")[1];
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain(`"Title: ""a, b"""`);
  });
});

describe("runPageSpeed / runPerformanceJobs", () => {
  const ok = { lighthouseResult: { categories: { performance: { score: 0.91 } }, audits: { "largest-contentful-paint": { id: "largest-contentful-paint", title: "LCP", score: 1, numericValue: 1800 } } } };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const noSleep = async () => {};

  it("sends the key in a header, never in the URL", async () => {
    const { runPageSpeed } = await import("@/lib/performance/pagespeed");
    const fetchMock = vi.fn(async () => json(ok));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runPageSpeed("https://x.test/", "mobile", { apiKey: "SECRET-KEY", timeoutMs: 1000, sleep: noSleep });
    expect(r).toMatchObject({ status: "ok", performanceScore: 91 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("SECRET-KEY");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRET-KEY");
    vi.unstubAllGlobals();
  });

  it("retries 429 honouring Retry-After, then reports quota", async () => {
    const { runPageSpeed } = await import("@/lib/performance/pagespeed");
    const waits: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "Quota exceeded" } }, 429, { "retry-after": "7" })));
    const r = await runPageSpeed("https://x.test/", "mobile", { timeoutMs: 1000, retries: 2, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([7000, 7000]);
    expect(r).toMatchObject({ status: "unavailable", errorCode: "quota" });
    expect(r.error).toMatch(/PAGESPEED_API_KEY/);
    vi.unstubAllGlobals();
  });

  it("recovers from a transient error", async () => {
    const { runPageSpeed } = await import("@/lib/performance/pagespeed");
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? json({ error: { message: "backend" } }, 503) : json(ok))));
    expect((await runPageSpeed("https://x.test/", "desktop", { timeoutMs: 1000, sleep: noSleep })).status).toBe("ok");
    vi.unstubAllGlobals();
  });

  it("explains a rejected API key", async () => {
    const { runPageSpeed } = await import("@/lib/performance/pagespeed");
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "API key not valid. Please pass a valid API key." } }, 400)));
    const r = await runPageSpeed("https://x.test/", "mobile", { apiKey: "bad", timeoutMs: 1000, sleep: noSleep });
    expect(r.error).toMatch(/rejected the API key/);
    expect(r.error).not.toContain("bad");
    vi.unstubAllGlobals();
  });

  it("stops calling Google once the quota is exhausted", async () => {
    const { runPerformanceJobs } = await import("@/lib/performance/run");
    const fetchMock = vi.fn(async () => json({ error: { message: "Quota" } }, 429));
    vi.stubGlobal("fetch", fetchMock);
    const results = await runPerformanceJobs(["https://x.test/", "https://x.test/a"], { timeoutMs: 1000, retries: 0, concurrency: 1, sleep: noSleep });
    expect(results).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.errorCode === "skipped")).toHaveLength(3);
    expect(results.map((r) => r.strategy)).toEqual(["mobile", "desktop", "mobile", "desktop"]);
    vi.unstubAllGlobals();
  });
});
