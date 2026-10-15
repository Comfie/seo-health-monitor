import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saasSchema, type SaasDb } from "@/lib/saas/db";
import { createInvitation } from "@/lib/saas/invitations";
import { provisionPersonalTenant, type TenantContext } from "@/lib/saas/tenant";
import { tenantRepository } from "@/lib/saas/repository";
import { customerAudits } from "@/lib/saas/audits";
import { claimJob, completeJob, failJob, heartbeat, recoverExpiredJobs, reportProgress, requestCancel, LeaseLostError, type QueueTiming } from "@/lib/saas/jobs";
import { executeJob, type RunnerDeps } from "@/lib/saas/audit-runner";
import { createWorker } from "@/lib/saas/worker";
import { readLimitSettings, reserveUsage, type LimitSettings } from "@/lib/saas/limits";
import { CrawlError, type CrawlOptions } from "@/lib/crawler/crawl";
import type { CrawlResult, PerformanceResult } from "@/lib/audit/types";
import { context as crawlContext, htmlPage, page } from "./helpers";

const client = new PGlite();
const db = drizzle(client, { schema: saasSchema }) as unknown as SaasDb;
const timing: QueueTiming = { leaseMs: 60_000, backoffBaseMs: 30_000, backoffMaxMs: 300_000 };
const base = (overrides: Partial<LimitSettings["global"]> = {}): LimitSettings => {
  const s = readLimitSettings({});
  return { tenant: { ...s.tenant }, global: { ...s.global, maxRunning: 5, ...overrides } };
};
let settings = base();

/** A deterministic crawl of `pages` HTML pages on example.com (no network). */
function fakeCrawl(pages = 3, seen: CrawlOptions[] = []) {
  return async (_url: string, options: CrawlOptions): Promise<CrawlResult> => {
    seen.push(options);
    const list = [htmlPage("/", page(`<h1>Home</h1><a href="/p1">p1</a><a href="/p2">p2</a>`, "<title>Home page title for the test site</title>"))];
    for (let i = 1; i < Math.min(pages, options.maxPages); i++) list.push(htmlPage(`/p${i}`, page(`<h1>Page ${i}</h1><p>${"word ".repeat(300)}</p>`, `<title>Page ${i} title for the test site</title>`)));
    return crawlContext(list);
  };
}
const okSpeed = async (url: string, strategy: "mobile" | "desktop"): Promise<PerformanceResult> => ({ url, strategy, status: "ok", performanceScore: 91, lcpMs: 1800, cls: 0.01, tbtMs: 80, opportunities: [] });

let clock = new Date("2026-10-14T10:00:00Z");
const now = () => clock;
const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };
const deps = (extra: Partial<RunnerDeps> = {}): RunnerDeps => ({ db, settings, timing, crawl: fakeCrawl(), pagespeed: okSpeed, pagespeedApiKey: "test-key", now, ...extra });
const control = () => { const c = new AbortController(); return { signal: c.signal, abort: (r: Error) => c.abort(r), controller: c }; };

async function customer(email: string): Promise<TenantContext> {
  const id = randomUUID();
  await createInvitation(db, { email, createdBy: null, ttlHours: 24 });
  await db.insert(saasSchema.user).values({ id, name: email.split("@")[0], email, emailVerified: true });
  return provisionPersonalTenant(db, { id, email, name: email.split("@")[0], emailVerified: true });
}

let alice: TenantContext;
let bob: TenantContext;
let aliceSite: number;
let bobSite: number;

async function resetQueue() {
  await db.delete(saasSchema.operationalEvents);
  await db.delete(saasSchema.jobs);
  await db.delete(saasSchema.audits);
  await db.delete(saasSchema.usageRecords);
  await db.update(saasSchema.tenants).set({ websiteLimit: null, monthlyAuditLimit: null, pageLimit: null, concurrentAuditLimit: null, monthlyPagespeedLimit: null, monthlyAiLimit: null, status: "active" });
}

beforeAll(async () => {
  await migrate(drizzle(client), { migrationsFolder: "drizzle-saas" });
  alice = await customer("alice@example.com");
  bob = await customer("bob@example.com");
  aliceSite = (await tenantRepository(db, alice).addWebsite("https://example.com", "Alice's site")).id;
  bobSite = (await tenantRepository(db, bob).addWebsite("https://example.com", "Bob's site")).id;
}, 30_000);
beforeEach(async () => {
  settings = base();
  clock = new Date("2026-10-14T10:00:00Z");
  await resetQueue();
});
afterAll(() => client.close());

