import 'server-only';
import { count, gte, sql } from 'drizzle-orm';
import type { SaasDb } from './db';
import { assertAdministrator } from './administration';
import { jobs, operationalEvents, systemHeartbeats } from './operations-schema';
import { searchConsoleJobs } from './schema';
import { dayStart, monthStart, readLimitSettings, usedUnits, type LimitSettings } from './limits';

export async function operationsSnapshot(db: SaasDb, actorId: string, settings: LimitSettings = readLimitSettings(), now = new Date()) {
  await assertAdministrator(db, actorId);
  const aggregate = async (table: typeof jobs | typeof searchConsoleJobs) => {
    const [r] = await db.select({queued: sql<number>`count(*) filter (where ${table.state}='queued')::int`, running: sql<number>`count(*) filter (where ${table.state}='running')::int`, failed: sql<number>`count(*) filter (where ${table.state}='failed')::int`,
      completed: sql<number>`count(*) filter (where ${table.state}='completed')::int`, retries: sql<number>`coalesce(sum(greatest(${table.attempts}-1,0)),0)::int`,
      stale: sql<number>`count(*) filter (where ${table.state}='running' and ${table.leaseExpiresAt}<${now})::int`,
      oldestQueuedAt: sql<string | null>`min(${table.createdAt}) filter (where ${table.state}='queued')`,
      lastFinishedAt: sql<string | null>`max(${table.finishedAt})`}).from(table);
    return r;
  };
  const [audits, searchConsole, beats, events, daily, monthly] = await Promise.all([
    aggregate(jobs), aggregate(searchConsoleJobs), db.select().from(systemHeartbeats),
    db.select({kind: operationalEvents.kind, count: count()}).from(operationalEvents).where(gte(operationalEvents.createdAt, new Date(now.getTime()-86400_000))).groupBy(operationalEvents.kind),
    Promise.all((['audit','pagespeed','ai'] as const).map(async kind=>({kind,units:await usedUnits(db,{kind,since:dayStart(now)})}))),
    Promise.all((['audit','pagespeed','ai'] as const).map(async kind=>({kind,units:await usedUnits(db,{kind,since:monthStart(now)})}))),
  ]);
  const fresh = (role: string) => beats.some(b => b.role===role && now.getTime()-b.lastSeenAt.getTime()<90_000);
  const failures = Object.fromEntries(events.map(e=>[e.kind,e.count]));
  const alerts: {code: string; message: string}[] = [];
  const add = (condition: boolean, code: string, message: string) => {if(condition) alerts.push({code,message});};
  const queued = audits.queued+searchConsole.queued;
  add(!fresh('worker'), 'worker_missing', 'No worker heartbeat in 90 seconds. Check the beta worker service.');
  add(audits.stale+searchConsole.stale>0, 'stale_leases', 'Expired leases need worker recovery.');
  for(const [name,q] of Object.entries({audits,searchConsole})) {
    const age=q.oldestQueuedAt ? now.getTime()-new Date(q.oldestQueuedAt).getTime() : 0;
    add(q.queued>0 && age>10*60_000, `${name}_queue_delayed`, 'Jobs have waited over ten minutes. Inspect worker capacity and retry backoff.');
  }
  const lastProgress = Math.max(0, ...beats.filter(b=>b.role==='worker').map(b=>b.lastProgressAt?.getTime()??0));
  add(queued>0 && now.getTime()-lastProgress>10*60_000, 'no_progress', 'The queue has work but no completion for ten minutes.');
  add((failures['audit.failed']??0)>=3, 'repeated_audit_failures', 'Three or more audits failed in the last 24 hours.');
  add((failures['database.failure']??0)>0, 'database_failures', 'Database failures recorded. Check Railway structured logs for outages during which events could not be persisted.');
  for(const [kind,cap] of [['pagespeed',settings.global.pagespeedPerDay],['ai',settings.global.aiPerDay]] as const) {
    add(cap>0 && (daily.find(x=>x.kind===kind)?.units??0)>=cap*.8, `${kind}_budget`, `${kind} has used at least 80% of the daily budget.`);
  }
  const finished=audits.completed+audits.failed;
  return {checkedAt: now.toISOString(), webHealthy: fresh('web'), workerHealthy: fresh('worker'), queues: {audits,searchConsole}, rates: {completion: finished ? audits.completed/finished : null, failure: finished ? audits.failed/finished : null}, failuresLast24Hours: failures,
    usage: {daily,monthly, caps: settings.global}, alerts,
    note: 'Rates cover retained jobs. Usage counts retained reservations plus anonymous deleted-account daily totals, not provider billing. Database failures during outages are available in structured Railway logs; the database cannot record its own outage.'};
}
