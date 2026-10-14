import { readBetaConfig } from "@/lib/saas/config";
import { createSaasDb } from "@/lib/saas/db";
import { readLimitSettings } from "@/lib/saas/limits";
import { createWorker } from "@/lib/saas/worker";

/**
 * Standalone beta audit worker (e.g. a separate Railway service). Any number of these can
 * run against one PostgreSQL database: claims, leases and limits are enforced there.
 * Usage: npm run worker:beta   (reads the same PHASE2_* variables as the web service)
 */
const read = readBetaConfig();
if (read.state !== "ready") {
  console.error(read.state === "disabled" ? "PHASE2_ENABLED is not true; the worker will not start." : `Beta misconfigured: ${read.problem}`);
  process.exit(1);
}
if (read.config.databaseUrl.startsWith("pglite:")) {
  console.error("A separate worker process needs PostgreSQL; local PGlite only supports PHASE2_WORKER=in-process.");
  process.exit(1);
}
const db = createSaasDb(read.config.databaseUrl);
const concurrency = Number.parseInt(process.env.PHASE2_WORKER_CONCURRENCY ?? "1", 10);
const worker = createWorker({ db, settings: readLimitSettings(), concurrency: Number.isFinite(concurrency) ? Math.min(4, Math.max(1, concurrency)) : 1 });
worker.start();
console.log(`[beta-worker] ${worker.workerId} started`);

// The worker's own timers are unref'd (so it never holds a web server open). A standalone
// process must stay alive on its own: otherwise, while PostgreSQL is unreachable and no socket
// is open, Node exits with code 0 and an on-failure restart policy never brings it back.
// The interval doubles as a liveness line for the platform's logs.
const keepAlive = setInterval(() => console.log(`[beta-worker] ${worker.workerId} alive, running=${worker.active().length}`), 60_000);

// Railway sends SIGTERM and kills after RAILWAY_DEPLOYMENT_DRAINING_SECONDS. Hand jobs back
// within that window; if this times out, lease expiry recovers them on another worker.
const STOP_TIMEOUT_MS = 20_000;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  const timeout = new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS).unref());
  await Promise.race([worker.stop(), timeout]);
  await Promise.race([(db as unknown as { $client: { end: () => Promise<void> } }).$client.end(), timeout]);
  console.log(`[beta-worker] ${worker.workerId} stopped`);
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
