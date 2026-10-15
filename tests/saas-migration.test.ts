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
import { decrypt, encrypt } from "@/lib/security/crypto";
import {captureUnifiedOwner,seedUnifiedOwner} from '@/lib/saas/unified-owner';

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
  it('copies only the verified administrator identity and password hash into an empty destination',async()=>{
    const f=await fixture();const target=new PGlite();const targetDb=drizzle(target,{schema:saasSchema});
    try{
      await migrate(targetDb,{migrationsFolder:'drizzle-saas'});
      await f.db.insert(saasSchema.account).values({id:'owner-credential',accountId:f.userId,providerId:'credential',userId:f.userId,password:'private-existing-hash'});
      await f.db.insert(saasSchema.user).values({id:'disposable-test-user',email:'disposable@example.com',emailVerified:true,name:'Do not copy'});
      const owner=await captureUnifiedOwner(f.db,f.email);
      await expect(seedUnifiedOwner(targetDb,owner,'wrong@example.com')).rejects.toThrow('confirmation');
      await seedUnifiedOwner(targetDb,owner,f.email);
      expect((await targetDb.select().from(saasSchema.user)).map(u=>u.id)).toEqual([f.userId]);
      expect((await targetDb.select().from(saasSchema.account))[0].password).toBe('private-existing-hash');
      expect(await targetDb.select().from(saasSchema.session)).toHaveLength(0);
      expect(await targetDb.select().from(saasSchema.invitations)).toHaveLength(0);
      await expect(seedUnifiedOwner(targetDb,owner,f.email)).rejects.toThrow('empty');
      await expect(captureUnifiedOwner(f.db,'disposable@example.com')).rejects.toThrow();
    }finally{await f.client.close();await target.close();}
  },30_000);
  it('re-encrypts an existing production grant for the verified owner without making Google requests', async()=>{
    const f=await fixture();const secret=randomUUID()+randomUUID();
    try{
      await importSqliteBackup(f.db,f.file,f.tenantId,f.userId,{googleTokenSecret:secret});
      const [g]=await f.db.select().from(saasSchema.googleAccounts);
      expect(g.encryptedRefreshToken).not.toBe(f.token);
      expect(decrypt(g.encryptedRefreshToken,`beta-google-refresh-token:${f.tenantId}`,secret)).toBe(decrypt(f.token,'google-refresh-token'));
      expect(decrypt(g.encryptedRefreshToken,'beta-google-refresh-token:foreign-tenant',secret)).toBeNull();
      expect(g.status).toBe('active');expect(g.googleSubject).toBeNull();
      const [c]=await f.db.select().from(saasSchema.searchConsoleConnections);expect(c.googleAccountId).toBe(g.id);
    }finally{await f.client.close();}
  },30_000);
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

describe("G5 migration 0003 on a populated G4 database", () => {
  it("is additive: existing tenants, sites, audits, jobs and Google rows survive unchanged", async () => {
    // Apply 0000-0002 only (the current staging state), add G4-style rows, then apply 0003.
    const g4 = path.join(directory, `g4-${randomUUID()}`);
    fs.mkdirSync(path.join(g4, "meta"), { recursive: true });
    const journal = JSON.parse(fs.readFileSync("drizzle-saas/meta/_journal.json", "utf8"));
    const before = { ...journal, entries: journal.entries.filter((e: { tag: string }) => e.tag < "0003") };
    for (const e of before.entries) fs.copyFileSync(`drizzle-saas/${e.tag}.sql`, path.join(g4, `${e.tag}.sql`));
    fs.writeFileSync(path.join(g4, "meta/_journal.json"), JSON.stringify(before));
    const client = new PGlite();
    const db = drizzle(client, { schema: saasSchema });
    await migrate(db, { migrationsFolder: g4 });
    await client.exec(`
      insert into auth_user (id, name, email, email_verified, created_at, updated_at) values ('u1', 'A', 'a@example.com', true, now(), now());
      insert into tenants (id, name, personal_user_id) values ('t1', 'A', 'u1');
      insert into memberships (tenant_id, user_id, role) values ('t1', 'u1', 'owner');
      insert into sites (id, tenant_id, host, display_url) values (5, 't1', 'example.com', 'https://example.com/');
      insert into audits (id, tenant_id, site_id, input_url, start_url, status, overall_score) values (9, 't1', 5, 'https://example.com/', 'https://example.com/', 'completed', 81);
      insert into background_jobs (id, tenant_id, audit_id, state, attempts, fence) values ('j1', 't1', 9, 'completed', 1, 1);
      insert into usage_records (id, tenant_id, audit_id, kind) values ('r1', 't1', 9, 'audit');
      insert into google_accounts (tenant_id, user_id, email, encrypted_refresh_token, scopes, connected_at) values ('t1', 'u1', 'g@example.com', 'ciphertext', 'read-only', now());
    `);
    const snapshot = async () => {
      const out: Record<string, unknown> = {};
      for (const t of ["tenants", "memberships", "sites", "audits", "background_jobs", "usage_records"]) out[t] = (await client.query(`select * from ${t} order by 1`)).rows;
      out.google = (await client.query("select id, tenant_id, user_id, email, encrypted_refresh_token, scopes from google_accounts")).rows;
      return out;
    };
    const rowsBefore = await snapshot();
    const g5 = { ...journal, entries: journal.entries.filter((e: { tag: string }) => e.tag < "0004") };
    fs.copyFileSync("drizzle-saas/0003_g5_search_console.sql", path.join(g4, "0003_g5_search_console.sql"));
    fs.writeFileSync(path.join(g4, "meta/_journal.json"), JSON.stringify(g5));
    await migrate(db, { migrationsFolder: g4 });
    expect(await snapshot()).toEqual(rowsBefore);
    const [google] = (await client.query<{ status: string; google_subject: string | null }>("select status, google_subject from google_accounts")).rows;
    expect(google).toEqual({ status: "active", google_subject: null });
    const tables = (await client.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_schema = 'public'")).rows[0].n;
    expect(tables).toBe(24);
    // The migration file contains no destructive statements.
    expect(fs.readFileSync("drizzle-saas/0003_g5_search_console.sql", "utf8")).not.toMatch(/\b(drop|truncate|rename|alter column)\b|(^|;|breakpoint>)\s*(delete|update)\b/im);
    await client.close();
  });
});
