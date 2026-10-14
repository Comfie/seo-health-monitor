// Disposable in-memory PostgreSQL rehearsal; reads a backup, never its source DB.
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { saasSchema } from "../src/lib/saas/db";
import { bootstrapAdministrator } from "../src/lib/saas/bootstrap";
import { importSqliteBackup } from "../src/lib/saas/import-sqlite";

async function main() {
  const backup = process.argv[2];
  if (!backup) throw new Error("Supply a verified standalone backup path.");
  const client = new PGlite();
  try {
    const db = drizzle(client, { schema: saasSchema });
    await migrate(db, { migrationsFolder: "drizzle-saas" });
    const id = randomUUID();
    const tenantId = randomUUID();
    const email = `${randomUUID()}@example.invalid`;
    // Synthetic verified identity is confined to this disposable database.
    await db.insert(saasSchema.user).values({ id, email, name: "Migration rehearsal", emailVerified: true });
    await db.insert(saasSchema.tenants).values({ id: tenantId, name: "Migration rehearsal", personalUserId: id });
    await db.insert(saasSchema.memberships).values({ tenantId, userId: id, role: "owner" });
    await bootstrapAdministrator(db, email);
    console.log(JSON.stringify(await importSqliteBackup(db, backup, tenantId, id), null, 2));
    console.log("Rehearsal passed; disposable PostgreSQL database closed. Source backup unchanged.");
  } finally { await client.close(); }
}

main().catch((error: unknown) => {
  // Application errors above contain no row contents or credentials.
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Rehearsal failed");
  process.exitCode = 1;
});
