import { CATEGORIES, type AuditCounts, type Category, type CheckResult, type Issue, type Scores } from "./types";

/**
 * Category weights for the overall score. Documented in the Settings > Methodology page.
 * Categories with no measurable checks (e.g. PageSpeed unavailable) are excluded and
 * the remaining weights are re-normalised, so missing data never counts as pass or fail.
 */
export const CATEGORY_WEIGHTS: Record<Category, number> = {
  technical: 30,
  onpage: 25,
  performance: 20,
  local: 15,
  conversion: 10,
};

/** Weighted mean of check scores (0..1) within a category, as 0..100. Null when nothing was measurable. */
export function categoryScore(checks: CheckResult[], category: Category): number | null {
  const scored = checks.filter((c) => c.category === category && c.weight > 0 && c.score !== null && c.status !== "unavailable");
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return null;
  return Math.round((scored.reduce((s, c) => s + c.weight * (c.score as number), 0) / totalWeight) * 100);
}

export function computeScores(checks: CheckResult[]): Scores {
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, categoryScore(checks, c)])) as Record<Category, number | null>;
  const available = CATEGORIES.filter((c) => categories[c] !== null);
  const weight = available.reduce((s, c) => s + CATEGORY_WEIGHTS[c], 0);
  const overall = weight ? Math.round(available.reduce((s, c) => s + CATEGORY_WEIGHTS[c] * (categories[c] as number), 0) / weight) : null;
  return { overall, categories };
}

export function computeCounts(checks: CheckResult[], issues: Issue[] = checks.flatMap((c) => c.issues)): AuditCounts {
  const bySeverity = (s: string) => issues.filter((i) => i.severity === s).length;
  const critical = bySeverity("critical");
  const high = bySeverity("high");
  const medium = bySeverity("medium");
  const low = bySeverity("low");
  return {
    critical,
    high,
    medium,
    low,
    warnings: high + medium + low,
    passing: checks.filter((c) => c.status === "pass").length,
    failing: checks.filter((c) => c.status === "fail" || c.status === "warning").length,
    unavailable: checks.filter((c) => c.status === "unavailable").length,
    totalChecks: checks.length,
  };
}

export function scoreLabel(score: number | null): string {
  if (score === null) return "Unavailable";
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Needs work";
  return "Poor";
}
