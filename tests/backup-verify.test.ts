import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

// Never touches ./data: every database here is a throwaway file in a temp directory.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shm-backup-verify-"));
process.env.DATABASE_PATH = path.join(tmp, "unused.db");
process.env.APP_SECRET = "backup-verify-secret-backup-verify-1234";

const { encrypt } = await import("@/lib/security/crypto");
const { verifySqliteBackup } = await import("../scripts/verify-sqlite-backup");

const refreshToken = "1//refresh-token-plaintext-never-printed";
function makeBackup(name: string, tokens: string[]) {
  const file = path.join(tmp, name);
  const db = new Database(file);
  db.exec(`
    create table __drizzle_migrations (id integer primary key, hash text, created_at numeric);
    create table sites (id integer primary key, url text not null);
    create table google_accounts (id integer primary key autoincrement, email text, encrypted_refresh_token text not null, scopes text not null, connected_at integer not null, last_error text);
    insert into __drizzle_migrations (hash, created_at) values ('a', 1), ('b', 2);
    insert into sites (url) values ('https://example.com');
  `);
  const insert = db.prepare("insert into google_accounts (email, encrypted_refresh_token, scopes, connected_at) values (?, ?, 'scope', 1)");
  for (const token of tokens) insert.run("owner@example.com", token);
  db.close();
  return file;
}

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("verifySqliteBackup", () => {
  it("reports integrity, row counts, migrations and token decryptability without revealing data", () => {
    const file = makeBackup("good.db", [encrypt(refreshToken, "google-refresh-token")]);
    const report = verifySqliteBackup(file);
    expect(report).toMatchObject({
      integrity: "ok",
      foreignKeyViolations: 0,
      migrations: 2,
      tables: { __drizzle_migrations: 2, sites: 1, google_accounts: 1 },
      googleTokens: { total: 1, decryptable: 1 },
    });
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
    const printed = JSON.stringify(report);
    expect(printed).not.toContain(refreshToken);
    expect(printed).not.toContain("owner@example.com");
    expect(printed).not.toContain(process.env.APP_SECRET);
  });

  it("counts tokens that do not decrypt with the supplied secret", () => {
    const file = makeBackup("foreign.db", [encrypt(refreshToken, "google-refresh-token"), "not-a-valid-ciphertext-at-all-xxxxxxxxxxxxxxxx"]);
    expect(verifySqliteBackup(file).googleTokens).toEqual({ total: 2, decryptable: 1 });
  });

  it("opens the backup read-only and leaves it byte-identical", () => {
    const file = makeBackup("readonly.db", []);
    const before = fs.readFileSync(file);
    verifySqliteBackup(file);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});
