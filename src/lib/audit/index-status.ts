import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSiteConnection, latestSnapshot, searchConsoleSetup } from "@/lib/integrations/search-console/service";
import { runChecks } from "./checks";
import { technicalChecks } from "./checks/technical";
import { computeCounts, computeScores } from "./scoring";
import type { AuditContext, SearchConsoleContext } from "./types";

const INDEX_CHECK = technicalChecks.filter((c) => c.id === "tech-index-status");

/** Search Console state for a site, limited to inspections of the given page URLs. */
export function searchConsoleContext(siteId: number, pageUrls?: string[]): SearchConsoleContext {
  const configured = searchConsoleSetup().configured;
  const link = configured ? getSiteConnection(siteId) : null;
  if (!configured || !link) return { configured, linked: false };
  const snapshot = latestSnapshot(siteId);
  const wanted = pageUrls ? new Set(pageUrls) : null;
  const inspections = (snapshot?.inspections ?? []).filter((i) => !wanted || wanted.has(i.url));
  return { configured, linked: true, property: link.property, fetchedAt: snapshot?.fetchedAt, inspections };
}

/**
 * Re-evaluates only the "Google index coverage" check of a completed audit with
 * the latest Search Console data, so linking or refreshing Search Console updates
 * the audit without a re-crawl. The check has weight 0: scores stay unchanged,
 * only its status, issues and the issue counts change.
 */
export function applySearchConsoleToAudit(auditId: number): void {
  const db = getDb();
  const audit = db.select().from(schema.audits).where(eq(schema.audits.id, auditId)).get();
  if (!audit || audit.status !== "completed") return;
  const pageUrls = db.select({ finalUrl: schema.pages.finalUrl }).from(schema.pages).where(eq(schema.pages.auditId, auditId)).all().map((p) => p.finalUrl);
  const [result] = runChecks({ searchConsole: searchConsoleContext(audit.siteId, pageUrls) } as AuditContext, INDEX_CHECK);

  db.transaction((tx) => {
    tx.delete(schema.checks).where(and(eq(schema.checks.auditId, auditId), eq(schema.checks.checkId, result.id))).run();
    tx.delete(schema.issues).where(and(eq(schema.issues.auditId, auditId), eq(schema.issues.checkId, result.id))).run();
    tx.insert(schema.checks)
      .values({ auditId, checkId: result.id, category: result.category, title: result.title, description: result.description, status: result.status, score: result.score, weight: result.weight, summary: result.summary, unavailableReason: result.unavailableReason ?? null, affectedCount: result.issues.length })
      .run();
    for (const i of result.issues) {
      tx.insert(schema.issues)
        .values({ auditId, issueKey: i.key, checkId: i.checkId, category: i.category, severity: i.severity, title: i.title, url: i.url, evidence: i.evidence, why: i.why, fix: i.fix, implementation: i.implementation, benefit: i.benefit, impact: i.impact, confidence: i.confidence, effort: i.effort, priorityScore: i.priorityScore })
        .onConflictDoNothing()
        .run();
    }
    const allChecks = tx.select().from(schema.checks).where(eq(schema.checks.auditId, auditId)).all();
    const allIssues = tx.select().from(schema.issues).where(eq(schema.issues.auditId, auditId)).all();
    const scores = computeScores(allChecks);
    tx.update(schema.audits).set({ overallScore: scores.overall, categoryScores: scores.categories, counts: { ...computeCounts(allChecks, allIssues) } }).where(eq(schema.audits.id, auditId)).run();
  });
}

/** Applies Search Console data to the site's most recent completed audit, if any. */
export function applySearchConsoleToLatestAudit(siteId: number): number | null {
  const latest = getDb()
    .select({ id: schema.audits.id })
    .from(schema.audits)
    .where(and(eq(schema.audits.siteId, siteId), eq(schema.audits.status, "completed")))
    .orderBy(desc(schema.audits.completedAt))
    .limit(1)
    .get();
  if (!latest) return null;
  applySearchConsoleToAudit(latest.id);
  return latest.id;
}
