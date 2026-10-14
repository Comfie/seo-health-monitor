import { describe, expect, it } from "vitest";
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
