/** Starts the background audit worker once per server process (not during builds). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorker } = await import("@/lib/audit/queue");
  startWorker();
}
