import type { Category } from "./types";
import { CATEGORIES } from "./types";

export interface CompareIssue {
  issueKey: string;
  checkId: string;
  category: string;
  severity: string;
  title: string;
  url: string;
}

export interface ComparePage {
  url: string;
  finalUrl: string;
  status: number | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  canonical: string | null;
  metaRobots: string | null;
  wordCount: number | null;
}

export interface ComparePerf {
  url: string;
  strategy: string;
  status: string;
  performanceScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fieldInpMs: number | null;
}

export interface CompareInput {
  overallScore: number | null;
  categoryScores: Partial<Record<Category, number | null>> | null;
  counts: Record<string, number> | null;
  issues: CompareIssue[];
  pages: ComparePage[];
  performance: ComparePerf[];
}

export type Trend = "improved" | "regressed" | "unchanged" | "unavailable";

export interface ScoreDelta {
  key: string;
  previous: number | null;
  current: number | null;
  delta: number | null;
  trend: Trend;
}

export interface MetadataChange {
  url: string;
  field: "title" | "metaDescription" | "h1" | "canonical" | "metaRobots" | "status" | "wordCount";
  previous: string | number | null;
  current: string | number | null;
}

export interface PerfDelta {
  url: string;
  strategy: string;
  metric: "performanceScore" | "lcpMs" | "cls" | "tbtMs" | "fieldInpMs";
  previous: number | null;
  current: number | null;
  delta: number | null;
  trend: Trend;
}

export interface CompareResult {
  scores: ScoreDelta[];
  fixed: CompareIssue[];
  introduced: CompareIssue[];
  outstanding: { previous: CompareIssue; current: CompareIssue; severityChanged: boolean }[];
  pagesAdded: string[];
  pagesRemoved: string[];
  metadataChanges: MetadataChange[];
  performance: PerfDelta[];
}

function trend(previous: number | null | undefined, current: number | null | undefined, higherIsBetter: boolean, tolerance = 0): Trend {
  if (previous == null || current == null) return "unavailable";
  const diff = current - previous;
  if (Math.abs(diff) <= tolerance) return "unchanged";
  return (diff > 0) === higherIsBetter ? "improved" : "regressed";
}

function scoreDelta(key: string, previous: number | null | undefined, current: number | null | undefined): ScoreDelta {
  const p = previous ?? null;
  const c = current ?? null;
  return { key, previous: p, current: c, delta: p != null && c != null ? c - p : null, trend: trend(p, c, true) };
}

const pageKey = (url: string) => {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.replace(/^www\./, "");
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
};

/**
 * Compares two audits of the same site. Issues are matched by their
 * deterministic issueKey (check + URL + discriminator), so wording changes
 * don't create false "fixed"/"new" pairs.
 */
export function compareAudits(previous: CompareInput, current: CompareInput): CompareResult {
  const scores = [
    scoreDelta("overall", previous.overallScore, current.overallScore),
    ...CATEGORIES.map((c) => scoreDelta(c, previous.categoryScores?.[c], current.categoryScores?.[c])),
  ];
  for (const key of ["critical", "high", "medium", "low"]) {
    const p = previous.counts?.[key] ?? null;
    const c = current.counts?.[key] ?? null;
    scores.push({ key: `${key} issues`, previous: p, current: c, delta: p != null && c != null ? c - p : null, trend: trend(p, c, false) });
  }

  const prevIssues = new Map(previous.issues.map((i) => [i.issueKey, i]));
  const currIssues = new Map(current.issues.map((i) => [i.issueKey, i]));
  const fixed = previous.issues.filter((i) => !currIssues.has(i.issueKey));
  const introduced = current.issues.filter((i) => !prevIssues.has(i.issueKey));
  const outstanding = current.issues
    .filter((i) => prevIssues.has(i.issueKey))
    .map((i) => {
      const prev = prevIssues.get(i.issueKey)!;
      return { previous: prev, current: i, severityChanged: prev.severity !== i.severity };
    });

  // Pages that failed in one scan count as present (they were crawled) for add/remove purposes.
  const prevPages = new Map(previous.pages.map((p) => [pageKey(p.finalUrl), p]));
  const currPages = new Map(current.pages.map((p) => [pageKey(p.finalUrl), p]));
  const pagesAdded = [...currPages.keys()].filter((k) => !prevPages.has(k)).map((k) => currPages.get(k)!.finalUrl);
  const pagesRemoved = [...prevPages.keys()].filter((k) => !currPages.has(k)).map((k) => prevPages.get(k)!.finalUrl);

  const metadataChanges: MetadataChange[] = [];
  const fields: MetadataChange["field"][] = ["status", "title", "metaDescription", "h1", "canonical", "metaRobots"];
  for (const [key, curr] of currPages) {
    const prev = prevPages.get(key);
    if (!prev) continue;
    for (const field of fields) {
      const a = prev[field] ?? null;
      const b = curr[field] ?? null;
      if (a !== b) metadataChanges.push({ url: curr.finalUrl, field, previous: a, current: b });
    }
    const pw = prev.wordCount ?? 0;
    const cw = curr.wordCount ?? 0;
    if (Math.abs(cw - pw) >= Math.max(50, pw * 0.2)) metadataChanges.push({ url: curr.finalUrl, field: "wordCount", previous: prev.wordCount, current: curr.wordCount });
  }

  const performance: PerfDelta[] = [];
  const metrics: [PerfDelta["metric"], boolean, number][] = [
    ["performanceScore", true, 2],
    ["lcpMs", false, 100],
    ["cls", false, 0.01],
    ["tbtMs", false, 50],
    ["fieldInpMs", false, 20],
  ];
  const prevPerf = new Map(previous.performance.map((p) => [`${pageKey(p.url)}|${p.strategy}`, p]));
  for (const curr of current.performance) {
    const prev = prevPerf.get(`${pageKey(curr.url)}|${curr.strategy}`);
    if (!prev) continue;
    for (const [metric, higherIsBetter, tolerance] of metrics) {
      const a = prev.status === "ok" ? prev[metric] : null;
      const b = curr.status === "ok" ? curr[metric] : null;
      if (a == null && b == null) continue;
      performance.push({ url: curr.url, strategy: curr.strategy, metric, previous: a, current: b, delta: a != null && b != null ? b - a : null, trend: trend(a, b, higherIsBetter, tolerance) });
    }
  }

  return { scores, fixed, introduced, outstanding, pagesAdded, pagesRemoved, metadataChanges, performance };
}
