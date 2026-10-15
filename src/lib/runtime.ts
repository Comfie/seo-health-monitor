import "server-only";
import { getDb } from "@/lib/db";
import { startWorker, stopWorker } from "@/lib/audit/queue";
import { validateRailwayEnvironment } from "@/lib/security/railway";

export function startRuntime(): void {
  validateRailwayEnvironment();
  // Migrate at runtime, after the volume is mounted, before accepting requests.
  getDb();
  startWorker();
  process.once("SIGTERM", stopWorker);
  process.once("SIGINT", stopWorker);
}
