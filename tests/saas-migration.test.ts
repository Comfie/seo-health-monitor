import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { migrate as sqliteMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it } from "vitest";
import { saasSchema } from "@/lib/saas/db";
import { bootstrapAdministrator } from "@/lib/saas/bootstrap";
import { importSqliteBackup } from "@/lib/saas/import-sqlite";
import { encrypt } from "@/lib/security/crypto";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "seo-saas-import-"));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

async function fixture(invalidJson = false) {
  process.env.APP_SECRET = "migration-fixture-encryption-key-32-characters";
  const file = path.join(directory, `${randomUUID()}.db`);
  const sqlite = new Database(file);
  sqliteMigrate(sqliteDrizzle(sqlite), { migrationsFolder: "drizzle" });
  sqlite.prepare("INSERT INTO sites (id, host, display_url) VALUES (4, 'example.com', 'https://example.com/')").run();
  sqlite.prepare("INSERT INTO audits (id, site_id, input_url, start_url, status, overall_score, meta) VALUES (7, 4, 'https://example.com/', 'https://example.com/', 'completed', 76.5, ?)").run(invalidJson ? "broken" : '{"preserved":true}');
  sqlite.prepare("INSERT INTO pages (audit_id, url, final_url, depth, source, data) VALUES (7, 'https://example.com/', 'https://example.com/', 0, 'crawl', '{\"title\":\"Preserved\"}')").run();
  const token = encrypt("synthetic-refresh-token-not-a-real-grant", "google-refresh-token");
  sqlite.prepare("INSERT INTO google_accounts (id, encrypted_refresh_token, scopes, connected_at) VALUES (3, ?, 'read-only', ?)").run(token, Date.now());
  sqlite.prepare("INSERT INTO search_console_connections (site_id, property, status, scopes) VALUES (4, 'sc-domain:example.com', 'connected', 'read-only')").run();
  sqlite.close();
  const client = new PGlite();
  const db = drizzle(client, { schema: saasSchema });
  await migrate(db, { migrationsFolder: "drizzle-saas" });
  const userId = randomUUID();
  const tenantId = randomUUID();
  const email = `${randomUUID()}@example.com`;
  await db.insert(saasSchema.user).values({ id: userId, email, emailVerified: true, name: "Operator fixture" });
  await db.insert(saasSchema.tenants).values({ id: tenantId, name: "Operator fixture", personalUserId: userId });
  await db.insert(saasSchema.memberships).values({ tenantId, userId, role: "owner" });
  await bootstrapAdministrator(db, email);
  return { file, db, client, userId, tenantId, token, email };
}

describe("non-destructive SQLite to PostgreSQL rehearsal", () => {
  it("preserves records, relationships, JSON, scores, IDs, timestamps and ciphertext", async () => {
    const f = await fixture();
    try {
      const digest = () => createHash("sha256").update(fs.readFileSync(f.file)).digest("hex");
      const before = digest();
      const result = await importSqliteBackup(f.db, f.file, f.tenantId, f.userId);
      expect(result.sourceSha256).toBe(before);
      expect(result.counts).toMatchObject({ sites: 1, audits: 1, pages: 1, google_accounts: 1, search_console_connections: 1 });
      const [audit] = await f.db.select().from(saasSchema.audits);
      expect(audit).toMatchObject({ id: 7, siteId: 4, tenantId: f.tenantId, overallScore: 76.5, meta: { preserved: true } });
      expect(audit.createdAt).toBeInstanceOf(Date);
      const [google] = await f.db.select().from(saasSchema.googleAccounts);
      expect(google.encryptedRefreshToken).toBe(f.token);
      expect(google.userId).toBe(f.userId);
      const [connection] = await f.db.select().from(saasSchema.searchConsoleConnections);
      expect(connection).toMatchObject({ tenantId: f.tenantId, googleAccountId: google.id, siteId: 4 });
      const [next] = await f.db.insert(saasSchema.sites).values({ tenantId: f.tenantId, host: "iana.org", displayUrl: "https://iana.org" }).returning();
      expect(next.id).toBeGreaterThan(4);
      expect(digest()).toBe(before);
      await expect(importSqliteBackup(f.db, f.file, f.tenantId, f.userId)).rejects.toThrow("already exists");
      await expect(bootstrapAdministrator(f.db, f.email)).rejects.toThrow("already been provisioned");
    } finally { await f.client.close(); }
  }, 30_000);

  it("rolls back all imported rows when validation fails midway", async () => {
    const f = await fixture(true);
    try {
      await expect(importSqliteBackup(f.db, f.file, f.tenantId, f.userId)).rejects.toThrow();
      expect(await f.db.select().from(saasSchema.sites)).toHaveLength(0);
      expect(await f.db.select().from(saasSchema.audits)).toHaveLength(0);
      expect(await f.db.select().from(saasSchema.imports)).toHaveLength(0);
      const unchanged = new Database(f.file, { readonly: true });
      try { expect(unchanged.prepare("SELECT COUNT(*) n FROM sites").get()).toEqual({ n: 1 }); }
      finally { unchanged.close(); }
    } finally { await f.client.close(); }
  }, 30_000);

  it("refuses the wrong token key, active legacy audits and an unverified administrator", async () => {
    const f = await fixture();
    try {
      process.env.APP_SECRET = randomUUID();
      await expect(importSqliteBackup(f.db, f.file, f.tenantId, f.userId)).rejects.toThrow("cannot be decrypted");
      process.env.APP_SECRET = "migration-fixture-encryption-key-32-characters";
      const sqlite = new Database(f.file);
      sqlite.prepare("UPDATE audits SET status = 'running'").run();
      sqlite.close();
      await expect(importSqliteBackup(f.db, f.file, f.tenantId, f.userId)).rejects.toThrow("Drain legacy audits");
      expect(await f.db.select().from(saasSchema.sites)).toHaveLength(0);
      await f.db.delete(saasSchema.administrators);
      await f.db.update(saasSchema.user).set({ emailVerified: false });
      await expect(bootstrapAdministrator(f.db, f.email)).rejects.toThrow("email-verified user");
    } finally { await f.client.close(); }
  }, 30_000);
});
