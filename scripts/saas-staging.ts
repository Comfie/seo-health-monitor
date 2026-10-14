// Explicit staging-only maintenance. Never imported by the web application.
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createSaasDb } from "../src/lib/saas/db";
import { bootstrapAdministrator } from "../src/lib/saas/bootstrap";
import { importSqliteBackup } from "../src/lib/saas/import-sqlite";
import { createInvitation } from "../src/lib/saas/invitations";

async function main() {
  const [action, ...args] = process.argv.slice(2);
  const connection = process.env.STAGING_DATABASE_URL;
  if (!connection || process.env.PHASE2_DATABASE_PURPOSE !== "staging") throw new Error("Explicit STAGING_DATABASE_URL and PHASE2_DATABASE_PURPOSE=staging are required.");
  const url = new URL(connection);
  if (args.pop() !== `--confirm-staging=${url.hostname}${url.pathname}`) throw new Error("Confirm the exact staging hostname/database; production targets are prohibited.");
  if (connection === process.env.DATABASE_URL || connection === process.env.PRODUCTION_DATABASE_URL) throw new Error("Refusing a shared production database URL.");
  const db = createSaasDb(connection);
  try {
    if (action === "migrate") await migrate(db, { migrationsFolder: "drizzle-saas" });
    else if (action === "check" && args.length === 0) {
      // Read-only: connectivity after a credential rotation, and proof the schema is intact.
      // Prints counts only, never the connection string or row contents.
      const one = async <T,>(query: ReturnType<typeof sql>) => ((await db.execute(query)) as unknown as { rows: T[] }).rows[0];
      const server = await one<{ version: string }>(sql`select current_setting('server_version') as version`);
      const migrations = await one<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      const tables = await one<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
      const rows = await one<Record<string, number>>(sql`select (select count(*)::int from auth_user) as users, (select count(*)::int from tenants) as tenants, (select count(*)::int from sites) as websites, (select count(*)::int from audits) as audits, (select count(*)::int from background_jobs) as jobs`);
      console.log(JSON.stringify({ connected: true, postgres: server.version, migrations: migrations.n, publicTables: tables.n, rows }));
    }
    else if (action === "bootstrap" && args.length === 1) await bootstrapAdministrator(db, args[0]);
    else if (action === "prepare-invitation" && args.length === 1) {
      if (process.env.ALLOW_TEST_INVITATION !== "true") throw new Error("Test invitations require ALLOW_TEST_INVITATION=true. Real external invitations require user approval.");
      const origin = process.env.PHASE2_ORIGIN;
      if (!origin) throw new Error("PHASE2_ORIGIN is required to print the registration link.");
      // Email-bound, hashed, single-use token; sends no email and is not an admin grant.
      // Used once to onboard the operator before the admin invitation page exists for them.
      const { token, invitation } = await createInvitation(db, { email: args[0], createdBy: null, ttlHours: 24 });
      console.log(`Registration link for ${invitation.email} (shown once, expires ${invitation.expiresAt.toISOString()}):`);
      console.log(`${origin}/beta/register?token=${token}`);
    } else if (action === "import-sqlite" && args.length === 3) {
      console.log(await importSqliteBackup(db, args[0], args[1], args[2]));
    } else throw new Error("Usage: migrate | check | bootstrap EMAIL | prepare-invitation TEST_EMAIL | import-sqlite BACKUP TENANT_ID ADMIN_USER_ID; append --confirm-staging=HOST/DATABASE.");
    console.log("Staging maintenance complete. No application deployment performed.");
  } finally { await db.$client.end(); }
}

main().catch(() => {
  // PostgreSQL driver errors can include credentials, customer data or SQL params.
  console.error("Staging maintenance failed. Check action, target confirmation, prerequisites and private operator diagnostics.");
  process.exitCode = 1;
});
