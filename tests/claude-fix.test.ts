import { describe, expect, it } from "vitest";
import { buildFixPrompt, selectFixItems } from "@/lib/reports/claude-fix";
import { detectPlatform } from "@/lib/crawler/extract";
import type { IssueLike } from "@/lib/reports/action-plan";

const issue = (over: Partial<IssueLike>): IssueLike => ({
  issueKey: Math.random().toString(36), checkId: "onpage-title", category: "onpage", severity: "high", title: "Missing page title", url: "https://x.test/a",
  evidence: ["No <title> element found."], why: "why", fix: "Add a title", implementation: "Edit the head", benefit: "b", impact: 5, confidence: "high", effort: "low", priorityScore: 85, ...over,
});

const base = { siteUrl: "https://x.test", auditId: 7, auditDate: new Date("2026-10-14"), platform: { name: "Astro", evidence: "/_astro assets" }, scope: "all" as const, includeLowConfidence: false };

describe("Fix with Claude", () => {
  const issues = [
    issue({}),
    issue({ url: "https://x.test/b" }),
    issue({ checkId: "local-location-pages", title: "No location landing pages found", confidence: "low", severity: "medium", priorityScore: 30 }),
    issue({ checkId: "tech-host-canonical", category: "technical", title: "www serves pages", url: "https://www.x.test/", severity: "low", priorityScore: 27 }),
  ];

  it("excludes low-confidence findings unless asked", () => {
    expect(selectFixItems(issues, { scope: "all", includeLowConfidence: false })).toMatchObject({ excludedLowConfidence: 1 });
    expect(selectFixItems(issues, { scope: "all", includeLowConfidence: true }).items).toHaveLength(3);
  });

  it("builds a grounded prompt with evidence, platform hints and verification", () => {
    const md = buildFixPrompt(issues, { ...base, unverifiedChecks: ["Google index coverage"] });
    expect(md).toContain("audit #7");
    expect(md).toContain("Detected platform: **Astro**");
    expect(md).toContain("src/layouts/*.astro");
    expect(md).toContain("- https://x.test/a\n  - No <title> element found.");
    expect(md).toContain("curl -s https://x.test/a | grep -io '<title>[^<]*</title>'");
    expect(md).toContain("curl -sI https://www.x.test/");
    expect(md).toContain("hosting / server / CDN configuration");
    expect(md).toContain("1 lower-confidence (heuristic) findings were excluded");
    expect(md).toContain("Not verified by this audit (do not assume pass or fail): Google index coverage");
    expect(md).not.toContain("No location landing pages found");
  });

  it("can target a single task and falls back to top items when nothing is 'Fix first'", () => {
    const one = selectFixItems(issues, { scope: "all", includeLowConfidence: true, taskId: "tech-host-canonical|www serves pages" });
    expect(one.items.map((i) => i.checkId)).toEqual(["tech-host-canonical"]);
    const lowOnly = [issue({ priorityScore: 20, severity: "low" })];
    expect(selectFixItems(lowOnly, { scope: "first", includeLowConfidence: false }).items).toHaveLength(1);
  });

  it("says plainly when there is nothing to fix", () => {
    expect(buildFixPrompt([], { ...base, platform: null })).toContain("No verified issues match this selection");
  });
});

describe("detectPlatform", () => {
  it("recognises common platforms from markup", () => {
    expect(detectPlatform('<script src="/_astro/a.js">', "")?.name).toBe("Astro");
    expect(detectPlatform("", "WordPress 6.6")?.name).toBe("WordPress");
    expect(detectPlatform('<link href="/_next/static/x.css">', "")?.name).toBe("Next.js");
    expect(detectPlatform("<p>plain</p>", "")).toBeNull();
  });
});
