/** Starts the background audit worker once per Node server (never during builds). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startRuntime } = await import("@/lib/runtime");
  startRuntime();
  // Customer beta worker: only when explicitly enabled (never in the current production configuration).
  if (process.env.PHASE2_ENABLED === "true" && process.env.PHASE2_WORKER === "in-process") {
    const { startBetaWorker } = await import("@/lib/saas/worker-runtime");
    await startBetaWorker();
  }
}
