import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, sql, sum } from "drizzle-orm";
import type { SaasDb } from "./db";
import { jobs, usageRecords } from "./operations-schema";
import { tenants } from "./tenancy-schema";

/**
 * Free-beta resource controls (not commercial plans). Defaults come from server-side
 * settings; a tenant column that is not NULL is an administrator override, still clamped
 * to the hard bounds below so no override can disable the protections entirely.
 */
export type BetaLimits = {
  websites: number;
  auditsPerMonth: number;
  pagesPerScan: number;
  concurrentScans: number;
  pagespeedPerMonth: number;
  aiPerMonth: number;
};

export type GlobalLimits = {
  /** Jobs running at once across every account and worker process. */
  maxRunning: number;
  /** Queued jobs across every account; admission is refused beyond this. */
  maxQueued: number;
  /** PageSpeed tests per UTC day across all accounts (protects the shared Google API key). */
  pagespeedPerDay: number;
  /** AI consultant calls per UTC day across all accounts. */
  aiPerDay: number;
  /** PageSpeed sample: URLs tested per audit (each URL is tested on mobile and desktop). */
  pagespeedPagesPerAudit: number;
};

export type LimitSettings = { tenant: BetaLimits; global: GlobalLimits };

const BOUNDS: Record<keyof BetaLimits, [number, number]> = {
  websites: [0, 100],
  auditsPerMonth: [0, 1000],
  pagesPerScan: [1, 100],
  concurrentScans: [1, 10],
  pagespeedPerMonth: [0, 10_000],
  aiPerMonth: [0, 1000],
};

const clamp = (value: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, Math.trunc(value)));

function intSetting(env: Env, name: string, fallback: number, bounds: [number, number]) {
  const parsed = Number.parseInt(env[name]?.trim() ?? "", 10);
  return clamp(Number.isFinite(parsed) ? parsed : fallback, bounds);
}

type Env = Record<string, string | undefined>;

export function readLimitSettings(env: Env = process.env): LimitSettings {
  return {
    tenant: {
      websites: intSetting(env, "PHASE2_LIMIT_WEBSITES", 2, BOUNDS.websites),
      auditsPerMonth: intSetting(env, "PHASE2_LIMIT_AUDITS_PER_MONTH", 5, BOUNDS.auditsPerMonth),
      pagesPerScan: intSetting(env, "PHASE2_LIMIT_PAGES_PER_SCAN", 25, BOUNDS.pagesPerScan),
      concurrentScans: intSetting(env, "PHASE2_LIMIT_CONCURRENT_SCANS", 1, BOUNDS.concurrentScans),
      pagespeedPerMonth: intSetting(env, "PHASE2_LIMIT_PAGESPEED_PER_MONTH", 60, BOUNDS.pagespeedPerMonth),
      aiPerMonth: intSetting(env, "PHASE2_LIMIT_AI_PER_MONTH", 5, BOUNDS.aiPerMonth),
    },
    global: {
      maxRunning: intSetting(env, "PHASE2_GLOBAL_MAX_RUNNING", 2, [1, 20]),
      maxQueued: intSetting(env, "PHASE2_GLOBAL_MAX_QUEUED", 50, [1, 1000]),
      pagespeedPerDay: intSetting(env, "PHASE2_GLOBAL_PAGESPEED_PER_DAY", 400, [0, 25_000]),
      aiPerDay: intSetting(env, "PHASE2_GLOBAL_AI_PER_DAY", 50, [0, 5000]),
      pagespeedPagesPerAudit: intSetting(env, "PHASE2_PAGESPEED_PAGES_PER_AUDIT", 3, [0, 10]),
    },
  };
}

type TenantRow = typeof tenants.$inferSelect;

export function effectiveLimits(tenant: TenantRow, settings: LimitSettings): BetaLimits {
  const pick = (override: number | null, key: keyof BetaLimits) => clamp(override ?? settings.tenant[key], BOUNDS[key]);
  return {
    websites: pick(tenant.websiteLimit, "websites"),
    auditsPerMonth: pick(tenant.monthlyAuditLimit, "auditsPerMonth"),
    pagesPerScan: pick(tenant.pageLimit, "pagesPerScan"),
    concurrentScans: pick(tenant.concurrentAuditLimit, "concurrentScans"),
    pagespeedPerMonth: pick(tenant.monthlyPagespeedLimit, "pagespeedPerMonth"),
    aiPerMonth: pick(tenant.monthlyAiLimit, "aiPerMonth"),
  };
}

