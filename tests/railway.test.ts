import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { validateRailwayEnvironment } from "@/lib/security/railway";
import { encrypt, decrypt } from "@/lib/security/crypto";
import { exchangeCode } from "@/lib/integrations/search-console/google";
const require = createRequire(import.meta.url);
const { snapshot } = require("../scripts/sqlite-backup.cjs") as { snapshot: (a: string, b: string) => Promise<void> };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seo-railway-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("Railway configuration", () => {
  const env = { RAILWAY_ENVIRONMENT_ID: "test", RAILWAY_VOLUME_MOUNT_PATH: "/data", DATABASE_PATH: "/data/seo-health.db", APP_URL: "https://seo.up.railway.app", APP_SECRET: "s".repeat(32), AUTH_PASSWORD: "p".repeat(12) };
  it("accepts the private volume-backed deployment", () => expect(() => validateRailwayEnvironment(env)).not.toThrow());
  it("rejects ephemeral paths, missing mounts, public auth and insecure URLs", () => {
    for (const over of [{ DATABASE_PATH: "./data/x.db" }, { DATABASE_PATH: "/data-other/x.db" }, { DATABASE_PATH: "/data/../tmp/x.db" }, { RAILWAY_VOLUME_MOUNT_PATH: "" }, { AUTH_DISABLED: "true" }, { APP_SECRET: "short" }, { APP_URL: "http://localhost:3000" }]) {
      expect(() => validateRailwayEnvironment({ ...env, ...over })).toThrow();
    }
  });
  it("does not impose Railway requirements on local runs", () => expect(() => validateRailwayEnvironment({})).not.toThrow());
});

it("backs up uncheckpointed WAL data, restores encrypted tokens and queued jobs in a new process, and refuses overwrite", async () => {
  const file = path.join(tmp, "live.db");
  const backup = path.join(tmp, "backup.db");
  const restored = path.join(tmp, "restore.db");
  const db = new Database(file);
  const oldSecret = process.env.APP_SECRET;
  process.env.APP_SECRET = "test-backup-secret-".repeat(3);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    db.exec("create table jobs (id integer primary key, status text, token text)");
    db.prepare("insert into jobs values (1, ?, ?)").run("queued", encrypt("test-refresh-token", "google-refresh-token"));
    expect(fs.existsSync(`${file}-wal`)).toBe(true);
    expect(fs.existsSync(`${file}-shm`)).toBe(true);
    await snapshot(file, backup);
    db.prepare("insert into jobs values (2, 'queued', '')").run();
    await snapshot(backup, restored);
    const reopened = new Database(restored, { readonly: true });
    const row = reopened.prepare("select * from jobs").get() as { status: string; token: string };
    expect(row.status).toBe("queued");
    expect(decrypt(row.token, "google-refresh-token")).toBe("test-refresh-token");
    reopened.close();
    expect(fs.readFileSync(backup).includes(Buffer.from("test-refresh-token"))).toBe(false);
    expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
    await expect(snapshot(backup, file)).rejects.toThrow();
    expect(db.prepare("select count(*) n from jobs").get()).toEqual({ n: 2 });
    db.close();
    const output = execFileSync(process.execPath, ["-e", "const D=require('better-sqlite3');const d=new D(process.argv[1]);console.log(d.prepare('select count(*) n from jobs').get().n);d.close()", file], { cwd: process.cwd() }).toString().trim();
    expect(output).toBe("2");
    await expect(snapshot(path.join(tmp, "missing.db"), path.join(tmp, "no.db"))).rejects.toThrow();
  } finally {
    if (db.open) db.close();
    if (oldSecret === undefined) delete process.env.APP_SECRET; else process.env.APP_SECRET = oldSecret;
  }
});

it("does not expose provider response credentials in OAuth errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "PRIVATE_REFRESH_TOKEN" }), { status: 400 })));
  try {
    await expect(exchangeCode({ clientId: "test", clientSecret: "test", redirectUri: "https://seo.up.railway.app/api/integrations/google/callback" }, "code", "verifier")).rejects.toThrow("revoked");
  } finally { vi.unstubAllGlobals(); }
});
