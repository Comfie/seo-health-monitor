import "server-only";
import { readLimitSettings } from "./limits";
import { getBeta } from "./server";
import { createWorker } from "./worker";

const globalRef = globalThis as typeof globalThis & { __shmBetaWorker?: ReturnType<typeof createWorker> };

/**
 * Opt-in in-process audit worker (PHASE2_ENABLED=true and PHASE2_WORKER=in-process).
 * Off by default: production sets neither, so nothing starts there.
 */
export async function startBetaWorker() {
  if (process.env.PHASE2_ENABLED !== "true" || process.env.PHASE2_WORKER !== "in-process" || globalRef.__shmBetaWorker) return;
  const beta = await getBeta();
  if (beta.state !== "ready") {
    console.error("[beta-worker] not started: the beta is not configured.");
    return;
  }
  const concurrency = Number.parseInt(process.env.PHASE2_WORKER_CONCURRENCY ?? "1", 10);
  const worker = createWorker({ db: beta.runtime.db, settings: beta.runtime.limits ?? readLimitSettings(), concurrency: Number.isFinite(concurrency) ? Math.min(4, Math.max(1, concurrency)) : 1 });
  globalRef.__shmBetaWorker = worker;
  worker.start();
  const stop = () => void worker.stop();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
