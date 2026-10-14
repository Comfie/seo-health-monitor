import "server-only";
import { and, asc, count, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assertSafeUrl } from "@/lib/crawler/ssrf";
import { normalizeInputUrl, stripWww } from "@/lib/crawler/url";
import { pruneRateLimits } from "@/lib/rate-limit";
import { executeAudit } from "./runner";

/**
 * Database-backed audit queue. Audits are inserted as "queued"; a worker in the
 * server process claims them atomically, keeps a heartbeat while running, and
 * re-queues audits whose worker died (crash/restart) up to MAX_ATTEMPTS.
 * Because results are written in one transaction at the end, a retried audit
 * never leaves partial data behind.
 */

export class AuditBusyError extends Error {}

const MAX_CONCURRENT = 2;
const MAX_QUEUED = 20;
const MAX_ATTEMPTS = 2;
const POLL_MS = 2_000;
const HEARTBEAT_MS = 10_000;
const STALE_MS = 90_000;

interface WorkerState {
  started: boolean;
  running: Set<number>;
  timer?: NodeJS.Timeout;
  ticking: boolean;
}
const state = ((globalThis as unknown as { __auditWorker?: WorkerState }).__auditWorker ??= { started: false, running: new Set(), ticking: false });

export function runningAuditCount(): number {
  return state.running.size;
}

export function isAuditRunningHere(id: number): boolean {
  return state.running.has(id);
}

/** Validates the URL and queues an audit. Throws UrlValidationError/SsrfError/AuditBusyError. */
export function enqueueAudit(inputUrl: string): number {
  const startUrl = normalizeInputUrl(inputUrl);
  assertSafeUrl(startUrl);
  const db = getDb();
  const queued = db.select({ n: count() }).from(schema.audits).where(eq(schema.audits.status, "queued")).get()?.n ?? 0;
  if (queued >= MAX_QUEUED) throw new AuditBusyError(`${queued} audits are already waiting. Try again once some have finished.`);
  const host = stripWww(new URL(startUrl).hostname);
  const site = db.insert(schema.sites).values({ host, displayUrl: startUrl }).onConflictDoUpdate({ target: schema.sites.host, set: { displayUrl: startUrl } }).returning().get();
  const audit = db.insert(schema.audits).values({ siteId: site.id, inputUrl, startUrl, status: "queued", stage: "Queued", progress: 0 }).returning().get();
  startWorker();
  void tick();
  return audit.id;
}

/** Re-queues (or fails) audits whose worker stopped sending heartbeats. */
export function recoverStaleAudits(now = Date.now()): { requeued: number; failed: number } {
  const db = getDb();
  const stale = db
    .select()
    .from(schema.audits)
    .where(and(eq(schema.audits.status, "running"), or(isNull(schema.audits.heartbeatAt), lt(schema.audits.heartbeatAt, new Date(now - STALE_MS)))))
    .all()
    .filter((a) => !state.running.has(a.id));
  let requeued = 0;
  let failed = 0;
  for (const a of stale) {
    if (a.attempts < MAX_ATTEMPTS) {
      db.update(schema.audits).set({ status: "queued", stage: "Re-queued after the server was interrupted", progress: 0 }).where(eq(schema.audits.id, a.id)).run();
      requeued++;
    } else {
      db.update(schema.audits).set({ status: "failed", error: `The audit was interrupted ${a.attempts} times and has been stopped.`, stage: "Failed", completedAt: new Date(now) }).where(eq(schema.audits.id, a.id)).run();
      failed++;
    }
  }
  return { requeued, failed };
}

/** Atomically claims the oldest queued audit, or returns null. */
export function claimNextAudit(): { id: number; startUrl: string } | null {
  const db = getDb();
  return db.transaction((tx) => {
    const next = tx.select({ id: schema.audits.id, startUrl: schema.audits.startUrl, attempts: schema.audits.attempts }).from(schema.audits).where(eq(schema.audits.status, "queued")).orderBy(asc(schema.audits.id)).limit(1).get();
    if (!next) return null;
    const claimed = tx
      .update(schema.audits)
      .set({ status: "running", attempts: next.attempts + 1, startedAt: new Date(), heartbeatAt: new Date(), stage: "Starting" })
      .where(and(eq(schema.audits.id, next.id), eq(schema.audits.status, "queued")))
      .run();
    return claimed.changes === 1 ? { id: next.id, startUrl: next.startUrl } : null;
  });
}

async function run(job: { id: number; startUrl: string }): Promise<void> {
  state.running.add(job.id);
  const db = getDb();
  const beat = setInterval(() => {
    db.update(schema.audits).set({ heartbeatAt: new Date() }).where(and(eq(schema.audits.id, job.id), inArray(schema.audits.status, ["running"]))).run();
  }, HEARTBEAT_MS);
  beat.unref?.();
  try {
    await executeAudit(job.id, job.startUrl);
  } finally {
    clearInterval(beat);
    state.running.delete(job.id);
    void tick();
  }
}

async function tick(): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    recoverStaleAudits();
    while (state.running.size < MAX_CONCURRENT) {
      const job = claimNextAudit();
      if (!job) break;
      void run(job);
    }
  } catch (err) {
    console.error("[audit-worker] tick failed", err);
  } finally {
    state.ticking = false;
  }
}

/** Idempotent; called from instrumentation at server start and lazily on enqueue. */
export function startWorker(): void {
  if (state.started) return;
  state.started = true;
  try {
    pruneRateLimits();
  } catch {
    /* non-critical */
  }
  state.timer = setInterval(() => void tick(), POLL_MS);
  state.timer.unref?.();
  void tick();
}
