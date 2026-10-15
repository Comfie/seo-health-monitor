import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { SaasDb } from "./db";
import { activity } from "./operations-schema";
import { administrators, user } from "./schema";

/** Offline operator action only. No HTTP endpoint, password or first-user rule. */
export async function bootstrapAdministrator(db: SaasDb, verifiedEmail: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(72104002)`);
    if ((await tx.select().from(administrators).limit(1)).length) throw new Error("Initial administrator has already been provisioned.");
    const [candidate] = await tx.select().from(user).where(eq(user.email, verifiedEmail.trim().toLowerCase()));
    if (!candidate?.emailVerified) throw new Error("An existing, email-verified user is required.");
    await tx.insert(administrators).values({ userId: candidate.id });
    await tx.insert(activity).values({ id: randomUUID(), actorId: candidate.id, action: "administrator.bootstrap" });
    return candidate.id;
  });
}