export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

type Tx = Parameters<Parameters<SaasDb["transaction"]>[0]>[0];
export type UsageKind = "audit" | "pagespeed" | "ai";

// Fixed advisory-lock keys: global admission and global provider budgets are serialised
// across every application and worker process sharing the database.
export const LOCK_GLOBAL_QUEUE = 724_301;
const LOCK_BUDGET: Record<UsageKind, number> = { audit: 724_302, pagespeed: 724_303, ai: 724_304 };

export async function advisoryLock(tx: Tx, key: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(${key})`);
}

export async function usedUnits(tx: Tx | SaasDb, where: { tenantId?: string; kind: UsageKind; since: Date }) {
  const [row] = await tx.select({ n: sum(usageRecords.units) }).from(usageRecords).where(and(
    where.tenantId ? eq(usageRecords.tenantId, where.tenantId) : undefined,
    eq(usageRecords.kind, where.kind),
    gte(usageRecords.createdAt, where.since),
  ));
  return Number(row?.n ?? 0);
}

export class BudgetExhaustedError extends Error {}

/**
 * Atomically reserves provider usage for one tenant: the tenant row lock serialises the
 * account, the advisory lock serialises the global daily budget, and the ledger insert
 * happens in the same transaction as both checks. Parallel requests cannot overspend.
 */
export async function reserveUsage(db: SaasDb, input: { tenantId: string; auditId: number; kind: "pagespeed" | "ai"; units?: number; settings: LimitSettings; now?: Date }) {
  const now = input.now ?? new Date();
  const units = input.units ?? 1;
  return db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(and(eq(tenants.id, input.tenantId), eq(tenants.status, "active"))).for("update");
    if (!tenant) throw new BudgetExhaustedError("This account is not active.");
    const limits = effectiveLimits(tenant, input.settings);
    const monthly = input.kind === "pagespeed" ? limits.pagespeedPerMonth : limits.aiPerMonth;
    const daily = input.kind === "pagespeed" ? input.settings.global.pagespeedPerDay : input.settings.global.aiPerDay;
    const label = input.kind === "pagespeed" ? "PageSpeed test" : "AI report";
    if ((await usedUnits(tx, { tenantId: tenant.id, kind: input.kind, since: monthStart(now) })) + units > monthly) {
      throw new BudgetExhaustedError(`This account's monthly ${label} allowance (${monthly}) has been used.`);
    }
    await advisoryLock(tx, LOCK_BUDGET[input.kind]);
    if ((await usedUnits(tx, { kind: input.kind, since: dayStart(now) })) + units > daily) {
      throw new BudgetExhaustedError(`The beta's shared daily ${label} budget has been used. Try again tomorrow.`);
    }
    const id = randomUUID();
    await tx.insert(usageRecords).values({ id, tenantId: tenant.id, auditId: input.auditId, kind: input.kind, units, createdAt: now });
    return id;
  });
}

/** Returns one reservation (by its ledger ID) to both the account and the global budget. */
export async function releaseUsage(db: SaasDb, tenantId: string, reservationId: string) {
  await db.delete(usageRecords).where(and(eq(usageRecords.tenantId, tenantId), eq(usageRecords.id, reservationId)));
}

/** Counts that the dashboard shows next to each limit. */
export async function usageSummary(db: SaasDb, tenantId: string, now = new Date()) {
  const since = monthStart(now);
  const [audits, pagespeed, ai, [active]] = await Promise.all([
    usedUnits(db, { tenantId, kind: "audit", since }),
    usedUnits(db, { tenantId, kind: "pagespeed", since }),
    usedUnits(db, { tenantId, kind: "ai", since }),
    db.select({ n: count() }).from(jobs).where(and(eq(jobs.tenantId, tenantId), inArray(jobs.state, ["queued", "running"]))),
  ]);
  return { auditsThisMonth: audits, pagespeedThisMonth: pagespeed, aiThisMonth: ai, activeJobs: active.n };
}
