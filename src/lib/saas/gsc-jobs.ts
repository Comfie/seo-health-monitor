import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, lte } from "drizzle-orm";
import type { SaasDb } from "./db";
import { DEFAULT_TIMING, LeaseLostError, backoffMs, type QueueTiming } from "./jobs";
import * as schema from "./schema";

/**
 * Search Console refresh queue (`search_console_jobs`). Separate from the audit queue so audit
 * claims and limits are untouched, but with the same protocol: a claim bumps the fence and
 * issues a new lease token, and every write is conditional on both while the job is running.
 * The tenant and website come from the job row only.
 */
export type RefreshLease = Readonly<{
  jobId: string;
  tenantId: string;
  siteId: number;
  fence: number;
  leaseToken: string;
  workerId: string;
  attempts: number;
  maxAttempts: number;
}>;

type Tx = Parameters<Parameters<SaasDb["transaction"]>[0]>[0];
const jobs = schema.searchConsoleJobs;
const after = (now: Date, ms: number) => new Date(now.getTime() + ms);

const fenced = (lease: RefreshLease) => and(
  eq(jobs.id, lease.jobId),
  eq(jobs.tenantId, lease.tenantId),
  eq(jobs.fence, lease.fence),
  eq(jobs.leaseToken, lease.leaseToken),
  eq(jobs.state, "running"),
);

