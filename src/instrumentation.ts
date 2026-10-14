/** Starts the background audit worker once per Node server (never during builds). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startRuntime } = await import("@/lib/runtime");
  startRuntime();
}
