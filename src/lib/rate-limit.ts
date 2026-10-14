import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

/**
 * Fixed-window counter stored in SQLite, so limits survive restarts and are
 * shared by every process using the same database file. The read-modify-write
 * runs in one transaction (SQLite serialises writers).
 */
export function hitRateLimit(key: string, max: number, windowMs: number, now = Date.now()): RateLimitResult {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(schema.rateLimits).where(sql`${schema.rateLimits.key} = ${key}`).get();
    const fresh = !row || now - row.windowStart >= windowMs;
    const windowStart = fresh ? now : row.windowStart;
    const count = fresh ? 0 : row.count;
    if (count >= max) return { allowed: false, retryAfterMs: windowStart + windowMs - now, remaining: 0 };
    tx.insert(schema.rateLimits)
      .values({ key, windowStart, count: count + 1 })
      .onConflictDoUpdate({ target: schema.rateLimits.key, set: { windowStart, count: count + 1 } })
      .run();
    return { allowed: true, retryAfterMs: 0, remaining: max - count - 1 };
  });
}

/** Checks a per-client limit and a global limit together; both must allow. */
export function checkLimits(clientKey: string, scope: string, perClient: { max: number; windowMs: number }, global: { max: number; windowMs: number }): RateLimitResult {
  const client = hitRateLimit(`${scope}:client:${clientKey}`, perClient.max, perClient.windowMs);
  if (!client.allowed) return client;
  return hitRateLimit(`${scope}:global`, global.max, global.windowMs);
}

/**
 * Client identity for rate limiting. X-Forwarded-For is attacker-controlled
 * unless set by our own proxies, so it is only used when TRUST_PROXY gives the
 * number of trusted proxy hops; we then take the address added by the outermost
 * trusted proxy (counting from the right). Without it, every client shares one
 * bucket and the global limit still applies.
 */
export function clientKey(headers: Headers, trustedHops = Number.parseInt(process.env.TRUST_PROXY ?? "0", 10) || 0): string {
  if (trustedHops <= 0) return "untrusted-proxy";
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chain.length) return "unknown";
  return chain[Math.max(0, chain.length - trustedHops)];
}

/** Removes expired counters; called opportunistically by the worker. */
export function pruneRateLimits(olderThanMs = 24 * 60 * 60_000): void {
  getDb().delete(schema.rateLimits).where(sql`${schema.rateLimits.windowStart} < ${Date.now() - olderThanMs}`).run();
}
