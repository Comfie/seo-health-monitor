import "server-only";
import { recordEvent } from "./telemetry";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { FullAudit } from "@/lib/audit/repository";
import { compareAudits, type CompareInput } from "@/lib/audit/compare";
import type { Category } from "@/lib/audit/types";
import type { SaasDb } from "./db";
import { requestCancel } from "./jobs";
import { BudgetExhaustedError, LOCK_GLOBAL_QUEUE, advisoryLock, effectiveLimits, monthStart, readLimitSettings, releaseUsage, reserveUsage, usageSummary, usedUnits, type LimitSettings } from "./limits";
import { activity, jobs } from "./operations-schema";
import { OperationalLimitError, tenantRepository } from "./repository";
import * as schema from "./schema";
import { AccessDeniedError, assertTenant, type TenantContext } from "./tenant";

export class AuditStateError extends Error {}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Public status shape: no tenant IDs, lease tokens, worker IDs or internal errors. */
export type AuditStatus = {
  id: number;
  websiteId: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string | null;
  progress: number;
  log: string[];
  error: string | null;
  overallScore: number | null;
  pagesScanned: number | null;
  attempts: number;
  cancelRequested: boolean;
  pagespeedRerun: "queued" | "running" | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Tenant-scoped audit operations for customer routes and pages. Every method rechecks the
 * session-derived membership, filters by tenant ID and answers "not found" for anything the
 * account does not own, so another tenant's IDs are indistinguishable from missing ones.
 */
export function customerAudits(db: SaasDb, context: TenantContext, settings: LimitSettings = readLimitSettings()) {
  const repo = tenantRepository(db, context, settings);
  const tenantId = context.tenantId;
  const own = (id: number) => and(eq(schema.audits.tenantId, tenantId), eq(schema.audits.id, id));

  async function auditRow(id: number) {
    await assertTenant(db, context);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AccessDeniedError();
    const [audit] = await db.select().from(schema.audits).where(own(id)).limit(1);
    if (!audit) throw new AccessDeniedError();
    return audit;
  }

  /** Everything the report generators need, in the same order as the Phase 1 repository. */
  async function full(id: number): Promise<FullAudit> {
    const audit = await auditRow(id);
    if (audit.status !== "completed") throw new AuditStateError("This audit has not completed yet.");
    const by = (t: typeof schema.pages | typeof schema.checks | typeof schema.issues | typeof schema.performanceResults) => and(eq(t.tenantId, tenantId), eq(t.auditId, id));
    const [[site], checks, issues, pages, performance] = await Promise.all([
      db.select().from(schema.sites).where(and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.id, audit.siteId))),
      db.select().from(schema.checks).where(by(schema.checks)).orderBy(asc(schema.checks.id)),
      db.select().from(schema.issues).where(by(schema.issues)),
      db.select().from(schema.pages).where(by(schema.pages)).orderBy(asc(schema.pages.depth), asc(schema.pages.id)),
      db.select().from(schema.performanceResults).where(by(schema.performanceResults)).orderBy(asc(schema.performanceResults.id)),
    ]);
    if (!site) throw new AccessDeniedError();
    issues.sort((a, b) => b.priorityScore - a.priorityScore || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.url.localeCompare(b.url));
    // Same columns as the Phase 1 rows once tenant_id is removed, so the existing report, PDF,
    // CSV, JSON and Fix-with-AI generators run unchanged and never see an internal tenant ID.
    const bare = <T extends { tenantId: string }>({ tenantId: _t, ...row }: T) => row;
    return {
      audit: bare(audit), meta: (audit.meta as FullAudit["meta"]) ?? null, site: bare(site),
      checks: checks.map(bare), issues: issues.map(bare), pages: pages.map(bare), performance: performance.map(bare),
    } as unknown as FullAudit;
  }

  async function status(id: number): Promise<AuditStatus> {
    const audit = await auditRow(id);
    const active = await db.select({ kind: jobs.kind, state: jobs.state, cancelRequestedAt: jobs.cancelRequestedAt }).from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.auditId, id), inArray(jobs.state, ["queued", "running"])));
    const pagespeed = active.find((j) => j.kind === "pagespeed");
    return {
      id: audit.id, websiteId: audit.siteId, status: audit.status, stage: audit.stage, progress: audit.progress, log: audit.log, error: audit.error,
      overallScore: audit.overallScore, pagesScanned: audit.pagesScanned, attempts: audit.attempts,
      cancelRequested: active.some((j) => j.kind === "audit" && j.cancelRequestedAt !== null),
      pagespeedRerun: pagespeed ? (pagespeed.state as "queued" | "running") : null,
      createdAt: audit.createdAt.toISOString(), startedAt: iso(audit.startedAt), completedAt: iso(audit.completedAt),
    };
  }

  return {
    status,
    full,
    start: (websiteId: number, now = new Date()) => repo.enqueueAudit(websiteId, now),

    /** Audit history, optionally for one owned website. */
    async history(options: { websiteId?: number; limit?: number } = {}) {
      await assertTenant(db, context);
      if (options.websiteId !== undefined) await repo.getWebsite(options.websiteId);
      const rows = await db.select({ audit: schema.audits, host: schema.sites.host, displayName: schema.sites.displayName }).from(schema.audits)
        .innerJoin(schema.sites, and(eq(schema.sites.tenantId, schema.audits.tenantId), eq(schema.sites.id, schema.audits.siteId)))
        .where(and(eq(schema.audits.tenantId, tenantId), options.websiteId !== undefined ? eq(schema.audits.siteId, options.websiteId) : undefined))
        .orderBy(desc(schema.audits.createdAt), desc(schema.audits.id)).limit(Math.min(200, options.limit ?? 100));
      return rows.map(({ audit, host, displayName }) => ({
        id: audit.id, websiteId: audit.siteId, host, displayName, status: audit.status, overallScore: audit.overallScore,
        categoryScores: audit.categoryScores, counts: audit.counts, pagesScanned: audit.pagesScanned,
        createdAt: audit.createdAt.toISOString(), completedAt: iso(audit.completedAt),
      }));
    },

    /** Findings for one completed audit, optionally one category. */
    async findings(id: number, category?: Category) {
      const f = await full(id);
      const pick = <T extends { category: string }>(rows: T[]) => (category ? rows.filter((r) => r.category === category) : rows);
      return { checks: pick(f.checks), issues: pick(f.issues), performance: category && category !== "performance" ? [] : f.performance };
    },

    async cancel(id: number) {
      const audit = await auditRow(id);
      const outcome = await requestCancel(db, tenantId, audit.id);
      if (outcome === "not-active") throw new AuditStateError("Only queued or running audits can be cancelled.");
      await db.insert(activity).values({ id: randomUUID(), tenantId, actorId: context.userId, action: "audit.cancelled", metadata: { auditId: audit.id } });
      return outcome;
    },

    /** Compares two completed audits of the same owned website. */
    async compare(a: number, b: number) {
      if (a === b) throw new AuditStateError("Pick two different scans.");
      const [older, newer] = (await Promise.all([full(a), full(b)])).sort((x, y) => (x.audit.completedAt?.getTime() ?? 0) - (y.audit.completedAt?.getTime() ?? 0));
      if (older.site.id !== newer.site.id) throw new AuditStateError("These audits are for different websites. Compare scans of the same site.");
      const input = (f: FullAudit): CompareInput => ({
        overallScore: f.audit.overallScore,
        categoryScores: f.audit.categoryScores as Partial<Record<Category, number | null>> | null,
        counts: f.audit.counts ?? null,
        issues: f.issues,
        pages: f.pages,
        performance: f.performance,
      });
      return { older, newer, result: compareAudits(input(older), input(newer)) };
    },

    /** Queues a PageSpeed-only re-test. Each test is still charged to the budget when it runs. */
    async rerunPagespeed(id: number, now = new Date()) {
      await auditRow(id);
      return db.transaction(async (tx) => {
        const [tenant] = await tx.select().from(schema.tenants).where(and(eq(schema.tenants.id, tenantId), eq(schema.tenants.status, "active"))).for("update");
        if (!tenant) throw new AccessDeniedError();
        const [audit] = await tx.select().from(schema.audits).where(own(id));
        if (!audit) throw new AccessDeniedError();
        if (audit.status !== "completed") throw new AuditStateError("Only completed audits can be re-tested.");
        const limits = effectiveLimits(tenant, settings);
        const pagespeedPages = settings.global.pagespeedPagesPerAudit;
        if (pagespeedPages === 0) throw new AuditStateError("PageSpeed testing is disabled for the beta.");
        const [active] = await tx.select({ n: count() }).from(jobs).where(and(eq(jobs.tenantId, tenantId), inArray(jobs.state, ["queued", "running"])));
        if (active.n >= limits.concurrentScans) throw new OperationalLimitError("Wait for the active audit or re-test to finish.");
        if ((await usedUnits(tx, { tenantId, kind: "pagespeed", since: monthStart(now) })) + 2 > limits.pagespeedPerMonth) {
          throw new OperationalLimitError(`This account's monthly PageSpeed allowance (${limits.pagespeedPerMonth} tests) has been used.`);
        }
        await advisoryLock(tx, LOCK_GLOBAL_QUEUE);
        const [queued] = await tx.select({ n: count() }).from(jobs).where(eq(jobs.state, "queued"));
        if (queued.n >= settings.global.maxQueued) throw new OperationalLimitError("The beta is busy right now. Try again in a few minutes.");
        await tx.insert(jobs).values({ id: randomUUID(), tenantId, auditId: id, kind: "pagespeed", requestedBy: context.userId, payload: { pagespeedPages }, maxAttempts: 2, availableAt: now, createdAt: now });
        await tx.insert(activity).values({ id: randomUUID(), tenantId, actorId: context.userId, action: "pagespeed.requested", metadata: { auditId: id } });
      });
    },

    /** Stored AI consultant report, or a new one within the AI budget. */
    async consultantReport(id: number, generate: (f: FullAudit) => Promise<{ report: string; model: string }>, options: { regenerate?: boolean; now?: Date } = {}) {
      const f = await full(id);
      if (f.audit.aiReport && !options.regenerate) return { report: f.audit.aiReport, model: f.audit.aiModel, cached: true };
      const now = options.now ?? new Date();
      if (f.audit.aiGeneratedAt && now.getTime() - f.audit.aiGeneratedAt.getTime() < 2 * 60_000) {
        throw new OperationalLimitError("This report was generated moments ago. Wait two minutes before regenerating.");
      }
      let reservation: string;
      try {
        reservation = await reserveUsage(db, { tenantId, auditId: id, kind: "ai", settings, now });
      } catch (error) {
        if (error instanceof BudgetExhaustedError) throw new OperationalLimitError(error.message);
        throw error;
      }
      let generated;
      try {
        generated = await generate(f);
      } catch (error) {
        // No report was produced: a provider outage must not use up the account's allowance.
        // Repeated failures are still bounded by the route's per-account request throttle.
        await recordEvent(db, "ai.failure", tenantId);
        await releaseUsage(db, tenantId, reservation);
        throw error;
      }
      const { report, model } = generated;
      await db.update(schema.audits).set({ aiReport: report, aiModel: model, aiGeneratedAt: now }).where(own(id));
      return { report, model, cached: false };
    },

    async usage(now = new Date()) {
      await assertTenant(db, context);
      const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
      return { limits: effectiveLimits(tenant, settings), used: await usageSummary(db, tenantId, now) };
    },
  };
}
