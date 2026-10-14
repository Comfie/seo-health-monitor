import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import type { SaasAuth } from "./auth";
import type { SaasDb } from "./db";
import { activity } from "./operations-schema";
import { invitations, memberships, tenants } from "./tenancy-schema";

const verifiedContext = Symbol("verified-tenant-context");
export type TenantContext = Readonly<{ userId: string; tenantId: string; [verifiedContext]: true }>;
export class AccessDeniedError extends Error {
  constructor() { super("Resource unavailable."); }
}

const seal = (userId: string, tenantId: string): TenantContext => Object.freeze({ userId, tenantId, [verifiedContext]: true as const });

/**
 * Creates (or returns) the personal tenant of an email-verified user in one transaction.
 * The invitation is consumed in the same transaction, so a crash cannot leave a tenant
 * without its consumed invitation or vice versa. Callers must pass a library-verified user.
 */
export async function provisionPersonalTenant(db: SaasDb, verifiedUser: { id: string; email: string; name: string; emailVerified: boolean }) {
  if (!verifiedUser.emailVerified) throw new AccessDeniedError();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: tenants.id, status: tenants.status }).from(tenants)
      .innerJoin(memberships, and(eq(memberships.tenantId, tenants.id), eq(memberships.userId, verifiedUser.id)))
      .where(eq(tenants.personalUserId, verifiedUser.id)).limit(1);
    if (existing) {
      if (existing.status !== "active") throw new AccessDeniedError();
      return seal(verifiedUser.id, existing.id);
    }
    // A claimed invitation proves registration happened before expiry; revocation always wins.
    const [invite] = await tx.update(invitations).set({ consumedBy: verifiedUser.id }).where(and(
      eq(invitations.email, verifiedUser.email.toLowerCase()),
      isNull(invitations.revokedAt),
      or(isNotNull(invitations.claimedAt), gt(invitations.expiresAt, new Date())),
      or(isNull(invitations.consumedBy), eq(invitations.consumedBy, verifiedUser.id)),
    )).returning({ id: invitations.id });
    if (!invite) throw new AccessDeniedError();
    await tx.insert(tenants).values({ id: randomUUID(), name: `${verifiedUser.name}'s account`, personalUserId: verifiedUser.id }).onConflictDoNothing();
    const [personal] = await tx.select({ id: tenants.id, status: tenants.status }).from(tenants).where(eq(tenants.personalUserId, verifiedUser.id));
    if (!personal || personal.status !== "active") throw new AccessDeniedError();
    await tx.insert(memberships).values({ tenantId: personal.id, userId: verifiedUser.id, role: "owner" }).onConflictDoNothing();
    await tx.insert(activity).values({ id: randomUUID(), tenantId: personal.id, actorId: verifiedUser.id, action: "account.created", metadata: {} });
    return seal(verifiedUser.id, personal.id);
  });
}

// Never construct a context from a request body, URL tenant ID or legacy cookie.
export async function requireTenant(db: SaasDb, auth: SaasAuth, headers: Headers): Promise<TenantContext> {
  const current = await auth.api.getSession({ headers });
  if (!current?.user.emailVerified) throw new AccessDeniedError();
  return provisionPersonalTenant(db, current.user);
}

// Recheck membership/suspension inside every operation, including queued work.
export async function assertTenant(db: SaasDb, context: TenantContext) {
  if (context?.[verifiedContext] !== true) throw new AccessDeniedError();
  const [row] = await db.select({ id: tenants.id }).from(tenants).innerJoin(memberships, eq(memberships.tenantId, tenants.id))
    .where(and(eq(tenants.id, context.tenantId), eq(tenants.status, "active"), eq(memberships.userId, context.userId))).limit(1);
  if (!row) throw new AccessDeniedError();
}
