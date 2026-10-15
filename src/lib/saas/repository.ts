import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { assertSafeUrl } from "@/lib/crawler/ssrf";
import { normalizeInputUrl, stripWww } from "@/lib/crawler/url";
import type { SaasDb } from "./db";
import { LOCK_GLOBAL_QUEUE, advisoryLock, effectiveLimits, monthStart, readLimitSettings, usedUnits, type LimitSettings } from "./limits";
import { activity, jobs, usageRecords } from "./operations-schema";
import * as schema from "./schema";
import { AccessDeniedError, assertTenant, type TenantContext } from "./tenant";

export class OperationalLimitError extends Error {}
export class ValidationError extends Error {}

/** API shape for a website: no tenant IDs or internal fields. */
export const websiteView = (site: { id: number; host: string; displayName: string | null; displayUrl: string; createdAt: Date }) =>
  ({ id: site.id, host: site.host, displayName: site.displayName, url: site.displayUrl, createdAt: site.createdAt.toISOString() });

// Display names are shown back to the same customer only; still strip control characters.
function cleanName(name: unknown) {
  const value = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  if (!value || value.length > 120) throw new ValidationError("Enter a display name of up to 120 characters.");
  return value;
}

export function tenantRepository(db: SaasDb, context: TenantContext, settings: LimitSettings = readLimitSettings()) {
  const scopedId = (id: number) => and(eq(schema.audits.tenantId, context.tenantId), eq(schema.audits.id, id));
  async function getAudit(id: number) {
    await assertTenant(db, context);
    const [audit] = await db.select().from(schema.audits).where(scopedId(id)).limit(1);
    if (!audit) throw new AccessDeniedError();
    return audit;
  }
  type Tx = Parameters<Parameters<SaasDb["transaction"]>[0]>[0];
  const log = (tx: SaasDb | Tx, action: string, metadata: Record<string, string | number | boolean> = {}) =>
    tx.insert(activity).values({ id: randomUUID(), tenantId: context.tenantId, actorId: context.userId, action, metadata });
  return {
    getAudit,
    async getWebsite(id: number) {
      await assertTenant(db, context);
      const [site] = await db.select().from(schema.sites).where(and(eq(schema.sites.tenantId, context.tenantId), eq(schema.sites.id, id))).limit(1);
      if (!site) throw new AccessDeniedError();
      return site;
    },
    async listWebsites() {
      await assertTenant(db, context);
      return db.select().from(schema.sites).where(eq(schema.sites.tenantId, context.tenantId)).orderBy(desc(schema.sites.createdAt));
    },
    async listAudits() {
      await assertTenant(db, context);
      return db.select().from(schema.audits).where(eq(schema.audits.tenantId, context.tenantId)).orderBy(desc(schema.audits.createdAt)).limit(100);
    },
    async addWebsite(input: string, displayName: string) {
      await assertTenant(db, context);
      const url = normalizeInputUrl(input);
      assertSafeUrl(url);
      const name = cleanName(displayName);
      return db.transaction(async (tx) => {
        const [tenant] = await tx.select().from(schema.tenants).where(and(eq(schema.tenants.id, context.tenantId), eq(schema.tenants.status, "active"))).for("update");
        if (!tenant) throw new AccessDeniedError();
        const host = stripWww(new URL(url).hostname);
        const [existing] = await tx.select().from(schema.sites).where(and(eq(schema.sites.tenantId, context.tenantId), eq(schema.sites.host, host)));
        if (existing) return { ...existing, created: false };
        const [total] = await tx.select({ n: count() }).from(schema.sites).where(eq(schema.sites.tenantId, context.tenantId));
        if (total.n >= effectiveLimits(tenant, settings).websites) throw new OperationalLimitError("Website limit reached.");
        const [site] = await tx.insert(schema.sites).values({ tenantId: context.tenantId, displayUrl: url, displayName: name, host }).returning();
        await log(tx, "website.added", { websiteId: site.id, host });
        return { ...site, created: true };
      });
    },
    async renameWebsite(id: number, name: string) {
      await assertTenant(db, context);
      const displayName = cleanName(name);
      const [site] = await db.update(schema.sites).set({ displayName }).where(and(eq(schema.sites.tenantId, context.tenantId), eq(schema.sites.id, id))).returning();
      if (!site) throw new AccessDeniedError();
      await log(db, "website.renamed", { websiteId: site.id });
      return site;
    },
    async removeWebsite(id: number) {
      await assertTenant(db, context);
      return db.transaction(async (tx) => {
        // Same lock as audit creation; deletion cannot race an enqueue.
        await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.id, context.tenantId)).for("update");
        const [site] = await tx.select().from(schema.sites).where(and(eq(schema.sites.tenantId, context.tenantId), eq(schema.sites.id, id)));
        if (!site) throw new AccessDeniedError();
        const [active] = await tx.select({ id: schema.audits.id }).from(schema.audits).where(and(eq(schema.audits.tenantId, context.tenantId), eq(schema.audits.siteId, id), inArray(schema.audits.status, ["queued", "running"]))).limit(1);
        if (active) throw new OperationalLimitError("Wait for the active audit to finish before removing this website.");
        await tx.delete(schema.sites).where(and(eq(schema.sites.tenantId, context.tenantId), eq(schema.sites.id, id)));
        await log(tx, "website.removed", { websiteId: id, host: site.host });
      });
    },
    /** Everything the customer dashboard shows, filtered to this tenant only. */
    async dashboard(now = new Date()) {
      await assertTenant(db, context);
      const tenantId = context.tenantId;
      const [[tenant], sites, recentAudits, events, used] = await Promise.all([
        db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)),
        db.select().from(schema.sites).where(eq(schema.sites.tenantId, tenantId)).orderBy(desc(schema.sites.createdAt)),
        db.select({
          id: schema.audits.id, siteId: schema.audits.siteId, status: schema.audits.status, overallScore: schema.audits.overallScore,
          counts: schema.audits.counts, pagesScanned: schema.audits.pagesScanned, createdAt: schema.audits.createdAt, completedAt: schema.audits.completedAt,
        }).from(schema.audits).where(eq(schema.audits.tenantId, tenantId)).orderBy(desc(schema.audits.createdAt)).limit(50),
        db.select({ id: activity.id, action: activity.action, metadata: activity.metadata, createdAt: activity.createdAt })
          .from(activity).where(eq(activity.tenantId, tenantId)).orderBy(desc(activity.createdAt)).limit(10),
        usedUnits(db, { tenantId, kind: "audit", since: monthStart(now) }),
      ]);
      const limits = effectiveLimits(tenant, settings);
      const websites = sites.map((site) => {
        const audits = recentAudits.filter((a) => a.siteId === site.id);
        const latest = audits.find((a) => a.status === "completed") ?? null;
        const activeAudit = audits.find((a) => a.status === "queued" || a.status === "running");
        return { id: site.id, host: site.host, displayName: site.displayName, displayUrl: site.displayUrl, createdAt: site.createdAt, latest, active: !!activeAudit, activeAuditId: activeAudit?.id ?? null };
      });
      const scored = websites.map((w) => w.latest?.overallScore).filter((v): v is number => typeof v === "number");
      return {
        websites,
        latestAudits: recentAudits.slice(0, 8).map((a) => ({ ...a, site: sites.find((s) => s.id === a.siteId) ?? null })),
        overview: {
          averageScore: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
          criticalIssues: websites.reduce((sum, w) => sum + (w.latest?.counts?.critical ?? 0), 0),
          auditedWebsites: scored.length,
        },
        usage: { websites: sites.length, websiteLimit: limits.websites, auditsThisMonth: used, monthlyAuditLimit: limits.auditsPerMonth, pageLimit: limits.pagesPerScan },
        activity: events,
      };
    },
    async exportAudit(id: number) {
      const audit = await getAudit(id);
      const where = { tenantId: context.tenantId, auditId: audit.id };
      const [pages, checks, issues, performance] = await Promise.all([
        db.select().from(schema.pages).where(and(eq(schema.pages.tenantId, where.tenantId), eq(schema.pages.auditId, where.auditId))),
        db.select().from(schema.checks).where(and(eq(schema.checks.tenantId, where.tenantId), eq(schema.checks.auditId, where.auditId))),
        db.select().from(schema.issues).where(and(eq(schema.issues.tenantId, where.tenantId), eq(schema.issues.auditId, where.auditId))),
        db.select().from(schema.performanceResults).where(and(eq(schema.performanceResults.tenantId, where.tenantId), eq(schema.performanceResults.auditId, where.auditId))),
      ]);
      return { audit, pages, checks, issues, performance };
    },
    async searchConsoleSnapshots(siteId: number) {
      await assertTenant(db, context);
      const [site] = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.tenantId, context.tenantId), eq(schema.sites.id, siteId)));
      if (!site) throw new AccessDeniedError();
      return db.select().from(schema.searchSnapshots).where(and(eq(schema.searchSnapshots.tenantId, context.tenantId), eq(schema.searchSnapshots.siteId, siteId)));
    },
    async enqueueAudit(siteId: number, now = new Date()) {
      await assertTenant(db, context);
      return db.transaction(async (tx) => {
        // Serialize quota checks and insertion across processes, not an in-memory counter.
        const [tenant] = await tx.select().from(schema.tenants).where(and(eq(schema.tenants.id, context.tenantId), eq(schema.tenants.status, "active"))).for("update");
        if (!tenant) throw new AccessDeniedError();
        const limits = effectiveLimits(tenant, settings);
        const [site] = await tx.select().from(schema.sites).where(and(eq(schema.sites.tenantId, context.tenantId), eq(schema.sites.id, siteId)));
        if (!site) throw new AccessDeniedError();
        assertSafeUrl(site.displayUrl);
        const [active] = await tx.select({ n: count() }).from(jobs).where(and(eq(jobs.tenantId, context.tenantId), inArray(jobs.state, ["queued", "running"])));
        if (active.n >= limits.concurrentScans) throw new OperationalLimitError("An audit is already active for this account.");
        if ((await usedUnits(tx, { tenantId: context.tenantId, kind: "audit", since: monthStart(now) })) >= limits.auditsPerMonth) throw new OperationalLimitError("Monthly audit limit reached.");
        // Global admission: one queue for every account, serialised across processes.
        await advisoryLock(tx, LOCK_GLOBAL_QUEUE);
        const [queued] = await tx.select({ n: count() }).from(jobs).where(eq(jobs.state, "queued"));
        if (queued.n >= settings.global.maxQueued) throw new OperationalLimitError("The beta is busy right now. Try again in a few minutes.");
        const payload = { maxPages: limits.pagesPerScan, pagespeedPages: settings.global.pagespeedPagesPerAudit };
        const [audit] = await tx.insert(schema.audits).values({ tenantId: context.tenantId, siteId, inputUrl: site.displayUrl, startUrl: site.displayUrl, status: "queued", stage: "Queued", meta: payload, createdAt: now }).returning();
        await tx.insert(jobs).values({ id: randomUUID(), tenantId: context.tenantId, auditId: audit.id, kind: "audit", requestedBy: context.userId, payload, availableAt: now, createdAt: now });
        await tx.insert(usageRecords).values({ id: randomUUID(), tenantId: context.tenantId, auditId: audit.id, kind: "audit", createdAt: now });
        await log(tx, "audit.started", { auditId: audit.id, websiteId: site.id, host: site.host });
        return audit;
      });
    },
  };
}
