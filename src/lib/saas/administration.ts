import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SaasDb } from './db';
import { effectiveLimits, readLimitSettings, usageSummary, type LimitSettings } from './limits';
import { activity, jobs } from './operations-schema';
import { user, tenants, administrators, session, audits, searchConsoleJobs, sites } from './schema';
import { AccessDeniedError } from './tenant';

export const accountChange = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  websiteLimit: z.number().int().min(0).max(100).nullable().optional(),
  monthlyAuditLimit: z.number().int().min(0).max(1000).nullable().optional(),
  pageLimit: z.number().int().min(1).max(100).nullable().optional(),
  concurrentAuditLimit: z.number().int().min(1).max(10).nullable().optional(),
  monthlyPagespeedLimit: z.number().int().min(0).max(10000).nullable().optional(),
  monthlyAiLimit: z.number().int().min(0).max(1000).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0);

// These functions independently enforce privileges; calling a repository directly is no bypass.
export async function assertAdministrator(db: SaasDb, actorId: string) {
  const [row] = await db.select({ id: administrators.userId }).from(administrators).where(eq(administrators.userId, actorId));
  if (!row) throw new AccessDeniedError();
}

export async function adminAccounts(db: SaasDb, actorId: string, search = '', settings: LimitSettings = readLimitSettings()) {
  await assertAdministrator(db, actorId);
  const [totals] = await db.select({ registered: count(), pending: sql<number>`count(*) filter (where ${tenants.id} is null)::int`,
    active: sql<number>`count(*) filter (where ${tenants.status} = 'active')::int`, suspended: sql<number>`count(*) filter (where ${tenants.status} = 'suspended')::int` })
    .from(user).leftJoin(tenants, eq(tenants.personalUserId, user.id));
  const rows = await db.select({ id: user.id, email: user.email, name: user.name, verified: user.emailVerified, createdAt: user.createdAt, tenant: tenants })
    .from(user).leftJoin(tenants, eq(tenants.personalUserId, user.id))
    .where(search ? ilike(user.email, `%${search.slice(0, 254).replace(/[\\%_]/g, '\\$&')}%`) : undefined)
    .orderBy(desc(user.createdAt)).limit(100);
  const accounts = await Promise.all(rows.map(async ({ tenant, ...profile }) => ({ ...profile, status: tenant?.status ?? 'pending',
    overrides: tenant ? { websiteLimit: tenant.websiteLimit, monthlyAuditLimit: tenant.monthlyAuditLimit, pageLimit: tenant.pageLimit, concurrentAuditLimit: tenant.concurrentAuditLimit, monthlyPagespeedLimit: tenant.monthlyPagespeedLimit, monthlyAiLimit: tenant.monthlyAiLimit } : null,
    limits: tenant ? effectiveLimits(tenant, settings) : null,
    usage: tenant ? { ...await usageSummary(db, tenant.id), websites: (await db.select({n:count()}).from(sites).where(eq(sites.tenantId,tenant.id)))[0].n } : null,
  })));
  const recent = await db.select({ id: activity.id, action: activity.action, metadata: activity.metadata, createdAt: activity.createdAt })
    .from(activity).where(sql`${activity.action} like 'admin.%' or ${activity.action} like 'invitation.%' or ${activity.action} = 'administrator.bootstrap'`)
    .orderBy(desc(activity.createdAt)).limit(50);
  return { totals, accounts, recent };
}

export async function changeAccount(db: SaasDb, actorId: string, targetUserId: string, raw: unknown) {
  const change = accountChange.parse(raw);
  return db.transaction(async tx => {
    await assertAdministrator(tx as unknown as SaasDb, actorId);
    const [target] = await tx.select().from(tenants).where(eq(tenants.personalUserId, targetUserId)).for('update');
    if (!target) throw new AccessDeniedError();
    // Administrators cannot suspend any administrator, including themselves.
    if (change.status === 'suspended') {
      const [privileged] = await tx.select().from(administrators).where(eq(administrators.userId, targetUserId));
      if (privileged) throw new AccessDeniedError();
      await tx.delete(session).where(eq(session.userId, targetUserId));
      // Fence in-flight writes immediately. Reactivation must not resume old claims.
      await tx.update(jobs).set({ state: 'cancelled', cancelRequestedAt: new Date(), leaseToken: null, leaseExpiresAt: null, finishedAt: new Date(), fence: sql`${jobs.fence} + 1` })
        .where(and(eq(jobs.tenantId, target.id), inArray(jobs.state, ['queued', 'running'])));
      await tx.update(audits).set({ status: 'cancelled', stage: 'Account suspended', completedAt: new Date() })
        .where(and(eq(audits.tenantId, target.id), inArray(audits.status, ['queued', 'running'])));
      await tx.update(searchConsoleJobs).set({ state: 'failed', leaseToken: null, leaseExpiresAt: null, finishedAt: new Date(), fence: sql`${searchConsoleJobs.fence} + 1` })
        .where(and(eq(searchConsoleJobs.tenantId, target.id), inArray(searchConsoleJobs.state, ['queued', 'running'])));
    }
    await tx.update(tenants).set(change).where(eq(tenants.id, target.id));
    for (const [field, value] of Object.entries(change)) {
      const previous = target[field as keyof typeof change];
      await tx.insert(activity).values({ id: randomUUID(), actorId, action: 'admin.account.updated', metadata: { targetUserId, field, before: previous ?? 'default', after: value ?? 'default' } });
    }
    return { updated: true };
  });
}
