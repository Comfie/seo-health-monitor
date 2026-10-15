import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "@/lib/config";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __seoDb?: Db };

function open(): Db {
  const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), config.databasePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(/*turbopackIgnore: true*/ process.cwd(), "drizzle") });
  return db;
}

export function getDb(): Db {
  if (process.env.PHASE2_UNIFIED === "true") throw new Error("Legacy SQLite access is disabled in the unified application.");
  if (!globalForDb.__seoDb) globalForDb.__seoDb = open();
  return globalForDb.__seoDb;
}

export { schema };
