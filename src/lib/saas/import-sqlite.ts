import "server-only";
import fs from "node:fs";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { count, eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { decrypt } from "@/lib/security/crypto";
import type { SaasDb } from "./db";
import * as schema from "./schema";
import { imports } from "./operations-schema";

const tables = [schema.sites, schema.audits, schema.pages, schema.checks, schema.issues, schema.performanceResults, schema.googleAccounts, schema.searchConsoleConnections, schema.searchSnapshots] as const;

/** Import only an immutable, verified SQLite backup into an EMPTY staging domain.
 * Every insert and count comparison is in one PostgreSQL transaction. Source is
 * read-only, ciphertext is copied byte-for-byte, IDs are retained, and identity
 * sequences are advanced after validation. Never runs on application startup.
 */
export async function importSqliteBackup(db: SaasDb, backupPath: string, tenantId: string, administratorId: string) {
  if (fs.existsSync(`${backupPath}-wal`) && fs.statSync(`${backupPath}-wal`).size > 0) throw new Error("Use a standalone SQLite backup without pending WAL data.");
  const checksum = () => createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
  const sourceSha256 = checksum();
  const source = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    source.exec("BEGIN");
    const foreignKeyViolations = source.pragma("foreign_key_check") as unknown[];
    if (source.pragma("integrity_check", { simple: true }) !== "ok" || foreignKeyViolations.length) throw new Error("Source backup integrity verification failed.");
    const active = source.prepare("SELECT count(*) n FROM audits WHERE status IN ('queued', 'running')").get() as { n: number };
    if (active.n) throw new Error("Drain legacy audits before taking the migration backup.");
    const rowsByTable = new Map<PgTable, Record<string, unknown>[]>();
    for (const table of tables) rowsByTable.set(table, source.prepare(`SELECT * FROM "${getTableName(table)}" ORDER BY id`).all() as Record<string, unknown>[]);
    const googleRows = rowsByTable.get(schema.googleAccounts)!;
    if (rowsByTable.get(schema.searchConsoleConnections)!.length && googleRows.length !== 1) throw new Error("Legacy Google connection mapping is ambiguous; resolve explicitly before importing.");
    for (const row of googleRows) {
      if (typeof row.encrypted_refresh_token !== "string" || !decrypt(row.encrypted_refresh_token, "google-refresh-token")) throw new Error("Legacy Google token cannot be decrypted; verify the original APP_SECRET.");
    }
    const result = await db.transaction(async (tx) => {
      // Lock the destination owner while importing. There is no overwrite/upsert path.
      const [owner] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).for("update");
      const [admin] = await tx.select().from(schema.administrators).where(eq(schema.administrators.userId, administratorId));
      if (!owner || owner.personalUserId !== administratorId || !admin) throw new Error("Import requires the initial administrator's personal account.");
      if ((await tx.select().from(imports)).length) throw new Error("A SQLite import already exists.");
      for (const table of tables) {
        const [existing] = await tx.select({ n: count() }).from(table);
        if (existing.n) throw new Error("Destination domain tables must be empty.");
      }
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const columns = getTableColumns(table);
        const name = getTableName(table);
        for (const sourceRow of rowsByTable.get(table)!) {
          const mapped = Object.values(columns).map((column) => {
            let value = sourceRow[column.name];
            if (column.name === "tenant_id") value = tenantId;
            else if (name === "google_accounts" && column.name === "user_id") value = administratorId;
            else if (name === "search_console_connections" && column.name === "google_account_id") value = googleRows[0]?.id;
            else if (column.name === "display_name") value = sourceRow.host;
            if (value === undefined) throw new Error(`Source column missing: ${name}.${column.name}`);
            // SQLite stores timestamps as Unix milliseconds and JSON as text.
            if (value !== null && column.dataType === "date") value = new Date(Number(value)).toISOString();
            if (value !== null && column.dataType === "json") value = JSON.stringify(JSON.parse(String(value)));
            return { column: column.name, value };
          });
          await tx.execute(sql`insert into ${sql.identifier(name)} (${sql.join(mapped.map((m) => sql.identifier(m.column)), sql`, `)}) values (${sql.join(mapped.map((m) => sql`${m.value}`), sql`, `)})`);
        }
        const [imported] = await tx.select({ n: count() }).from(table);
        if (imported.n !== rowsByTable.get(table)!.length) throw new Error(`Record count mismatch: ${name}`);
        counts[name] = imported.n;
        // Whitelisted schema names only. setval(false) lets an empty table start at 1.
        await tx.execute(sql`select setval(pg_get_serial_sequence(${name}, 'id'), coalesce((select max(id) from ${sql.identifier(name)}), 1), (select count(*) > 0 from ${sql.identifier(name)}))`);
      }
      if (checksum() !== sourceSha256) throw new Error("Source backup changed during import.");
      await tx.insert(imports).values({ sourceSha256, tenantId, counts });
      return { sourceSha256, counts };
    });
    return result;
  } finally { source.close(); }
}
