import { randomUUID } from "node:crypto";
import { recordHeartbeat, logOperationalEvent } from "@/lib/saas/telemetry";
const webId = `web-${randomUUID()}`;
import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { betaJson, getBeta, notFound } from "@/lib/saas/server";

/**
 * Readiness probe for the hosted beta (Railway health check path): the beta is configured and
 * its PostgreSQL database answers. Reveals no data or error detail; 404 while the beta is off.
 */
export async function GET() {
  await connection();
  const beta = await getBeta();
  if (beta.state === "disabled") return notFound();
  if (beta.state !== "ready") return betaJson(503, { ok: false });
  try {
    await beta.runtime.db.execute(sql`select 1`);
    await recordHeartbeat(beta.runtime.db, webId, "web").catch(() => {});
    return betaJson(200, { ok: true });
  } catch {
    logOperationalEvent("database.failure");
    return betaJson(503, { ok: false });
  }
}
