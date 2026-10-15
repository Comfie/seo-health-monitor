import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { createSaasAuth, type SaasAuth } from "./auth";
import { readBetaConfig, type BetaConfig } from "./config";
import { createSaasDb, saasSchema, type SaasDb } from "./db";
import { createMailer, type Mailer } from "./email";
import type { LimitSettings } from "./limits";
import { administrators, rateLimit } from "./schema";
import { AccessDeniedError, requireTenant, type TenantContext } from "./tenant";

/** `limits` defaults to the server-side settings read from the environment (src/lib/saas/limits.ts). */
export type BetaRuntime = { config: BetaConfig; db: SaasDb; auth: SaasAuth; mail: Mailer; limits?: LimitSettings };
export type BetaState = { state: "disabled" } | { state: "misconfigured"; problem: string } | { state: "ready"; runtime: BetaRuntime };

const globalRef = globalThis as typeof globalThis & { __shmBeta?: { key: string; runtime: Promise<BetaRuntime> }; __shmBetaOverride?: BetaRuntime | null };

/** Local development only: an on-disk PGlite database, migrated on first use. */
async function openPglite(url: string): Promise<SaasDb> {
  // Variable specifiers keep the dev-only engine out of the production bundle and trace.
  const engine = "@electric-sql/pglite";
  const driver = "drizzle-orm/pglite";
  const migrator = "drizzle-orm/pglite/migrator";
  const { PGlite } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ engine);
  const { drizzle } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ driver);
  const { migrate } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ migrator);
  const db = drizzle(new PGlite(url.replace(/^pglite:\/\//, "")), { schema: saasSchema }) as SaasDb;
  await migrate(db, { migrationsFolder: "drizzle-saas" });
  return db;
}

async function build(config: BetaConfig): Promise<BetaRuntime> {
  // PostgreSQL schemas are applied by the explicit staging command, never at request time.
  const db = config.databaseUrl.startsWith("pglite:") ? await openPglite(config.databaseUrl) : createSaasDb(config.databaseUrl);
  const mail = createMailer(config.email);
  const auth = createSaasAuth({
    db,
    origin: config.origin,
    secret: config.authSecret,
    registration: config.registration,
    trustedIpHeader: config.trustedIpHeader,
    sendMail: (m) => mail({ to: m.to, url: m.url, purpose: m.purpose }),
  });
  return { config, db, auth, mail };
}

/** Lazily builds one runtime per configuration; importing this module opens nothing. */
export async function getBeta(): Promise<BetaState> {
  if (globalRef.__shmBetaOverride !== undefined) {
    return globalRef.__shmBetaOverride ? { state: "ready", runtime: globalRef.__shmBetaOverride } : { state: "disabled" };
  }
  const read = readBetaConfig();
  if (read.state !== "ready") return read;
  const key = JSON.stringify(read.config);
  if (globalRef.__shmBeta?.key !== key) globalRef.__shmBeta = { key, runtime: build(read.config) };
  try {
    return { state: "ready", runtime: await globalRef.__shmBeta.runtime };
  } catch {
    globalRef.__shmBeta = undefined;
    return { state: "misconfigured", problem: "The beta database is unavailable." };
  }
}

/** Test seam: inject an isolated runtime (or null for disabled). */
export function setBetaRuntimeForTests(runtime: BetaRuntime | null | undefined) {
  globalRef.__shmBetaOverride = runtime;
}

export async function isAdministrator(db: SaasDb, userId: string) {
  const [row] = await db.select({ userId: administrators.userId }).from(administrators).where(eq(administrators.userId, userId)).limit(1);
  return !!row;
}

/**
 * Request time only: a GET handler must never be prerendered with a build-time answer, and the
 * database is never opened during a build. (The test seam calls handlers outside Next.js.)
 */
export async function atRequestTime() {
  if (globalRef.__shmBetaOverride === undefined) await connection();
}

const json = (status: number, body: unknown, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
export const notFound = () => json(404, { error: "Not found." });
export const denied = () => json(404, { error: "Resource unavailable." });
export { json as betaJson };

/**
 * Shared entry for every /api/beta route: feature gate, canonical-origin CSRF check on
 * mutations, then the tenant derived from the library session (never from the request).
 */
export async function withCustomer(request: Request, handler: (ctx: { runtime: BetaRuntime; tenant: TenantContext }) => Promise<Response>, options: { admin?: boolean } = {}) {
  await atRequestTime();
  const beta = await getBeta();
  if (beta.state === "disabled") return notFound();
  if (beta.state === "misconfigured") return json(503, { error: "The beta is not available." });
  const { runtime } = beta;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") !== runtime.config.origin) {
    return json(403, { error: "Cross-origin request blocked." });
  }
  let tenant: TenantContext;
  try {
    tenant = await requireTenant(runtime.db, runtime.auth, request.headers);
  } catch (error) {
    if (error instanceof AccessDeniedError) return json(401, { error: "Sign in required." });
    throw error;
  }
  // Non-administrators get the same 404 as a missing route: no admin surface is advertised.
  if (options.admin && !(await isAdministrator(runtime.db, tenant.userId))) return notFound();
  try {
    return await handler({ runtime, tenant });
  } catch (error) {
    if (error instanceof AccessDeniedError) return denied();
    throw error;
  }
}

/** PostgreSQL fixed-window limiter for beta routes outside the auth library (shared across instances). */
export async function hitBetaLimit(db: SaasDb, key: string, max: number, windowMs: number, now = Date.now()) {
  const [row] = await db.insert(rateLimit).values({ id: randomUUID(), key: `beta:${key}`, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.lastRequest} < ${now - windowMs} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${rateLimit.lastRequest} < ${now - windowMs} then ${now} else ${rateLimit.lastRequest} end`,
      },
    }).returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest });
  return { allowed: row.count <= max, retryAfterSeconds: Math.max(1, Math.ceil((row.lastRequest + windowMs - now) / 1000)) };
}
