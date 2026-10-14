import path from "node:path";

/** Fail closed on Railway; builds have no mounted volume and do not call this. */
export function validateRailwayEnvironment(env: Record<string, string | undefined> = process.env): void {
  if (!env.RAILWAY_ENVIRONMENT_ID) return;
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH;
  const file = env.DATABASE_PATH;
  if (!mount || !file || !path.isAbsolute(file)) throw new Error("Railway requires a volume and an absolute DATABASE_PATH.");
  const relative = path.relative(mount, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("DATABASE_PATH must be a file inside the Railway volume.");
  }
  if (env.AUTH_DISABLED === "true" || !env.AUTH_PASSWORD || env.AUTH_PASSWORD.length < 12 || (env.APP_SECRET?.trim().length ?? 0) < 32) {
    throw new Error("Railway private deployment requires AUTH_PASSWORD (12+) and APP_SECRET (32+), with authentication enabled.");
  }
  let url: URL;
  try { url = new URL(env.APP_URL ?? ""); } catch { throw new Error("APP_URL must be a public HTTPS origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("APP_URL must be a public HTTPS origin.");
  }
}
