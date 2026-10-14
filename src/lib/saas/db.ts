import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as domain from "./schema";
import * as operations from "./operations-schema";

export const saasSchema = { ...domain, ...operations };
export type SaasDb = PgDatabase<PgQueryResultHKT, typeof saasSchema>;

// Explicit dependency injection: importing this module never opens a connection,
// runs a migration, starts a worker or falls back to the production SQLite file.
export function createSaasDb(connectionString: string) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("PostgreSQL URL required.");
  // Server-enforced bounds. A process that freezes mid-transaction (VM pause, GC, partition) would
  // otherwise hold row and advisory locks indefinitely and stall every claim and admission: its
  // session is ended after 15 s idle in a transaction, waiters give up after 10 s and retry, and
  // no statement runs longer than 60 s. Verified on hosted PostgreSQL with a SIGSTOPped worker.
  const pool = new Pool({
    connectionString, max: 5, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000,
    options: "-c idle_in_transaction_session_timeout=15000 -c lock_timeout=10000 -c statement_timeout=60000",
  });
  // A session ended by the server (timeouts above, restarts, failover) must not crash the process.
  // Checked-out clients emit "error" outside any query, which is fatal without a listener (seen
  // on staging with a SIGSTOPped worker); the in-flight operation still fails and is handled by
  // its caller, and the pool discards the connection. Driver errors can contain credentials or
  // SQL parameters, so only the code is logged.
  const report = (error: Error & { code?: string }) => console.error(`[beta-db] connection closed by the server (${error.code ?? "unknown"})`);
  pool.on("error", report);
  pool.on("connect", (client) => client.on("error", report));
  return drizzle(pool, { schema: saasSchema });
}
