import type { IssueTemplate } from "../issues";
import type { AuditContext, Category, CheckStatus, ExtractedPage, IssueDraft, PageData } from "../types";

export interface CheckOutcome {
  status: CheckStatus;
  score: number | null;
  summary: string;
  unavailableReason?: string;
  drafts: IssueDraft[];
}

export interface CheckDefinition {
  id: string;
  category: Category;
  title: string;
  /** What the check measures, shown in the methodology table. */
  description: string;
  /** Relative weight inside its category. */
  weight: number;
  template: IssueTemplate;
  run(ctx: AuditContext): CheckOutcome;
}

export type HtmlPage = PageData & { extracted: ExtractedPage };

export function htmlPages(ctx: AuditContext): HtmlPage[] {
  return ctx.pages.filter((p): p is HtmlPage => !!p.extracted && p.status !== null && p.status < 400);
}

/** Pages a search engine may index (no noindex directive). */
export function indexablePages(ctx: AuditContext): HtmlPage[] {
  return htmlPages(ctx).filter((p) => !isNoindex(p));
}

export function isNoindex(page: PageData): boolean {
  const directives = `${page.extracted?.metaRobots ?? ""},${page.xRobotsTag ?? ""}`.toLowerCase();
  return /\b(noindex|none)\b/.test(directives);
}

export function unavailable(reason: string): CheckOutcome {
  return { status: "unavailable", score: null, summary: reason, unavailableReason: reason, drafts: [] };
}

export function pass(summary: string): CheckOutcome {
  return { status: "pass", score: 1, summary, drafts: [] };
}

/**
 * Standard outcome for checks evaluated on each page:
 * score = share of applicable pages without the problem.
 * pass when none fail, warning when at least 75% pass, otherwise fail.
 */
export function ratioOutcome(applicable: number, drafts: IssueDraft[], describe: (failed: number, total: number) => string): CheckOutcome {
  if (applicable === 0) return unavailable("No pages were available to evaluate this check.");
  const failedUrls = new Set(drafts.map((d) => d.url)).size;
  const score = Math.max(0, 1 - failedUrls / applicable);
  const status: CheckStatus = failedUrls === 0 ? "pass" : score >= 0.75 ? "warning" : "fail";
  return { status, score, summary: describe(failedUrls, applicable), drafts };
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isUtilityPage(url: string): boolean {
  return /(contact|privacy|terms|cookie|disclaimer|login|thank|sitemap|cart|checkout|404)/i.test(url);
}
