import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, lte, lt, sql } from "drizzle-orm";
import type { SaasDb } from "./db";
import { LOCK_GLOBAL_QUEUE, advisoryLock, effectiveLimits, type LimitSettings } from "./limits";
import { activity, jobs, usageRecords, type JobPayload } from "./operations-schema";
import * as schema from "./schema";

/**
 * Distributed job queue over `background_jobs`. Correctness does not depend on clocks:
 * a claim bumps the fencing token and issues a new lease token, and every worker write
 * is conditional on both, so a paused or partitioned worker cannot write after its lease
 * has been recovered or re-claimed. Clocks only decide *when* a lease is considered dead.
 */

export type JobKind = "audit" | "pagespeed";
export type Lease = Readonly<{
  jobId: string;
  /** Copied from the job row at claim time; the only tenant identity a worker may use. */
  tenantId: string;
  auditId: number;
  kind: JobKind;
  fence: number;
  leaseToken: string;
  workerId: string;
  attempts: number;
  maxAttempts: number;
  payload: JobPayload;
}>;

export type QueueTiming = { leaseMs: number; backoffBaseMs: number; backoffMaxMs: number };
export const DEFAULT_TIMING: QueueTiming = { leaseMs: 120_000, backoffBaseMs: 30_000, backoffMaxMs: 15 * 60_000 };

export class LeaseLostError extends Error {
  constructor() { super("The job lease was lost to another worker or expired."); }
}
export class JobCancelledError extends Error {
  constructor() { super("The audit was cancelled."); }
}

type Tx = Parameters<Parameters<SaasDb["transaction"]>[0]>[0];

export const backoffMs = (attempts: number, timing: QueueTiming) => Math.min(timing.backoffMaxMs, timing.backoffBaseMs * 2 ** Math.max(0, attempts - 1));
const after = (now: Date, ms: number) => new Date(now.getTime() + ms);
const logLine = (now: Date, message: string) => `${now.toISOString().slice(11, 19)} ${message.slice(0, 300)}`;

/** The fencing predicate: this exact claim of this job, still running. */
const fenced = (lease: Lease) => and(
  eq(jobs.id, lease.jobId),
  eq(jobs.tenantId, lease.tenantId),
  eq(jobs.fence, lease.fence),
  eq(jobs.leaseToken, lease.leaseToken),
  eq(jobs.state, "running"),
);
const auditOf = (tenantId: string, auditId: number) => and(eq(schema.audits.tenantId, tenantId), eq(schema.audits.id, auditId));

/** Locks this lease's job row inside `tx`, or throws if the lease is no longer current. */
async function lockLease(tx: Tx, lease: Lease) {
  const [job] = await tx.select().from(jobs).where(fenced(lease)).for("update");
  if (!job) throw new LeaseLostError();
  return job;
}

/**
 * Atomically claims the oldest runnable job, honouring the global running limit and each
 * tenant's concurrency limit. Serialised by an advisory lock, so two workers (in any
 * process) can never claim the same job or exceed the global limit together.
 */
export async function claimJob(db: SaasDb, workerId: string, settings: LimitSettings, timing: QueueTiming = DEFAULT_TIMING, now = new Date()): Promise<Lease | null> {
  return db.transaction(async (tx) => {
    await advisoryLock(tx, LOCK_GLOBAL_QUEUE);
    const running = await tx.select({ tenantId: jobs.tenantId, n: count() }).from(jobs).where(eq(jobs.state, "running")).groupBy(jobs.tenantId);
    const total = running.reduce((sum, r) => sum + r.n, 0);
    if (total >= settings.global.maxRunning) return null;
    const perTenant = new Map(running.map((r) => [r.tenantId, r.n]));
    const candidates = await tx.select({ job: jobs, tenant: schema.tenants }).from(jobs)
      .innerJoin(schema.tenants, eq(schema.tenants.id, jobs.tenantId))
      .where(and(eq(jobs.state, "queued"), lte(jobs.availableAt, now), eq(schema.tenants.status, "active")))
      .orderBy(asc(jobs.availableAt), asc(jobs.createdAt)).limit(50);
    const next = candidates.find((c) => (perTenant.get(c.job.tenantId) ?? 0) < effectiveLimits(c.tenant, settings).concurrentScans);
    if (!next) return null;
    const { job } = next;
    const leaseToken = randomUUID();
    const [claimed] = await tx.update(jobs).set({
      state: "running",
      attempts: job.attempts + 1,
      fence: job.fence + 1,
      leaseToken,
      lockedBy: workerId,
      leaseExpiresAt: after(now, timing.leaseMs),
      heartbeatAt: now,
      startedAt: job.startedAt ?? now,
    }).where(and(eq(jobs.id, job.id), eq(jobs.state, "queued"), eq(jobs.fence, job.fence))).returning();
    if (!claimed) return null;
    if (job.kind === "audit") {
      await tx.update(schema.audits).set({ status: "running", stage: "Starting", progress: 0, attempts: claimed.attempts, heartbeatAt: now, startedAt: now, error: null })
        .where(auditOf(job.tenantId, job.auditId));
    }
    return Object.freeze({
      jobId: claimed.id, tenantId: claimed.tenantId, auditId: claimed.auditId, kind: claimed.kind, fence: claimed.fence,
      leaseToken, workerId, attempts: claimed.attempts, maxAttempts: claimed.maxAttempts, payload: claimed.payload,
    });
  });
}

