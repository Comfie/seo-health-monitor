import "server-only";
import type { FullAudit } from "@/lib/audit/repository";
import { buildFixPrompt, type FixPromptOptions } from "./claude-fix";

export function fixOptionsFrom(params: URLSearchParams | Record<string, string | string[] | undefined>): Pick<FixPromptOptions, "scope" | "includeLowConfidence" | "taskId"> {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : (Array.isArray(params[k]) ? params[k]![0] : (params[k] as string | undefined)) ?? null);
  return { scope: get("scope") === "all" ? "all" : "first", includeLowConfidence: get("low") === "1", taskId: get("task") ?? undefined };
}

export function fixPromptForAudit(full: FullAudit, selection: Pick<FixPromptOptions, "scope" | "includeLowConfidence" | "taskId">): string {
  const home = full.pages.find((p) => p.depth === 0) ?? full.pages[0];
  return buildFixPrompt(full.issues, {
    siteUrl: full.meta?.origin ?? full.audit.startUrl,
    auditId: full.audit.id,
    auditDate: full.audit.completedAt,
    platform: home?.data.extracted?.platform ?? null,
    unverifiedChecks: full.checks.filter((c) => c.status === "unavailable").map((c) => c.title),
    ...selection,
  });
}
