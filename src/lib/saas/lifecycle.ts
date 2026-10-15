import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, or, sql, sum } from 'drizzle-orm';
import { verifyPassword } from 'better-auth/crypto';
import type { SaasDb } from './db';
import * as s from './schema';
import { activity, deletionRecords, imports, usageRecords } from './operations-schema';
import { AccessDeniedError, assertTenant, type TenantContext } from './tenant';

export const deletionHash = (id: string) => createHash('sha256').update(id).digest('hex');
export class LifecycleError extends Error {}

/** Current-password confirmation is required even for a fresh session. Never re-signs in. */
export async function confirmPassword(db: SaasDb, userId: string, password: unknown) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 128) return false;
  const [credential] = await db.select({ password: s.account.password }).from(s.account)
    .where(and(eq(s.account.userId, userId), eq(s.account.providerId, 'credential')));
  return !!credential?.password && await verifyPassword({ hash: credential.password, password });
}

/** One repeatable snapshot. Only domain tables are included; auth credentials never selected. */
export async function exportAccount(db: SaasDb, context: TenantContext) {
  await assertTenant(db, context);
  return db.transaction(async tx => {
    await tx.execute(sql`set transaction isolation level repeatable read`);
    const [owner] = await tx.select({ id: s.user.id, name: s.user.name, email: s.user.email, emailVerified: s.user.emailVerified, createdAt: s.user.createdAt, updatedAt: s.user.updatedAt })
      .from(s.user).where(eq(s.user.id, context.userId));
    if (!owner) throw new AccessDeniedError();
    // Explicit table allowlist: adding credential columns/tables cannot silently expand this export.
    const websites = await tx.select().from(s.sites).where(eq(s.sites.tenantId, context.tenantId));
    const audits = await tx.select().from(s.audits).where(eq(s.audits.tenantId, context.tenantId));
    const pages = await tx.select().from(s.pages).where(eq(s.pages.tenantId, context.tenantId));
    const checks = await tx.select().from(s.checks).where(eq(s.checks.tenantId, context.tenantId));
    const findings = await tx.select().from(s.issues).where(eq(s.issues.tenantId, context.tenantId));
    const performance = await tx.select().from(s.performanceResults).where(eq(s.performanceResults.tenantId, context.tenantId));
    const searchSnapshots = await tx.select().from(s.searchSnapshots).where(eq(s.searchSnapshots.tenantId, context.tenantId));
    const connections = await tx.select({ siteId: s.searchConsoleConnections.siteId, property: s.searchConsoleConnections.property, status: s.searchConsoleConnections.status, connectedAt: s.searchConsoleConnections.connectedAt }).from(s.searchConsoleConnections).where(eq(s.searchConsoleConnections.tenantId, context.tenantId));
    const events = await tx.select({ action: activity.action, metadata: activity.metadata, createdAt: activity.createdAt }).from(activity).where(eq(activity.tenantId, context.tenantId));
    const usage = await tx.select({ auditId: usageRecords.auditId, kind: usageRecords.kind, units: usageRecords.units, createdAt: usageRecords.createdAt }).from(usageRecords).where(eq(usageRecords.tenantId, context.tenantId));
    const bare = <T extends { tenantId: string }>({ tenantId: _tenant, ...row }: T) => row;
    return { format: 'seo-health-monitor-account', version: 1, exportedAt: new Date().toISOString(), profile: owner,
      websites: websites.map(bare), audits: audits.map(bare), pages: pages.map(bare), checks: checks.map(bare), findings: findings.map(bare), performance: performance.map(bare), searchSnapshots: searchSnapshots.map(bare), connections, activity: events, usage };
  });
}

