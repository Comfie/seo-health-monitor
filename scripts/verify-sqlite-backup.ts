// Read-only verification of a Phase 1 SQLite backup (or of an independent restore of it).
// Prints a JSON report: SHA-256, integrity, foreign-key violations, migrations, per-table row
// counts and how many stored Google refresh tokens decrypt with the APP_SECRET in the
// environment. Never prints row contents, email addresses, tokens or the secret.
//
// Usage: APP_SECRET=… npx tsx scripts/verify-sqlite-backup.ts BACKUP.db [RESTORED.db]
// With two files, also checks that their table counts and token results match.
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { decrypt, hasAppSecret } from "../src/lib/security/crypto";

export type BackupReport = {
  sha256: string;
  integrity: string;
  foreignKeyViolations: number;
  migrations: number | null;
  tables: Record<string, number>;
  googleTokens: { total: number; decryptable: number | null };
};

export function verifySqliteBackup(file: string): BackupReport {
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(db.pragma("integrity_check", { simple: true }));
    const foreignKeyViolations = (db.pragma("foreign_key_check") as unknown[]).length;
    const names = (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((r) => r.name);
    const tables: Record<string, number> = {};
    for (const name of names) tables[name] = (db.prepare(`select count(*) as n from "${name.replaceAll('"', '""')}"`).get() as { n: number }).n;
    const migrations = names.includes("__drizzle_migrations") ? tables.__drizzle_migrations : null;
    let googleTokens: BackupReport["googleTokens"] = { total: 0, decryptable: null };
    if (names.includes("google_accounts")) {
      const rows = db.prepare("select encrypted_refresh_token as t from google_accounts").all() as { t: unknown }[];
      googleTokens = {
        total: rows.length,
        decryptable: hasAppSecret() ? rows.filter((r) => typeof r.t === "string" && decrypt(r.t, "google-refresh-token") !== null).length : null,
      };
    }
    return { sha256, integrity, foreignKeyViolations, migrations, tables, googleTokens };
  } finally {
    db.close();
  }
}

function main() {
  const files = process.argv.slice(2);
  if (files.length < 1 || files.length > 2) throw new Error("Usage: verify-sqlite-backup.ts BACKUP.db [RESTORED.db]");
  const reports = files.map(verifySqliteBackup);
  const ok = (r: BackupReport) => r.integrity === "ok" && r.foreignKeyViolations === 0 && (r.googleTokens.total === 0 || r.googleTokens.decryptable === r.googleTokens.total);
  const result: Record<string, unknown> = { backup: reports[0], passed: ok(reports[0]) };
  if (reports[1]) {
    const same = JSON.stringify(reports[0].tables) === JSON.stringify(reports[1].tables) && JSON.stringify(reports[0].googleTokens) === JSON.stringify(reports[1].googleTokens);
    Object.assign(result, { restored: reports[1], countsMatch: same, passed: ok(reports[0]) && ok(reports[1]) && same });
  }
  if (!hasAppSecret()) result.note = "APP_SECRET not set: token decryptability was not checked.";
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    // Driver errors can include paths or SQL; keep the message generic.
    console.error("Backup verification failed. Check the file paths and that each file is a SQLite database.");
    process.exitCode = 1;
  }
}