/** Queues a refresh unless one is already queued or running for this website (partial unique index). */
export async function enqueueRefresh(db: SaasDb | Tx, input: { tenantId: string; siteId: number; requestedBy: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  const rows = await db.insert(jobs).values({ id: randomUUID(), tenantId: input.tenantId, siteId: input.siteId, requestedBy: input.requestedBy, availableAt: now, createdAt: now })
    .onConflictDoNothing().returning({ id: jobs.id });
  return rows.length ? "queued" : "already-active";
}

/** Claims the oldest runnable refresh of an active tenant. SKIP LOCKED lets workers claim in parallel. */
export async function claimRefresh(db: SaasDb, workerId: string, timing: QueueTiming = DEFAULT_TIMING, now = new Date()): Promise<RefreshLease | null> {
  return db.transaction(async (tx) => {
    const [next] = await tx.select({ job: jobs }).from(jobs)
      .innerJoin(schema.tenants, eq(schema.tenants.id, jobs.tenantId))
      .where(and(eq(jobs.state, "queued"), lte(jobs.availableAt, now), eq(schema.tenants.status, "active")))
      .orderBy(asc(jobs.availableAt), asc(jobs.createdAt)).limit(1)
      .for("update", { of: jobs, skipLocked: true });
    if (!next) return null;
    const { job } = next;
    const leaseToken = randomUUID();
    const [claimed] = await tx.update(jobs).set({
      state: "running", attempts: job.attempts + 1, fence: job.fence + 1, leaseToken, lockedBy: workerId, leaseExpiresAt: after(now, timing.leaseMs),
    }).where(and(eq(jobs.id, job.id), eq(jobs.state, "queued"), eq(jobs.fence, job.fence))).returning();
    if (!claimed) return null;
    return Object.freeze({
      jobId: claimed.id, tenantId: claimed.tenantId, siteId: claimed.siteId, fence: claimed.fence, leaseToken, workerId,
      attempts: claimed.attempts, maxAttempts: claimed.maxAttempts,
    });
  });
}

async function lockLease(tx: Tx, lease: RefreshLease) {
  const [job] = await tx.select().from(jobs).where(fenced(lease)).for("update");
  if (!job) throw new LeaseLostError();
  return job;
}

/** Runs `write` in one transaction holding this lease (and an active tenant), then completes the job. */
export async function completeRefresh(db: SaasDb, lease: RefreshLease, write: (tx: Tx) => Promise<void>, now = new Date()) {
  return db.transaction(async (tx) => {
    const job = await lockLease(tx, lease);
    const [tenant] = await tx.select({ status: schema.tenants.status }).from(schema.tenants).where(eq(schema.tenants.id, lease.tenantId));
    if (tenant?.status !== "active") throw new LeaseLostError();
    await write(tx);
    await tx.update(jobs).set({ state: "completed", finishedAt: now, leaseToken: null, leaseExpiresAt: null, lastError: null }).where(eq(jobs.id, job.id));
  });
}

/**
 * Records a failure under the lease: transient failures (quota, Google outage) are retried with
 * backoff until `max_attempts`; `onRecorded` runs in the same transaction only if the lease is current.
 */
export async function failRefresh(
  db: SaasDb, lease: RefreshLease, failure: { message: string; retryable: boolean }, timing: QueueTiming = DEFAULT_TIMING, now = new Date(),
  onRecorded?: (tx: Tx, final: boolean) => Promise<void>,
): Promise<"retry" | "failed" | "stale"> {
  return db.transaction(async (tx) => {
    let job;
    try {
      job = await lockLease(tx, lease);
    } catch (error) {
      if (error instanceof LeaseLostError) return "stale";
      throw error;
    }
    const message = failure.message.slice(0, 300);
    const retry = failure.retryable && job.attempts < job.maxAttempts;
    if (retry) {
      await tx.update(jobs).set({ state: "queued", availableAt: after(now, backoffMs(job.attempts, timing)), leaseToken: null, lockedBy: null, leaseExpiresAt: null, lastError: message }).where(eq(jobs.id, job.id));
    } else {
      await tx.update(jobs).set({ state: "failed", finishedAt: now, leaseToken: null, leaseExpiresAt: null, lastError: message }).where(eq(jobs.id, job.id));
    }
    await onRecorded?.(tx, !retry);
    return retry ? "retry" : "failed";
  });
}

/** Graceful shutdown: hand the refresh back without using an attempt. */
export async function releaseRefresh(db: SaasDb, lease: RefreshLease, now = new Date()) {
  const rows = await db.update(jobs).set({ state: "queued", attempts: Math.max(0, lease.attempts - 1), availableAt: now, leaseToken: null, lockedBy: null, leaseExpiresAt: null })
    .where(fenced(lease)).returning({ id: jobs.id });
  return rows.length === 1;
}

/** Requeues (or fails) refreshes whose worker died. Safe to run from every worker. */
export async function recoverExpiredRefreshes(db: SaasDb, timing: QueueTiming = DEFAULT_TIMING, now = new Date()) {
  return db.transaction(async (tx) => {
    const expired = await tx.select().from(jobs).where(and(eq(jobs.state, "running"), lt(jobs.leaseExpiresAt, now))).for("update", { skipLocked: true });
    for (const job of expired) {
      if (job.attempts < job.maxAttempts) {
        await tx.update(jobs).set({ state: "queued", availableAt: after(now, backoffMs(job.attempts, timing)), leaseToken: null, lockedBy: null, leaseExpiresAt: null, lastError: "The worker stopped responding before finishing." }).where(eq(jobs.id, job.id));
      } else {
        await tx.update(jobs).set({ state: "failed", finishedAt: now, leaseToken: null, leaseExpiresAt: null, lastError: "The refresh was interrupted repeatedly and has been stopped." }).where(eq(jobs.id, job.id));
      }
    }
    return expired.length;
  });
}

/** Latest refresh job for one website of one tenant (customer status view). */
export async function latestRefresh(db: SaasDb, tenantId: string, siteId: number) {
  const [job] = await db.select({ state: jobs.state, lastError: jobs.lastError, createdAt: jobs.createdAt, finishedAt: jobs.finishedAt }).from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.siteId, siteId))).orderBy(desc(jobs.createdAt)).limit(1);
  return job ?? null;
}

/** Removes queued (not running) refreshes, e.g. after unlinking or disconnecting. */
export async function dropQueuedRefreshes(db: SaasDb | Tx, tenantId: string, siteId?: number) {
  await db.delete(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.state, "queued"), siteId === undefined ? undefined : eq(jobs.siteId, siteId)));
}

export const ACTIVE_REFRESH_STATES = ["queued", "running"] as const;
export const isActiveRefresh = (state: string | null | undefined) => !!state && (ACTIVE_REFRESH_STATES as readonly string[]).includes(state);
