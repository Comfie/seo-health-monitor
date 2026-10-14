import { buildIssue } from "../issues";
import type { AuditContext, CheckResult, Issue } from "../types";
import { conversionChecks } from "./conversion";
import { unavailable, type CheckDefinition, type CheckOutcome } from "./helpers";
import { localChecks } from "./local";
import { onPageChecks } from "./onpage";
import { performanceChecks } from "./performance";
import { technicalChecks } from "./technical";

export const ALL_CHECKS: CheckDefinition[] = [
  ...technicalChecks,
  ...onPageChecks,
  ...performanceChecks,
  ...localChecks,
  ...conversionChecks,
];

export function runChecks(ctx: AuditContext, checks: CheckDefinition[] = ALL_CHECKS): CheckResult[] {
  return checks.map((def) => {
    let outcome: CheckOutcome;
    try {
      outcome = def.run(ctx);
    } catch (err) {
      outcome = unavailable(`This check could not run: ${(err as Error).message}`);
    }
    const issues = new Map<string, Issue>();
    for (const draft of outcome.drafts) {
      const issue = buildIssue(def.category, def.template, draft);
      if (!issues.has(issue.key)) issues.set(issue.key, issue);
    }
    return {
      id: def.id,
      category: def.category,
      title: def.title,
      description: def.description,
      weight: def.weight,
      status: outcome.status,
      score: outcome.score,
      summary: outcome.summary,
      unavailableReason: outcome.unavailableReason,
      issues: [...issues.values()],
    };
  });
}