/** Extends the lease. Returns null when the lease is gone (the worker must stop). */
export async function heartbeat(db: SaasDb, lease: Lease, timing: QueueTiming = DEFAULT_TIMING, now = new Date()) {
  const [row] = await db.update(jobs).set({ heartbeatAt: now, leaseExpiresAt: after(now, timing.leaseMs) }).where(fenced(lease)).returning({ cancelRequestedAt: jobs.cancelRequestedAt });
  if (!row) return null;
  if (lease.kind === "audit") await db.update(schema.audits).set({ heartbeatAt: now }).where(auditOf(lease.tenantId, lease.auditId));
  return { cancelRequested: row.cancelRequestedAt !== null };
}

/** Fenced progress write. Returns false when the lease is gone. The log keeps the last 200 lines. */
export async function reportProgress(db: SaasDb, lease: Lease, percent: number, message: string, now = new Date()) {
  if (lease.kind !== "audit") return (await heartbeatProbe(db, lease));
  const line = JSON.stringify([logLine(now, message)]);
  const rows = await db.update(schema.audits).set({
    progress: Math.min(99, Math.max(0, Math.round(percent))),
    stage: message.slice(0, 300),
    log: sql`(case when jsonb_array_length(${schema.audits.log}) >= 200 then ${schema.audits.log} - 0 else ${schema.audits.log} end) || ${line}::jsonb`,
  }).where(and(
    auditOf(lease.tenantId, lease.auditId),
    sql`exists (select 1 from ${jobs} where ${fenced(lease)})`,
  )).returning({ id: schema.audits.id });
  return rows.length === 1;
}

async function heartbeatProbe(db: SaasDb, lease: Lease) {
  const [row] = await db.select({ id: jobs.id }).from(jobs).where(fenced(lease));
  return !!row;
}

/** Runs `write` in one transaction that holds this lease's job row, then marks the job completed. */
export async function completeJob(db: SaasDb, lease: Lease, write: (tx: Tx, job: typeof jobs.$inferSelect) => Promise<void>, now = new Date()) {
  return db.transaction(async (tx) => {
    const job = await lockLease(tx, lease);
    if (job.cancelRequestedAt) throw new JobCancelledError();
    const [tenant] = await tx.select({ status: schema.tenants.status }).from(schema.tenants).where(eq(schema.tenants.id, lease.tenantId));
    if (tenant?.status !== "active") throw new LeaseLostError();
    await write(tx, job);
    await tx.update(jobs).set({ state: "completed", finishedAt: now, leaseToken: null, leaseExpiresAt: null, lastError: null }).where(eq(jobs.id, job.id));
  });
}

export type FailOutcome = "retry" | "failed" | "cancelled" | "stale";

/**
 * Records a failure for this lease: retries transient failures with exponential backoff
 * until `max_attempts`, otherwise fails the job. A stale lease changes nothing.
 * `message` is shown to the customer, so it must not contain internal details.
 */
export async function failJob(db: SaasDb, lease: Lease, failure: { message: string; retryable: boolean }, timing: QueueTiming = DEFAULT_TIMING, now = new Date()): Promise<FailOutcome> {
  return db.transaction(async (tx) => {
    let job;
    try {
      job = await lockLease(tx, lease);
    } catch (error) {
      if (error instanceof LeaseLostError) return "stale";
      throw error;
    }
    if (job.cancelRequestedAt) {
      await markCancelled(tx, job, now);
      return "cancelled";
    }
    const message = failure.message.slice(0, 500);
    if (failure.retryable && job.attempts < job.maxAttempts) {
      const wait = backoffMs(job.attempts, timing);
      await tx.update(jobs).set({ state: "queued", availableAt: after(now, wait), leaseToken: null, lockedBy: null, leaseExpiresAt: null, lastError: message }).where(eq(jobs.id, job.id));
      if (job.kind === "audit") {
        await tx.update(schema.audits).set({ status: "queued", stage: `Retrying in ${Math.round(wait / 1000)}s (attempt ${job.attempts + 1} of ${job.maxAttempts})`, progress: 0 }).where(auditOf(job.tenantId, job.auditId));
      }
      return "retry";
    }
    await tx.update(jobs).set({ state: "failed", finishedAt: now, leaseToken: null, leaseExpiresAt: null, lastError: message }).where(eq(jobs.id, job.id));
    if (job.kind === "audit") {
      await tx.update(schema.audits).set({ status: "failed", stage: "Failed", error: message, completedAt: now }).where(auditOf(job.tenantId, job.auditId));
    }
    await tx.insert(activity).values({ id: randomUUID(), tenantId: job.tenantId, actorId: null, action: job.kind === "audit" ? "audit.failed" : "pagespeed.failed", metadata: { auditId: job.auditId } });
    return "failed";
  });
}

