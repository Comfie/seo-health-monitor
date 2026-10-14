import { describe, expect, it } from "vitest";
import { issueKey, priorityBucket, priorityScore } from "@/lib/audit/issues";
import { compareAudits, type CompareInput } from "@/lib/audit/compare";
import { buildActionPlan, buildDeveloperTasks, type IssueLike } from "@/lib/reports/action-plan";

describe("issue identity", () => {
  it("is deterministic and ignores www/fragment differences", () => {
    expect(issueKey("onpage-title", "https://example.com/a")).toBe(issueKey("onpage-title", "https://www.example.com/a#x"));
    expect(issueKey("onpage-title", "https://example.com/a")).not.toBe(issueKey("onpage-h1", "https://example.com/a"));
    expect(issueKey("onpage-h1", "https://example.com/a", "multiple")).not.toBe(issueKey("onpage-h1", "https://example.com/a"));
    expect(issueKey("x", "https://example.com/")).toMatch(/^[0-9a-f]{16}$/);
  });
  it("ranks severe, confident, easy fixes first", () => {
    expect(priorityScore("critical", 5, "high", "low")).toBeGreaterThan(priorityScore("high", 5, "high", "low"));
    expect(priorityScore("high", 3, "high", "low")).toBeGreaterThan(priorityScore("high", 3, "low", "high"));
    expect(priorityBucket(priorityScore("critical", 5, "high", "low"))).toBe("Fix first");
  });
});

const issue = (key: string, url: string, severity = "medium", title = "Missing H1 heading"): IssueLike & { issueKey: string } => ({
  issueKey: key, checkId: "onpage-h1", category: "onpage", severity, title, url, evidence: ["No <h1> element found."], why: "w", fix: "f", implementation: "i", benefit: "b", impact: 3, confidence: "high", effort: "low", priorityScore: 50,
});

const base = (over: Partial<CompareInput>): CompareInput => ({ overallScore: 70, categoryScores: { technical: 80, performance: null }, counts: { critical: 1, high: 2, medium: 0, low: 0 }, issues: [], pages: [], performance: [], ...over });
const pg = (url: string, title: string | null) => ({ url, finalUrl: url, status: 200, title, metaDescription: null, h1: null, canonical: null, metaRobots: null, wordCount: 400 });

describe("compareAudits", () => {
  const prev = base({
    issues: [issue("a", "https://x.test/a"), issue("b", "https://x.test/b")],
    pages: [pg("https://x.test/", "Old title"), pg("https://x.test/old", "Old")],
    performance: [{ url: "https://x.test/", strategy: "mobile", status: "ok", performanceScore: 40, lcpMs: 5000, cls: 0.2, tbtMs: 900, fieldInpMs: null }],
  });
  const curr = base({
    overallScore: 82,
    categoryScores: { technical: 90, performance: 60 },
    counts: { critical: 0, high: 2, medium: 1, low: 0 },
    issues: [issue("b", "https://x.test/b", "high"), issue("c", "https://x.test/new")],
    pages: [pg("https://www.x.test/", "New title"), pg("https://x.test/new", "New")],
    performance: [{ url: "https://x.test/", strategy: "mobile", status: "ok", performanceScore: 70, lcpMs: 2400, cls: 0.2, tbtMs: 300, fieldInpMs: null }],
  });
  const r = compareAudits(prev, curr);

  it("classifies fixed, new and outstanding issues by key", () => {
    expect(r.fixed.map((i) => i.issueKey)).toEqual(["a"]);
    expect(r.introduced.map((i) => i.issueKey)).toEqual(["c"]);
    expect(r.outstanding[0]).toMatchObject({ severityChanged: true });
  });
  it("tracks scores and severity counts with trends", () => {
    expect(r.scores.find((s) => s.key === "overall")).toMatchObject({ delta: 12, trend: "improved" });
    expect(r.scores.find((s) => s.key === "performance")?.trend).toBe("unavailable");
    expect(r.scores.find((s) => s.key === "critical issues")?.trend).toBe("improved");
  });
  it("detects page and metadata changes (www-insensitive)", () => {
    expect(r.pagesAdded).toEqual(["https://x.test/new"]);
    expect(r.pagesRemoved).toEqual(["https://x.test/old"]);
    expect(r.metadataChanges).toEqual([{ url: "https://www.x.test/", field: "title", previous: "Old title", current: "New title" }]);
  });
  it("reports performance deltas", () => {
    expect(r.performance.find((p) => p.metric === "lcpMs")).toMatchObject({ delta: -2600, trend: "improved" });
    expect(r.performance.find((p) => p.metric === "cls")?.trend).toBe("unchanged");
  });
});

describe("action plan and developer tasks", () => {
  it("groups issues by problem and lists every URL", () => {
    const plan = buildActionPlan([issue("a", "https://x.test/a"), issue("b", "https://x.test/b"), issue("c", "https://x.test/c", "critical", "Other")]);
    expect(plan[0].title).toBe("Other"); // critical wins the tie on equal priority score
    expect(plan.find((p) => p.title === "Missing H1 heading")?.issues).toHaveLength(2);
    const md = buildDeveloperTasks("https://x.test", new Date("2026-01-01"), [issue("a", "https://x.test/a")]);
    expect(md).toContain("## 1. Missing H1 heading");
    expect(md).toContain("- [ ] https://x.test/a");
  });
});
