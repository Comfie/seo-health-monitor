import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SaasDb } from './db';
import { operationalEvents, systemHeartbeats } from './operations-schema';

export type EventKind = 'database.failure' | 'worker.poll_failed' | 'audit.completed' | 'audit.failed' | 'pagespeed.failure' | 'google.refresh_failure' | 'ai.failure' | 'auth.success' | 'auth.failure' | 'auth.signout';
// Structured events have no arbitrary text field. A provider error can never enter the payload.
export function logOperationalEvent(kind: EventKind) {
  console.error(JSON.stringify({source: 'beta', kind, at: new Date().toISOString()}));
}
export async function recordEvent(db: SaasDb, kind: EventKind, tenantId?: string) {
  if (kind.endsWith('failure') || kind.endsWith('failed')) logOperationalEvent(kind);
  try { await db.insert(operationalEvents).values({id: randomUUID(), kind, tenantId}); }
  catch { logOperationalEvent('database.failure'); }
}
export async function recordHeartbeat(db: SaasDb, id: string, role: 'web' | 'worker', running = 0, progress = false, now = new Date()) {
  await db.insert(systemHeartbeats).values({id, role, running, lastSeenAt: now, lastProgressAt: progress ? now : null})
    .onConflictDoUpdate({target: systemHeartbeats.id, set: {running, lastSeenAt: now, ...(progress ? {lastProgressAt: now} : {})}});
}
