import { CATEGORIES, type AuditCounts, type Category, type Scores } from "./types";

/** The fields scoring needs; satisfied by both in-memory CheckResults and stored check rows. */
export interface ScorableCheck {
  category: string;
  weight: number;
  score: number | null;
  status: string;
  issues?: unknown[];
}

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
export function categoryScore(checks: ScorableCheck[], category: Category): number | null {
  const scored = checks.filter((c) => c.category === category && c.weight > 0 && c.score !== null && c.status !== "unavailable");
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return null;
  return Math.round((scored.reduce((s, c) => s + c.weight * (c.score as number), 0) / totalWeight) * 100);
}

export function computeScores(checks: ScorableCheck[]): Scores {
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, categoryScore(checks, c)])) as Record<Category, number | null>;
  const available = CATEGORIES.filter((c) => categories[c] !== null);
  const weight = available.reduce((s, c) => s + CATEGORY_WEIGHTS[c], 0);
  const overall = weight ? Math.round(available.reduce((s, c) => s + CATEGORY_WEIGHTS[c] * (categories[c] as number), 0) / weight) : null;
  return { overall, categories };
}

export function computeCounts(checks: ScorableCheck[], issues: { severity: string }[] = checks.flatMap((c) => (c.issues ?? []) as { severity: string }[])): AuditCounts {
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

export interface ScoreAssessment {
  /** Share (0..1) of the weighted scoring model that was actually measured. */
  coverage: number;
  provisional: boolean;
  reasons: string[];
  unmeasuredCategories: Category[];
}

const PROVISIONAL_COVERAGE = 0.9;
const MAJOR_CATEGORY_WEIGHT = 15;

/**
 * How much of the score is backed by measurements. A score is provisional when
 * coverage is below 90% or a major category (weight >= 15%) couldn't be measured,
 * because the overall number then rests on a partial picture.
 */
export function assessScore(checks: ScorableCheck[], categoryLabels: Record<Category, string>): ScoreAssessment {
  const totalCategoryWeight = CATEGORIES.reduce((s, c) => s + CATEGORY_WEIGHTS[c], 0);
  let covered = 0;
  const unmeasuredCategories: Category[] = [];
  const reasons: string[] = [];
  for (const c of CATEGORIES) {
    const scored = checks.filter((x) => x.category === c && x.weight > 0);
    const total = scored.reduce((s, x) => s + x.weight, 0);
    const measured = scored.filter((x) => x.status !== "unavailable" && x.score !== null).reduce((s, x) => s + x.weight, 0);
    if (total === 0) continue;
    covered += CATEGORY_WEIGHTS[c] * (measured / total);
    if (measured === 0) unmeasuredCategories.push(c);
  }
  const coverage = covered / totalCategoryWeight;
  for (const c of unmeasuredCategories) {
    reasons.push(`${categoryLabels[c]} (${CATEGORY_WEIGHTS[c]}% of the score) was not measured.`);
  }
  if (coverage < PROVISIONAL_COVERAGE) reasons.push(`Only ${Math.round(coverage * 100)}% of the scoring model was measured.`);
  const provisional = coverage < PROVISIONAL_COVERAGE || unmeasuredCategories.some((c) => CATEGORY_WEIGHTS[c] >= MAJOR_CATEGORY_WEIGHT);
  return { coverage, provisional, reasons: [...new Set(reasons)], unmeasuredCategories };
}
