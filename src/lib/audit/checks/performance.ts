import type { AuditContext, CheckStatus, IssueDraft, PerformanceResult } from "../types";
import { plural, unavailable, type CheckDefinition, type CheckOutcome } from "./helpers";

function okResults(ctx: AuditContext, strategy?: "mobile" | "desktop"): PerformanceResult[] {
  return ctx.performance.filter((r) => r.status === "ok" && (!strategy || r.strategy === strategy));
}

function noDataReason(ctx: AuditContext): string {
  if (ctx.performanceSkippedReason) return ctx.performanceSkippedReason;
  const errors = [...new Set(ctx.performance.filter((r) => r.error).map((r) => r.error!))];
  return errors.length ? `PageSpeed Insights data unavailable: ${errors[0]}` : "PageSpeed Insights was not run.";
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

/** Threshold check on one Lighthouse metric. good/poor follow Google's published Core Web Vitals thresholds. */
function metricCheck(
  ctx: AuditContext,
  checkId: string,
  pick: (r: PerformanceResult) => number | null | undefined,
  good: number,
  poor: number,
  format: (v: number) => string,
  label: string,
  strategy: "mobile" | "desktop" = "mobile",
): CheckOutcome {
  const results = okResults(ctx, strategy).filter((r) => pick(r) != null);
  if (!results.length) return unavailable(noDataReason(ctx));
  const drafts: IssueDraft[] = [];
  let total = 0;
  for (const r of results) {
    const value = pick(r)!;
    const s = value <= good ? 1 : value <= poor ? 0.5 : 0;
    total += s;
    if (s < 1) {
      drafts.push({
        checkId,
        url: r.url,
        discriminator: strategy,
        severity: s === 0 ? "high" : "medium",
        evidence: [
          `${label} (${strategy}, lab): ${format(value)} — good ≤ ${format(good)}, poor > ${format(poor)}`,
          ...r.opportunities.slice(0, 5).map((o) => `Lighthouse opportunity: ${o.title}${o.displayValue ? ` (${o.displayValue})` : ""}`),
        ],
      });
    }
  }
  const score = total / results.length;
  const status: CheckStatus = score === 1 ? "pass" : score >= 0.5 ? "warning" : "fail";
  return { status, score, summary: `${label} is good on ${results.length - drafts.length} of ${plural(results.length, "tested page")} (${strategy}).`, drafts };
}

function scoreCheck(ctx: AuditContext, checkId: string, strategy: "mobile" | "desktop"): CheckOutcome {
  const results = okResults(ctx, strategy).filter((r) => r.performanceScore != null);
  if (!results.length) return unavailable(noDataReason(ctx));
  const avg = results.reduce((s, r) => s + r.performanceScore!, 0) / results.length;
  const drafts: IssueDraft[] = results
    .filter((r) => r.performanceScore! < 90)
    .map((r) => ({
      checkId,
      url: r.url,
      severity: r.performanceScore! < 50 ? (strategy === "mobile" ? "high" : "medium") : "low",
      // One title per problem so pages group into a single task; the score is in the evidence.
      title: `${strategy === "mobile" ? "Mobile" : "Desktop"} performance score below 90`,
      evidence: [
        `Lighthouse ${strategy} performance score: ${r.performanceScore}/100`,
        r.lcpMs != null ? `LCP ${ms(r.lcpMs)}, TBT ${ms(r.tbtMs ?? 0)}, CLS ${(r.cls ?? 0).toFixed(3)}` : "",
        ...r.opportunities.slice(0, 6).map((o) => `Opportunity: ${o.title}${o.displayValue ? ` (${o.displayValue})` : ""}`),
      ].filter(Boolean),
    }));
  const status: CheckStatus = avg >= 90 ? "pass" : avg >= 50 ? "warning" : "fail";
  return { status, score: avg / 100, summary: `Average ${strategy} Lighthouse performance score ${Math.round(avg)}/100 across ${plural(results.length, "page")}.`, drafts };
}

const SPEED_TEMPLATE = {
  why: "Slow pages lose visitors, particularly on mobile data, and page experience is part of Google's ranking systems.",
  fix: "Work through the Lighthouse opportunities listed in the evidence, starting with the largest savings.",
  implementation:
    "Typical fixes: serve images in WebP/AVIF at the displayed size and lazy-load below-the-fold images; enable page caching and a CDN; defer non-critical JavaScript and remove unused plugins/scripts; preload the hero image and main font; reduce third-party embeds (chat widgets, sliders).",
  benefit: "Faster pages can improve engagement and enquiries; ranking effects are usually modest.",
  effort: "medium" as const,
  confidence: "high" as const,
};

export const performanceChecks: CheckDefinition[] = [
  {
    id: "perf-mobile-score",
    category: "performance",
    title: "Mobile performance score",
    description: "Average Lighthouse performance score on mobile (PageSpeed Insights). ≥90 good, 50–89 needs improvement, <50 poor. Scored continuously.",
    weight: 8,
    template: { title: "Low mobile performance score", severity: "high", impact: 4, ...SPEED_TEMPLATE },
    run: (ctx) => scoreCheck(ctx, "perf-mobile-score", "mobile"),
  },
  {
    id: "perf-desktop-score",
    category: "performance",
    title: "Desktop performance score",
    description: "Average Lighthouse performance score on desktop. Same thresholds as mobile.",
    weight: 4,
    template: { title: "Low desktop performance score", severity: "medium", impact: 3, ...SPEED_TEMPLATE },
    run: (ctx) => scoreCheck(ctx, "perf-desktop-score", "desktop"),
  },
  {
    id: "perf-lcp",
    category: "performance",
    title: "Largest Contentful Paint (mobile)",
    description: "Lab LCP on mobile: ≤2.5s good, ≤4s needs improvement, >4s poor.",
    weight: 4,
    template: {
      title: "Slow Largest Contentful Paint",
      severity: "high",
      why: "LCP measures how long the main content (usually the hero image or headline) takes to appear. It is a Core Web Vital.",
      fix: "Make the largest above-the-fold element load sooner.",
      implementation:
        "Compress and resize the hero image (WebP/AVIF), add fetchpriority=\"high\" and don't lazy-load it; preload critical fonts; reduce render-blocking CSS/JS; improve server response with caching/CDN.",
      benefit: "Visitors see meaningful content sooner, reducing early abandonment.",
      impact: 4,
      effort: "medium",
      confidence: "high",
    },
    run: (ctx) => metricCheck(ctx, "perf-lcp", (r) => r.lcpMs, 2500, 4000, ms, "LCP"),
  },
  {
    id: "perf-cls",
    category: "performance",
    title: "Cumulative Layout Shift (mobile)",
    description: "Lab CLS on mobile: ≤0.1 good, ≤0.25 needs improvement, >0.25 poor.",
    weight: 3,
    template: {
      title: "Layout shifts while loading",
      severity: "medium",
      why: "CLS measures how much content jumps around while loading, which causes mis-taps and frustration. It is a Core Web Vital.",
      fix: "Reserve space for images, embeds, banners and fonts before they load.",
      implementation:
        "Add width and height attributes (or CSS aspect-ratio) to images and iframes; avoid inserting banners/cookie bars above existing content; use font-display: optional or size-adjusted fallback fonts.",
      benefit: "A more stable, trustworthy page, especially on mobile.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run: (ctx) => metricCheck(ctx, "perf-cls", (r) => r.cls, 0.1, 0.25, (v) => v.toFixed(3), "CLS"),
  },
  {
    id: "perf-inp",
    category: "performance",
    title: "Interaction to Next Paint (field data)",
    description: "Real-user INP from the Chrome UX Report: ≤200ms good, ≤500ms needs improvement. Unavailable when Google has insufficient real-user data.",
    weight: 3,
    template: {
      title: "Slow interaction responsiveness (INP)",
      severity: "medium",
      why: "INP measures how quickly the page responds when real visitors tap or click. It is a Core Web Vital based on real Chrome users.",
      fix: "Reduce long JavaScript tasks on the main thread.",
      implementation: "Remove or defer heavy third-party scripts, break up long tasks, avoid large DOM sizes, and lazy-load widgets until interaction.",
      benefit: "Snappier menus, forms and buttons for real visitors.",
      impact: 3,
      effort: "high",
      confidence: "high",
    },
    run(ctx) {
      const results = okResults(ctx, "mobile").filter((r) => r.fieldInpMs != null);
      if (!okResults(ctx).length) return unavailable(noDataReason(ctx));
      if (!results.length) return unavailable("Google has no Chrome UX Report field data (INP) for these pages or this origin. This is common for lower-traffic sites; INP cannot be measured in a lab test.");
      const drafts: IssueDraft[] = [];
      let total = 0;
      for (const r of results) {
        const v = r.fieldInpMs!;
        const s = v <= 200 ? 1 : v <= 500 ? 0.5 : 0;
        total += s;
        if (s < 1) drafts.push({ checkId: "perf-inp", url: r.url, severity: s === 0 ? "high" : "medium", evidence: [`Field INP (p75, ${r.fieldSource === "origin" ? "whole-origin data" : "this URL"}): ${Math.round(v)} ms`] });
      }
      const score = total / results.length;
      return { status: score === 1 ? "pass" : score >= 0.5 ? "warning" : "fail", score, summary: `Real-user INP is good on ${results.length - drafts.length} of ${plural(results.length, "page")}${results[0].fieldSource === "origin" ? " (origin-level data)" : ""}.`, drafts };
    },
  },
  {
    id: "perf-tbt",
    category: "performance",
    title: "Total Blocking Time (mobile)",
    description: "Lab TBT on mobile, a proxy for interactivity: ≤200ms good, ≤600ms needs improvement.",
    weight: 2,
    template: {
      title: "High Total Blocking Time",
      severity: "medium",
      why: "TBT measures how long JavaScript blocks the page from responding during load; high values usually mean poor responsiveness for real users.",
      fix: "Reduce and defer JavaScript execution.",
      implementation: "Audit plugins and third-party tags (analytics, chat, sliders, page builders); remove unused ones, defer the rest, and enable script minification/combination carefully.",
      benefit: "Pages become usable sooner.",
      impact: 3,
      effort: "medium",
      confidence: "high",
    },
    run: (ctx) => metricCheck(ctx, "perf-tbt", (r) => r.tbtMs, 200, 600, ms, "TBT"),
  },
  {
    id: "perf-server-response",
    category: "performance",
    title: "Server response time (Lighthouse)",
    description: "Lighthouse-measured document response time on mobile: ≤600ms good, ≤1.8s needs improvement.",
    weight: 2,
    template: {
      title: "Slow initial server response",
      severity: "medium",
      why: "Every other part of the page waits for the first response from the server.",
      fix: "Add page caching and/or a CDN, and reduce server-side processing.",
      implementation: "Enable full-page caching, use a CDN with HTML caching where possible, upgrade PHP/runtime versions and hosting resources, and remove slow plugins.",
      benefit: "Faster start to every page load.",
      impact: 3,
      effort: "medium",
      confidence: "high",
    },
    run: (ctx) => metricCheck(ctx, "perf-server-response", (r) => r.ttfbMs, 600, 1800, ms, "Server response time"),
  },
];
