import "server-only";
import { randomUUID } from "node:crypto";
import { executeJob, type RunnerDeps, type RunOutcome } from "./audit-runner";
import { claimJob, DEFAULT_TIMING, heartbeat, JobCancelledError, LeaseLostError, recoverExpiredJobs, releaseJob, type Lease, type QueueTiming } from "./jobs";

export type WorkerOptions = RunnerDeps & {
  workerId?: string;
  /** Jobs this process runs at once; the database-wide limit is separate (PHASE2_GLOBAL_MAX_RUNNING). */
  concurrency?: number;
  pollMs?: number;
  heartbeatMs?: number;
  /** Hard limit per job; a job still running after this is aborted and retried (default 20 minutes). */
  deadlineMs?: number;
  onOutcome?: (lease: Lease, outcome: RunOutcome) => void;
};

/**
 * One worker process. Any number may run against the same database: claims, global and
 * per-account limits are enforced in PostgreSQL, and fencing makes stale workers harmless.
 */
export function createWorker(options: WorkerOptions) {
  const timing: QueueTiming = options.timing ?? DEFAULT_TIMING;
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const running = new Map<string, { lease: Lease; controller: AbortController; done: Promise<RunOutcome> }>();
  let timer: NodeJS.Timeout | undefined;
  let ticking = false;
  let stopping = false;
  const now = () => options.now?.() ?? new Date();

  function run(lease: Lease) {
    const controller = new AbortController();
    const abort = (reason: Error) => { if (!controller.signal.aborted) controller.abort(reason); };
    const beat = setInterval(() => {
      heartbeat(options.db, lease, timing, now()).then((state) => {
        if (!state) abort(new LeaseLostError());
        else if (state.cancelRequested) abort(new JobCancelledError());
      }).catch(() => { /* transient: the lease outlives several missed beats */ });
    }, options.heartbeatMs ?? Math.max(1_000, Math.floor(timing.leaseMs / 6)));
    beat.unref?.();
    const deadline = setTimeout(() => abort(new Error("The audit took too long and was stopped.")), options.deadlineMs ?? 20 * 60_000);
    deadline.unref?.();
    const done = executeJob({ ...options, timing }, lease, { signal: controller.signal, abort }).finally(() => {
      clearInterval(beat);
      clearTimeout(deadline);
      running.delete(lease.jobId);
      if (!stopping) void tick();
    });
    done.then((outcome) => options.onOutcome?.(lease, outcome), () => {});
    running.set(lease.jobId, { lease, controller, done });
    return done;
  }

  async function tick() {
    if (ticking || stopping) return;
    ticking = true;
    try {
      await recoverExpiredJobs(options.db, timing, now());
      while (!stopping && running.size < concurrency) {
        const lease = await claimJob(options.db, workerId, options.settings, timing, now());
        if (!lease) break;
        void run(lease);
      }
    } catch {
      console.error(`[beta-worker] ${workerId} poll failed; retrying`);
    } finally {
      ticking = false;
    }
  }

  return {
    workerId,
    tick,
    /** In-flight job promises (tests await these). */
    active: () => [...running.values()].map((r) => r.done),
    start() {
      if (timer || stopping) return;
      timer = setInterval(() => void tick(), options.pollMs ?? 2_000);
      timer.unref?.();
      void tick();
    },
    /**
     * Graceful stop: no new claims; running jobs are aborted and handed back without
     * using an attempt. If the process dies first, lease expiry recovers them instead.
     */
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      const current = [...running.values()];
      for (const r of current) r.controller.abort(new LeaseLostError());
      await Promise.allSettled(current.map((r) => r.done));
      await Promise.allSettled(current.map((r) => releaseJob(options.db, r.lease, now())));
    },
  };
}