async function markCancelled(tx: Tx, job: typeof jobs.$inferSelect, now: Date) {
  await tx.update(jobs).set({ state: "cancelled", finishedAt: now, leaseToken: null, leaseExpiresAt: null }).where(eq(jobs.id, job.id));
  if (job.kind === "audit") {
    await tx.update(schema.audits).set({ status: "cancelled", stage: "Cancelled", completedAt: now }).where(auditOf(job.tenantId, job.auditId));
  }
}

/** The worker saw a cancellation request: finalise it under the lease. */
export async function finalizeCancelled(db: SaasDb, lease: Lease, now = new Date()) {
  return db.transaction(async (tx) => {
    try {
      await markCancelled(tx, await lockLease(tx, lease), now);
      return true;
    } catch (error) {
      if (error instanceof LeaseLostError) return false;
      throw error;
    }
  });
}

/** Graceful shutdown: hand the job back without consuming an attempt. */
export async function releaseJob(db: SaasDb, lease: Lease, now = new Date()) {
  return db.transaction(async (tx) => {
    let job;
    try {
      job = await lockLease(tx, lease);
    } catch (error) {
      if (error instanceof LeaseLostError) return false;
      throw error;
    }
    await tx.update(jobs).set({ state: "queued", attempts: Math.max(0, job.attempts - 1), availableAt: now, leaseToken: null, lockedBy: null, leaseExpiresAt: null }).where(eq(jobs.id, job.id));
    if (job.kind === "audit") await tx.update(schema.audits).set({ status: "queued", stage: "Waiting for a worker (the previous one shut down)", progress: 0 }).where(auditOf(job.tenantId, job.auditId));
    return true;
  });
}

/**
 * Requeues (or fails) running jobs whose lease expired because the worker crashed, was
 * killed or lost its database connection. Safe to run from every worker concurrently.
 */
export async function recoverExpiredJobs(db: SaasDb, timing: QueueTiming = DEFAULT_TIMING, now = new Date()) {
  return db.transaction(async (tx) => {
    await advisoryLock(tx, LOCK_GLOBAL_QUEUE);
    const expired = await tx.select().from(jobs).where(and(eq(jobs.state, "running"), lt(jobs.leaseExpiresAt, now))).for("update");
    const result = { requeued: 0, failed: 0, cancelled: 0 };
    for (const job of expired) {
      if (job.cancelRequestedAt) {
        await markCancelled(tx, job, now);
        result.cancelled++;
      } else if (job.attempts < job.maxAttempts) {
        await tx.update(jobs).set({ state: "queued", availableAt: after(now, backoffMs(job.attempts, timing)), leaseToken: null, lockedBy: null, leaseExpiresAt: null, lastError: "The worker stopped responding before finishing." }).where(eq(jobs.id, job.id));
        if (job.kind === "audit") await tx.update(schema.audits).set({ status: "queued", stage: "Re-queued after an interruption", progress: 0 }).where(auditOf(job.tenantId, job.auditId));
        result.requeued++;
      } else {
        const message = `The audit was interrupted ${job.attempts} times and has been stopped.`;
        await tx.update(jobs).set({ state: "failed", finishedAt: now, leaseToken: null, leaseExpiresAt: null, lastError: message }).where(eq(jobs.id, job.id));
        if (job.kind === "audit") await tx.update(schema.audits).set({ status: "failed", stage: "Failed", error: message, completedAt: now }).where(auditOf(job.tenantId, job.auditId));
        result.failed++;
      }
    }
    return result;
  });
}

export type CancelOutcome = "cancelled" | "cancelling" | "not-active";

/**
 * Customer cancellation. A queued audit is cancelled immediately and, if it never started,
 * its monthly audit allowance is returned. A running audit is flagged; its worker stops at
 * the next checkpoint (or recovery cancels it if the worker died).
 */
export async function requestCancel(db: SaasDb, tenantId: string, auditId: number, now = new Date()): Promise<CancelOutcome> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.auditId, auditId), eq(jobs.kind, "audit"), inArray(jobs.state, ["queued", "running"]))).for("update");
    if (!job) return "not-active";
    if (job.state === "queued") {
      await markCancelled(tx, job, now);
      if (job.attempts === 0) await tx.delete(usageRecords).where(and(eq(usageRecords.tenantId, tenantId), eq(usageRecords.auditId, auditId), eq(usageRecords.kind, "audit")));
      return "cancelled";
    }
    if (!job.cancelRequestedAt) {
      await tx.update(jobs).set({ cancelRequestedAt: now }).where(eq(jobs.id, job.id));
      await tx.update(schema.audits).set({ stage: "Cancelling…" }).where(auditOf(tenantId, auditId));
    }
    return "cancelling";
  });
}