const start = (ctx: TenantContext, site: number) => customerAudits(db, ctx, settings).start(site, now()).then((a) => a.id);
const jobOf = async (auditId: number, kind: "audit" | "pagespeed" = "audit") =>
  (await db.select().from(saasSchema.jobs).where(and(eq(saasSchema.jobs.auditId, auditId), eq(saasSchema.jobs.kind, kind))))[0];

describe("tenant audit execution", () => {
  it("lets two customers audit the same public domain with separate results and history", async () => {
    const a = await start(alice, aliceSite);
    const b = await start(bob, bobSite);
    for (let i = 0; i < 2; i++) {
      const lease = (await claimJob(db, "w1", settings, timing, now()))!;
      expect(await executeJob(deps({ crawl: fakeCrawl(lease.tenantId === alice.tenantId ? 3 : 2) }), lease, control())).toBe("completed");
    }
    const audA = customerAudits(db, alice, settings);
    const audB = customerAudits(db, bob, settings);
    expect((await audA.full(a)).pages).toHaveLength(3);
    expect((await audB.full(b)).pages).toHaveLength(2);
    expect((await audA.history()).map((h) => h.id)).toEqual([a]);
    expect((await audB.history()).map((h) => h.id)).toEqual([b]);
    // Another tenant's audit ID is indistinguishable from a missing one at the data layer.
    for (const call of [() => audB.full(a), () => audB.status(a), () => audB.findings(a), () => audB.cancel(a), () => audB.compare(a, b), () => audB.rerunPagespeed(a), () => audB.history({ websiteId: aliceSite })]) {
      await expect(call()).rejects.toThrow("Resource unavailable");
    }
    const rows = await db.select({ tenantId: saasSchema.pages.tenantId }).from(saasSchema.pages).where(eq(saasSchema.pages.auditId, a));
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([alice.tenantId]));
    const status = await audA.status(a);
    expect(status).toMatchObject({ status: "completed", progress: 100, pagesScanned: 3 });
    expect(JSON.stringify(status)).not.toMatch(/tenant|lease|worker/i);
  });

  it("claims each job exactly once under concurrent workers", async () => {
    await start(alice, aliceSite);
    const leases = (await Promise.all(Array.from({ length: 6 }, (_, i) => claimJob(db, `w${i}`, settings, timing, now())))).filter(Boolean);
    expect(leases).toHaveLength(1);
    expect(leases[0]!.fence).toBe(1);
  });

  it("enforces the global running limit across tenants", async () => {
    settings = base({ maxRunning: 1 });
    await start(alice, aliceSite);
    await start(bob, bobSite);
    expect(await claimJob(db, "w1", settings, timing, now())).not.toBeNull();
    expect(await claimJob(db, "w2", settings, timing, now())).toBeNull();
  });

  it("enforces per-tenant concurrency at claim time and skips suspended accounts", async () => {
    await db.update(saasSchema.tenants).set({ concurrentAuditLimit: 2, websiteLimit: 3 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    const second = (await tenantRepository(db, alice, settings).addWebsite("https://www.iana.org", "IANA")).id;
    await start(alice, aliceSite);
    await start(alice, second);
    await db.update(saasSchema.tenants).set({ concurrentAuditLimit: 1 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    const first = await claimJob(db, "w1", settings, timing, now());
    expect(first?.tenantId).toBe(alice.tenantId);
    expect(await claimJob(db, "w1", settings, timing, now())).toBeNull();
    // A queued job of a suspended account is never claimed.
    await start(bob, bobSite);
    await db.update(saasSchema.tenants).set({ status: "suspended" }).where(eq(saasSchema.tenants.id, bob.tenantId));
    expect(await claimJob(db, "w2", settings, timing, now())).toBeNull();
    await db.delete(saasSchema.sites).where(eq(saasSchema.sites.id, second));
  });

  it("fences out a stale worker after its lease expires and another worker retries", async () => {
    const audit = await start(alice, aliceSite);
    const stale = (await claimJob(db, "w-old", settings, timing, now()))!;
    expect(await reportProgress(db, stale, 30, "Crawling", now())).toBe(true);
    advance(timing.leaseMs + 1);
    expect(await recoverExpiredJobs(db, timing, now())).toMatchObject({ requeued: 1 });
    advance(backoffWait(1));
    const fresh = (await claimJob(db, "w-new", settings, timing, now()))!;
    expect(fresh.fence).toBe(stale.fence + 1);
    expect(fresh.tenantId).toBe(alice.tenantId);
    // Every write from the stale worker is rejected.
    expect(await reportProgress(db, stale, 80, "stale progress", now())).toBe(false);
    expect(await heartbeat(db, stale, timing, now())).toBeNull();
    await expect(completeJob(db, stale, async () => { throw new Error("must not run"); }, now())).rejects.toThrow(LeaseLostError);
    expect(await failJob(db, stale, { message: "stale", retryable: false }, timing, now())).toBe("stale");
    expect(await executeJob(deps({ crawl: fakeCrawl(2) }), fresh, control())).toBe("completed");
    // The stale worker finishing later cannot overwrite the completed result.
    expect(await executeJob(deps({ crawl: fakeCrawl(3) }), stale, control())).toBe("stale");
    const full = await customerAudits(db, alice, settings).full(audit);
    expect(full.pages).toHaveLength(2);
    expect(full.audit.attempts).toBe(2);
  });

  it("recovers jobs from a crashed worker process and completes them on another worker", async () => {
    const audit = await start(alice, aliceSite);
    let release!: () => void;
    const hang = new Promise<void>((r) => { release = r; });
    const crashed = createWorker({ ...deps({ crawl: async (u, o) => { await hang; return fakeCrawl(4)(u, o); } }), workerId: "crashed", heartbeatMs: 3_600_000 });
    await crashed.tick();
    expect((await jobOf(audit)).lockedBy).toBe("crashed");
    // The process "dies": no more heartbeats; time passes beyond the lease and the backoff.
    advance(timing.leaseMs + backoffWait(1) + 1);
    const outcomes: string[] = [];
    const survivor = createWorker({ ...deps({ crawl: fakeCrawl(2) }), workerId: "survivor", onOutcome: (_l, o) => outcomes.push(o) });
    await survivor.tick(); // recovers (requeue with backoff)
    advance(backoffWait(1) + 1);
    await survivor.tick(); // claims and runs
    await Promise.all(survivor.active());
    expect(outcomes).toEqual(["completed"]);
    release();
    await Promise.all(crashed.active());
    const job = await jobOf(audit);
    expect(job).toMatchObject({ state: "completed", attempts: 2, lockedBy: "survivor" });
    expect((await customerAudits(db, alice, settings).full(audit)).pages).toHaveLength(2);
  });

  it("retries transient failures with backoff, then fails without leaking internals", async () => {
    const audit = await start(alice, aliceSite);
    const boom = async () => { throw new Error("connect ECONNRESET 10.0.0.5 secret-internal-detail"); };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const lease = (await claimJob(db, "w1", settings, timing, now()))!;
      expect(lease.attempts).toBe(attempt);
      const outcome = await executeJob(deps({ crawl: boom }), lease, control());
      expect(outcome).toBe(attempt < 3 ? "retry" : "failed");
      if (attempt < 3) {
        expect(await claimJob(db, "w1", settings, timing, now())).toBeNull();
        advance(backoffWait(attempt) + 1);
      }
    }
    const status = await customerAudits(db, alice, settings).status(audit);
    expect(status.status).toBe("failed");
    expect(status.error).not.toMatch(/ECONNRESET|10\.0\.0\.5|secret/);
  });

  it("fails immediately on a non-retryable crawl error with its explanation", async () => {
    const audit = await start(alice, aliceSite);
    const lease = (await claimJob(db, "w1", settings, timing, now()))!;
    expect(await executeJob(deps({ crawl: async () => { throw new CrawlError("Could not reach https://example.com/: timeout"); } }), lease, control())).toBe("failed");
    expect((await customerAudits(db, alice, settings).status(audit)).error).toBe("Could not reach https://example.com/: timeout");
  });

  it("cancels queued audits (refunding the unused allowance) and running audits at the next checkpoint", async () => {
    const service = customerAudits(db, alice, settings);
    const queued = await start(alice, aliceSite);
    expect(await service.cancel(queued)).toBe("cancelled");
    expect((await service.status(queued)).status).toBe("cancelled");
    expect(await db.select().from(saasSchema.usageRecords).where(eq(saasSchema.usageRecords.auditId, queued))).toHaveLength(0);
    await expect(service.cancel(queued)).rejects.toThrow("Only queued or running");

    const running = await start(alice, aliceSite);
    const lease = (await claimJob(db, "w1", settings, timing, now()))!;
    expect(await service.cancel(running)).toBe("cancelling");
    expect((await service.status(running)).cancelRequested).toBe(true);
    expect(await heartbeat(db, lease, timing, now())).toEqual({ cancelRequested: true });
    const c = control();
    let started = false;
    const crawl = async (u: string, o: CrawlOptions) => { started = true; c.abort(new (await import("@/lib/saas/jobs")).JobCancelledError()); o.signal?.throwIfAborted(); return fakeCrawl()(u, o); };
    expect(await executeJob(deps({ crawl }), lease, c)).toBe("cancelled");
    expect(started).toBe(true);
    expect((await service.status(running)).status).toBe("cancelled");
    expect(await db.select().from(saasSchema.pages).where(eq(saasSchema.pages.auditId, running))).toHaveLength(0);
    expect(await db.select().from(saasSchema.usageRecords).where(eq(saasSchema.usageRecords.auditId, running))).toHaveLength(1);
  });

  it("cancels a running audit whose worker died", async () => {
    const audit = await start(alice, aliceSite);
    await claimJob(db, "w1", settings, timing, now());
    await requestCancel(db, alice.tenantId, audit, now());
    advance(timing.leaseMs + 1);
    expect(await recoverExpiredJobs(db, timing, now())).toMatchObject({ cancelled: 1 });
    expect((await jobOf(audit)).state).toBe("cancelled");
  });

  it("hands jobs back on graceful shutdown without using an attempt", async () => {
    const audit = await start(alice, aliceSite);
    const worker = createWorker({ ...deps({ crawl: (u, o) => new Promise((_, reject) => { if (o.signal?.aborted) reject(o.signal.reason); o.signal?.addEventListener("abort", () => reject(o.signal!.reason)); }) }), workerId: "w1" });
    await worker.tick();
    await worker.stop();
    expect(await jobOf(audit)).toMatchObject({ state: "queued", attempts: 0, leaseToken: null });
  });

  it("aborts a job that exceeds its deadline and schedules a retry", async () => {
    const audit = await start(alice, aliceSite);
    const outcomes: string[] = [];
    const never = (_u: string, o: CrawlOptions) => new Promise<never>((_, reject) => o.signal?.addEventListener("abort", () => reject(o.signal!.reason)));
    const worker = createWorker({ ...deps({ crawl: never }), workerId: "w1", deadlineMs: 50, onOutcome: (_l, o) => outcomes.push(o) });
    await worker.tick();
    await Promise.all(worker.active());
    expect(outcomes).toEqual(["retry"]);
    expect(await jobOf(audit)).toMatchObject({ state: "queued", attempts: 1 });
  });

  it("snapshots the page limit at admission and passes it to the crawler", async () => {
    await db.update(saasSchema.tenants).set({ pageLimit: 7 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    await start(alice, aliceSite);
    await db.update(saasSchema.tenants).set({ pageLimit: 90 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    const seen: CrawlOptions[] = [];
    const lease = (await claimJob(db, "w1", settings, timing, now()))!;
    expect(lease.payload.maxPages).toBe(7);
    await executeJob(deps({ crawl: fakeCrawl(3, seen) }), lease, control());
    expect(seen[0].maxPages).toBe(7);
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("records progress under the lease and caps the activity log", async () => {
    const audit = await start(alice, aliceSite);
    const lease = (await claimJob(db, "w1", settings, timing, now()))!;
    for (let i = 0; i < 205; i++) await reportProgress(db, lease, i / 3, `step ${i}`, now());
    const status = await customerAudits(db, alice, settings).status(audit);
    expect(status).toMatchObject({ status: "running", stage: "step 204", progress: 68 });
    expect(status.log).toHaveLength(200);
    expect(status.log.at(-1)).toMatch(/step 204$/);
  });

  it("refuses to complete for a suspended account", async () => {
    await start(alice, aliceSite);
    const lease = (await claimJob(db, "w1", settings, timing, now()))!;
    await db.update(saasSchema.tenants).set({ status: "suspended" }).where(eq(saasSchema.tenants.id, alice.tenantId));
    expect(await executeJob(deps(), lease, control())).toBe("stale");
    expect(await db.select().from(saasSchema.pages)).toHaveLength(0);
  });
});

describe("quotas and provider budgets", () => {
  it("admits no more than the monthly allowance under parallel requests", async () => {
    await db.update(saasSchema.tenants).set({ monthlyAuditLimit: 3, concurrentAuditLimit: 10 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    const service = customerAudits(db, alice, settings);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.start(aliceSite, now())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason.message))).toContain("Monthly audit limit reached.");
  });

  it("refuses admission once the global queue is full", async () => {
    settings = base({ maxQueued: 1 });
    await start(alice, aliceSite);
    await expect(start(bob, bobSite)).rejects.toThrow("The beta is busy");
  });

  it("charges PageSpeed tests to the account and marks unfunded tests unavailable, never successful", async () => {
    await db.update(saasSchema.tenants).set({ monthlyPagespeedLimit: 3 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    const audit = await start(alice, aliceSite);
    const lease = (await claimJob(db, "w1", settings, timing, now()))!;
    let calls = 0;
    await executeJob(deps({ pagespeed: async (u, s) => { calls++; return okSpeed(u, s); } }), lease, control());
    const { performance } = await customerAudits(db, alice, settings).full(audit);
    expect(performance).toHaveLength(6);
    expect(calls).toBe(3);
    expect(performance.filter((p) => p.status === "ok")).toHaveLength(3);
    const skipped = performance.filter((p) => p.status === "unavailable");
    expect(skipped).toHaveLength(3);
    for (const p of skipped) expect(p).toMatchObject({ performanceScore: null, lcpMs: null, error: expect.stringMatching(/monthly PageSpeed test allowance/) });
    const usage = await customerAudits(db, alice, settings).usage(now());
    expect(usage.used.pagespeedThisMonth).toBe(3);
    expect(await db.select().from(saasSchema.operationalEvents).where(eq(saasSchema.operationalEvents.kind, "pagespeed.failure"))).toHaveLength(0);
  });

  it("stores timeouts and Google rate limits as unavailable measurements", async () => {
    const audit = await start(alice, aliceSite);
    const lease = (await claimJob(db, "w1", settings, timing, now()))!;
    let n = 0;
    const flaky = async (url: string, strategy: "mobile" | "desktop"): Promise<PerformanceResult> =>
      ++n === 1 ? { url, strategy, status: "unavailable", errorCode: "timeout", error: "PageSpeed Insights did not respond within 120s.", opportunities: [] }
        : { url, strategy, status: "unavailable", errorCode: "quota", error: "PageSpeed Insights quota exceeded (HTTP 429).", opportunities: [] };
    await executeJob(deps({ pagespeed: flaky }), lease, control());
    expect(await db.select().from(saasSchema.operationalEvents).where(eq(saasSchema.operationalEvents.kind, "pagespeed.failure"))).toHaveLength(n);
    const { performance, checks } = await customerAudits(db, alice, settings).full(audit);
    expect(performance.every((p) => p.status === "unavailable" && p.performanceScore === null)).toBe(true);
    // Google confirmed the quota is gone: remaining tests are skipped, not sent (two run in parallel).
    expect(n).toBeLessThanOrEqual(3);
    expect(performance.filter((p) => p.error?.startsWith("Not tested:")).length).toBe(6 - n);
    expect(checks.filter((c) => c.category === "performance").every((c) => c.status === "unavailable")).toBe(true);
  });

  it("enforces the shared daily PageSpeed budget across accounts atomically", async () => {
    settings = base({ pagespeedPerDay: 4 });
    const a = await start(alice, aliceSite);
    const b = await start(bob, bobSite);
    const reserve = (tenantId: string, auditId: number) => reserveUsage(db, { tenantId, auditId, kind: "pagespeed", settings, now: now() });
    const results = await Promise.allSettled([...Array.from({ length: 4 }, () => reserve(alice.tenantId, a)), ...Array.from({ length: 4 }, () => reserve(bob.tenantId, b))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
  });

  it("re-runs PageSpeed as a fenced job and recomputes only performance results", async () => {
    const audit = await start(alice, aliceSite);
    await executeJob(deps({ pagespeed: async (u, s) => ({ url: u, strategy: s, status: "unavailable", errorCode: "timeout", error: "timeout", opportunities: [] }) }), (await claimJob(db, "w1", settings, timing, now()))!, control());
    const service = customerAudits(db, alice, settings);
    const before = await service.full(audit);
    expect(before.performance.every((p) => p.status === "unavailable")).toBe(true);
    await service.rerunPagespeed(audit, now());
    await expect(service.rerunPagespeed(audit, now())).rejects.toThrow(/Wait for the active audit/);
    expect((await service.status(audit)).pagespeedRerun).toBe("queued");
    const lease = (await claimJob(db, "w1", settings, timing, now()))!;
    expect(lease.kind).toBe("pagespeed");
    expect(await executeJob(deps(), lease, control())).toBe("completed");
    const after = await service.full(audit);
    expect(after.performance.every((p) => p.status === "ok")).toBe(true);
    expect(after.checks.filter((c) => c.category !== "performance").map((c) => c.checkId)).toEqual(before.checks.filter((c) => c.category !== "performance").map((c) => c.checkId));
    expect(after.audit.categoryScores?.performance).not.toBeNull();
    expect((await service.status(audit)).pagespeedRerun).toBeNull();
  });

  it("budgets AI consultant reports per account and reuses the stored report", async () => {
    const audit = await start(alice, aliceSite);
    await executeJob(deps(), (await claimJob(db, "w1", settings, timing, now()))!, control());
    await db.update(saasSchema.tenants).set({ monthlyAiLimit: 1 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    const service = customerAudits(db, alice, settings);
    let calls = 0;
    const generate = async () => { calls++; return { report: "## Summary\nok", model: "test-model" }; };
    expect(await service.consultantReport(audit, generate, { now: now() })).toMatchObject({ cached: false });
    expect(await service.consultantReport(audit, generate, { now: now() })).toMatchObject({ cached: true });
    advance(3 * 60_000);
    await expect(service.consultantReport(audit, generate, { regenerate: true, now: now() })).rejects.toThrow(/monthly AI report allowance/);
    expect(calls).toBe(1);
  });

  it("returns the AI allowance when the provider fails to produce a report", async () => {
    const audit = await start(alice, aliceSite);
    await executeJob(deps(), (await claimJob(db, "w1", settings, timing, now()))!, control());
    await db.update(saasSchema.tenants).set({ monthlyAiLimit: 1 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    const service = customerAudits(db, alice, settings);
    const failing = async (): Promise<{ report: string; model: string }> => { throw new Error("provider unavailable"); };
    await expect(service.consultantReport(audit, failing, { now: now() })).rejects.toThrow(/provider unavailable/);
    expect((await service.usage(now())).used.aiThisMonth).toBe(0);
    const generate = async () => ({ report: "## Summary\nok", model: "test-model" });
    expect(await service.consultantReport(audit, generate, { now: now() })).toMatchObject({ cached: false });
    expect((await service.usage(now())).used.aiThisMonth).toBe(1);
  });

  it("follows server settings unless an administrator override is set", async () => {
    const custom = readLimitSettings({ PHASE2_LIMIT_WEBSITES: "4", PHASE2_LIMIT_PAGES_PER_SCAN: "500", PHASE2_GLOBAL_MAX_RUNNING: "0" });
    expect(custom.tenant.websites).toBe(4);
    expect(custom.tenant.pagesPerScan).toBe(100);
    expect(custom.global.maxRunning).toBe(1);
    await db.update(saasSchema.tenants).set({ monthlyAuditLimit: 9 }).where(eq(saasSchema.tenants.id, alice.tenantId));
    const { limits } = await customerAudits(db, alice, custom).usage();
    expect(limits).toMatchObject({ websites: 4, auditsPerMonth: 9, pagesPerScan: 100 });
  });
});

function backoffWait(attempts: number) {
  return Math.min(timing.backoffMaxMs, timing.backoffBaseMs * 2 ** (attempts - 1));
}