/** Keep only anonymous day/kind totals so erasure cannot rewind shared provider cost caps. */
async function archiveGlobalUsage(db: SaasDb, tenantId: string) {
  const day = sql<string>`to_char(${usageRecords.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const totals = await db.select({ kind: usageRecords.kind, day, units: sum(usageRecords.units) }).from(usageRecords)
    .where(eq(usageRecords.tenantId, tenantId)).groupBy(usageRecords.kind, day);
  for (const total of totals) await db.insert(activity).values({
    id: randomUUID(), action: 'usage.anonymised',
    metadata: { kind: total.kind, units: Number(total.units) }, createdAt: new Date(`${total.day}T00:00:00.000Z`),
  });
}

/**
 * Tenant row serialises admission/erasure. Cascades remove queues and invalidate every lease.
 * Completion already holding a job lock either commits before the cascade (then is erased) or
 * loses its lease. Nothing is recreated/upserted by workers. Concurrent repeat calls are no-ops.
 */
export async function deleteAccount(db: SaasDb, context: TenantContext) {
  return db.transaction(async tx => {
    const [tenant] = await tx.select().from(s.tenants).where(and(eq(s.tenants.id, context.tenantId), eq(s.tenants.personalUserId, context.userId))).for('update');
    if (!tenant) {
      const [receipt] = await tx.select({ id: deletionRecords.id }).from(deletionRecords).where(eq(deletionRecords.userHash, deletionHash(context.userId)));
      if (receipt) return { deleted: true };
      throw new AccessDeniedError();
    }
    await assertTenant(tx as unknown as SaasDb, context);
    const [admin] = await tx.select().from(s.administrators).where(eq(s.administrators.userId, context.userId));
    if (admin) throw new LifecycleError('Administrator accounts require an operator handover before deletion. Contact the beta operator.');
    // Local erasure only: Google revokes per Google user/client and could revoke another tenant.
    // In-memory tokens are unreachable because every use first reloads the owning DB credential.
    const [owner] = await tx.select().from(s.user).where(eq(s.user.id, context.userId));
    if (!owner) throw new AccessDeniedError();
    await tx.delete(s.session).where(eq(s.session.userId, context.userId));
    await tx.delete(s.verification).where(or(eq(s.verification.identifier, owner.email), eq(s.verification.value, owner.id)));
    await tx.delete(s.invitations).where(or(eq(s.invitations.email, owner.email), eq(s.invitations.consumedBy, owner.id)));
    await tx.delete(imports).where(eq(imports.tenantId, tenant.id));
    await tx.delete(activity).where(or(eq(activity.actorId, owner.id), sql`${activity.metadata}->>'targetUserId' = ${owner.id}`));
    await tx.insert(deletionRecords).values({ id: randomUUID(), userHash: deletionHash(owner.id), tenantHash: deletionHash(tenant.id) }).onConflictDoNothing();
    await archiveGlobalUsage(tx as unknown as SaasDb, tenant.id);
    await tx.delete(s.tenants).where(eq(s.tenants.id, tenant.id));
    await tx.delete(s.user).where(eq(s.user.id, owner.id));
    return { deleted: true };
  });
}

/** Recovery-only: reapply the separately preserved deletion ledger before exposing a restore. */
export async function reconcileDeletionLedger(db: SaasDb, ledger: (typeof deletionRecords.$inferSelect)[]) {
  const userHashes = new Set(ledger.map(r=>r.userHash));
  const tenantHashes = new Set(ledger.map(r=>r.tenantHash));
  const owners = await db.select({id:s.user.id,email:s.user.email}).from(s.user);
  const tenants = await db.select({id:s.tenants.id,userId:s.tenants.personalUserId}).from(s.tenants);
  let erased=0;
  for(const owner of owners) {
    const owned=tenants.filter(t=>t.userId===owner.id);
    if(!userHashes.has(deletionHash(owner.id)) && !owned.some(t=>tenantHashes.has(deletionHash(t.id)))) continue;
    await db.delete(s.invitations).where(or(eq(s.invitations.email,owner.email),eq(s.invitations.consumedBy,owner.id)));
    for(const tenant of owned) {
      await archiveGlobalUsage(db, tenant.id);
      await db.delete(imports).where(eq(imports.tenantId,tenant.id));
      await db.delete(s.tenants).where(eq(s.tenants.id,tenant.id));
    }
    await db.delete(activity).where(or(eq(activity.actorId,owner.id),sql`${activity.metadata}->>'targetUserId' = ${owner.id}`));
    await db.delete(s.user).where(eq(s.user.id,owner.id));erased++;
  }
  if(ledger.length) await db.insert(deletionRecords).values(ledger).onConflictDoNothing();
  return erased;
}
