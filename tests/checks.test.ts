import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/audit/checks";
import { computeCounts, computeScores } from "@/lib/audit/scoring";
import { context, htmlPage, page } from "./helpers";

const GOOD_HEAD = `<title>Emergency Plumbing Services in Leeds | Acme</title><meta name="description" content="Fast, reliable emergency plumbing across Leeds with fixed prices and same-day callouts. Call now."><link rel="canonical" href="https://example.com/"><meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="https://example.com/i.jpg">`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `plumbing${i % 37} leeds service`).join(" ");
const NAV = `<a href="/">Home</a><a href="/services">Services</a><a href="/contact">Contact us</a><a href="/about">About</a><a href="tel:+441130000000">Call 0113 000 0000</a>`;

function byId(ctx: ReturnType<typeof context>) {
  return Object.fromEntries(runChecks(ctx).map((c) => [c.id, c]));
}

describe("checks", () => {
  it("passes a healthy page and leaves external-data checks unavailable", () => {
    const home = htmlPage("/", page(`${NAV}<h1>Emergency Plumbing Services in Leeds</h1><p>${words(120)}</p>`, GOOD_HEAD));
    const checks = byId(context([home]));
    expect(checks["onpage-title"].status).toBe("pass");
    expect(checks["onpage-h1"].status).toBe("pass");
    expect(checks["tech-canonical"].status).toBe("pass");
    expect(checks["tech-index-status"].status).toBe("unavailable");
    expect(checks["local-gbp"].status).toBe("unavailable");
    expect(checks["perf-mobile-score"].status).toBe("unavailable");
    expect(checks["perf-mobile-score"].issues).toHaveLength(0);
  });

  it("raises URL-specific issues with evidence", () => {
    const home = htmlPage("/", page(`${NAV}<h1>Home</h1><p>${words(120)}</p>`, GOOD_HEAD));
    const bad = htmlPage("/services", page(`${NAV}<img src="/x.jpg"><p>short</p>`));
    const checks = byId(context([home, bad]));
    const titleIssue = checks["onpage-title"].issues[0];
    expect(titleIssue.url).toBe("https://example.com/services");
    expect(titleIssue.severity).toBe("high");
    expect(titleIssue.evidence[0]).toMatch(/No <title>/);
    expect(checks["onpage-h1"].issues.map((i) => i.url)).toEqual(["https://example.com/services"]);
    expect(checks["onpage-image-alt"].issues[0].evidence[0]).toContain("/x.jpg");
    expect(checks["onpage-title"].score).toBe(0.5);
  });

  it("treats a noindex homepage as critical", () => {
    const home = htmlPage("/", page(`${NAV}<h1>Hi</h1>`, `${GOOD_HEAD}<meta name="robots" content="noindex">`));
    const issue = byId(context([home]))["tech-indexability"].issues[0];
    expect(issue.severity).toBe("critical");
  });

  it("reports robots.txt blocking the whole site", () => {
    const home = htmlPage("/", page(NAV, GOOD_HEAD));
    const ctx = context([home], { robots: { url: "https://example.com/robots.txt", status: 200, found: true, sitemaps: [], blocksAllForAll: true, blocksAllForGoogle: true } });
    const check = byId(ctx)["tech-robots"];
    expect(check.status).toBe("fail");
    expect(check.issues[0].severity).toBe("critical");
  });

  it("detects broken internal links with the linking page as evidence", () => {
    const home = htmlPage("/", page(`${NAV}<a href="/gone">Old page</a>`, GOOD_HEAD));
    const ctx = context([home]);
    ctx.linkChecks["https://example.com/gone"] = { url: "https://example.com/gone", status: 404, finalUrl: "https://example.com/gone", redirectChain: [] };
    const issue = byId(ctx)["tech-broken-links"].issues[0];
    expect(issue.url).toBe("https://example.com/gone");
    expect(issue.evidence).toContain("Linked from: https://example.com/");
  });

  it("flags duplicate titles on both pages", () => {
    const a = htmlPage("/", page(`${NAV}<h1>A</h1>`, "<title>Same title for both pages here</title>"));
    const b = htmlPage("/about", page(`${NAV}<h1>B</h1>`, "<title>Same title for both pages here</title>"));
    expect(byId(context([a, b]))["onpage-title-duplicate"].issues).toHaveLength(2);
  });

  it("downgrades content findings on JavaScript-rendered pages", () => {
    const spa = htmlPage("/", `<html><head><title>App</title></head><body><div id="root"></div><noscript>Please enable JavaScript</noscript></body></html>`);
    const checks = byId(context([spa]));
    expect(checks["tech-js-rendering"].status).toBe("warning");
    expect(checks["onpage-h1"].issues[0].confidence).toBe("low");
  });
});

describe("scoring", () => {
  it("excludes unavailable categories instead of scoring them", () => {
    const home = htmlPage("/", page(`${NAV}<h1>Emergency Plumbing Services in Leeds</h1><p>${words(120)}</p>`, GOOD_HEAD));
    const checks = runChecks(context([home]));
    const scores = computeScores(checks);
    expect(scores.categories.performance).toBeNull();
    expect(scores.overall).not.toBeNull();
    const counts = computeCounts(checks);
    expect(counts.unavailable).toBeGreaterThanOrEqual(7 + 4 + 1 + 1);
    expect(counts.passing + counts.failing + counts.unavailable).toBeLessThanOrEqual(counts.totalChecks);
  });

  it("computes weighted category scores", async () => {
    const { categoryScore } = await import("@/lib/audit/scoring");
    const mk = (weight: number, score: number | null, status = "pass") => ({ id: String(Math.random()), category: "technical" as const, title: "", description: "", weight, status: status as "pass", score, summary: "", issues: [] });
    expect(categoryScore([mk(3, 1), mk(1, 0, "fail"), mk(5, null, "unavailable")], "technical")).toBe(75);
  });
});
