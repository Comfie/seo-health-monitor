import "server-only";
import type { FullAudit } from "@/lib/audit/repository";
import { buildActionPlan } from "./action-plan";
import { assessScore } from "@/lib/audit/scoring";
import { CATEGORY_LABELS } from "@/lib/audit/types";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(" | ") : String(value);
  // Neutralise spreadsheet formula injection from crawled content.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function issuesToCsv(full: FullAudit): string {
  const header = ["issue_id", "priority_score", "severity", "category", "check_id", "title", "url", "evidence", "why_it_matters", "recommended_fix", "implementation", "expected_benefit", "confidence", "effort"];
  const rows = full.issues.map((i) =>
    [i.issueKey, i.priorityScore, i.severity, i.category, i.checkId, i.title, i.url, i.evidence, i.why, i.fix, i.implementation, i.benefit, i.confidence, i.effort].map(csvCell).join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}

export function auditToJson(full: FullAudit) {
  const { audit, meta, checks, issues, pages, performance } = full;
  return {
    generator: "SEO Health Monitor",
    audit: {
      id: audit.id,
      inputUrl: audit.inputUrl,
      startUrl: audit.startUrl,
      status: audit.status,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
      pagesScanned: audit.pagesScanned,
      scores: { overall: audit.overallScore, categories: audit.categoryScores, label: "On-site SEO health" },
      scoreAssessment: assessScore(checks, CATEGORY_LABELS),
      counts: audit.counts,
    },
    crawl: meta
      ? {
          origin: meta.origin,
          robots: { url: meta.robots.url, found: meta.robots.found, status: meta.robots.status, sitemaps: meta.robots.sitemaps },
          sitemap: meta.sitemap,
          notes: meta.notes,
          blockedByRobots: meta.blockedByRobots,
        }
      : null,
    checks: checks.map(({ id: _id, auditId: _a, ...c }) => c),
    actionPlan: buildActionPlan(issues).map((item) => ({ title: item.title, priority: item.bucket, priorityScore: item.priorityScore, severity: item.severity, category: item.category, affectedUrls: item.issues.map((i) => i.url) })),
    issues: issues.map(({ id: _id, auditId: _a, ...i }) => i),
    pages: pages.map((p) => ({ url: p.url, finalUrl: p.finalUrl, status: p.status, title: p.title, metaDescription: p.metaDescription, h1: p.h1, canonical: p.canonical, metaRobots: p.metaRobots, wordCount: p.wordCount, responseTimeMs: p.responseTimeMs })),
    performance: performance.map(({ id: _id, auditId: _a, ...p }) => p),
    searchConsole: { connected: false, note: "Search Console metrics are not part of this audit." },
  };
}
