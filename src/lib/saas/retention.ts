import 'server-only';
import { and, count, inArray, lt, or, sql } from 'drizzle-orm';
import type { SaasDb } from './db';
import { activity, deletionRecords, jobs, operationalEvents, systemHeartbeats } from './operations-schema';
import { audits, invitations, searchConsoleJobs, searchSnapshots, session, verification } from './schema';

export function readRetentionPolicy(env: Record<string,string|undefined> = process.env) {
  const setting = (key:string, fallback:number) => {const value=Number(env[`PHASE2_RETENTION_${key}_DAYS`]); return Number.isInteger(value) && value>=1 && value<=3650 ? value : fallback;};
  return {revision:'g6-draft-1', approved:env.PHASE2_RETENTION_APPROVED_REVISION==='g6-draft-1', days:{
    audits:setting('AUDITS',180), scanLogs:setting('SCAN_LOGS',30), failedJobs:setting('FAILED_JOBS',30), authEvents:setting('AUTH_EVENTS',90), invitations:setting('INVITATIONS',90), searchSnapshots:setting('SEARCH_SNAPSHOTS',90), generatedReports:setting('GENERATED_REPORTS',180), deletionRecords:setting('DELETION_RECORDS',90), operationalEvents:setting('OPERATIONAL_EVENTS',30), activity:setting('ACTIVITY',90), backups:setting('BACKUPS',30),
  }};
}

/** No scheduler calls this. Preview by default; execution requires reviewed revision + exact confirmation. */
export async function retentionMaintenance(db:SaasDb, options:{execute?:boolean; confirmation?:string; env?:Record<string,string|undefined>; now?:Date}={}) {
  const policy=readRetentionPolicy(options.env); const now=options.now??new Date();
  if(options.execute && (!policy.approved || options.confirmation!==`APPLY ${policy.revision}`)) throw new Error('Retention policy review and explicit confirmation are required.');
  // Deletion receipts must outlive every recoverable backup, including offline copies.
  if(policy.days.deletionRecords<=policy.days.backups) throw new Error('Deletion records must outlive backups.');
  const cutoff=(days:number)=>new Date(now.getTime()-days*86400_000);
  return db.transaction(async tx=>{
    const noActive = sql`not exists (select 1 from ${jobs} where ${jobs.auditId}=${audits.id} and ${jobs.state} in ('queued','running'))`;
    const terminal=and(inArray(audits.status,['completed','failed','cancelled']),noActive);
    const candidates = {
      audits: await tx.select({n:count()}).from(audits).where(and(terminal,lt(audits.createdAt,cutoff(policy.days.audits)))),
      scanLogs: await tx.select({n:count()}).from(audits).where(and(terminal,lt(audits.createdAt,cutoff(policy.days.scanLogs)),sql`jsonb_array_length(${audits.log})>0`)),
      generatedReports: await tx.select({n:count()}).from(audits).where(and(terminal,lt(audits.aiGeneratedAt,cutoff(policy.days.generatedReports)))),
      failedJobs: await tx.select({n:count()}).from(jobs).where(and(inArray(jobs.state,['failed','completed','cancelled']),lt(jobs.finishedAt,cutoff(policy.days.failedJobs)))),
      searchJobs: await tx.select({n:count()}).from(searchConsoleJobs).where(and(inArray(searchConsoleJobs.state,['failed','completed']),lt(searchConsoleJobs.finishedAt,cutoff(policy.days.failedJobs)))),
      snapshots: await tx.select({n:count()}).from(searchSnapshots).where(lt(searchSnapshots.fetchedAt,cutoff(policy.days.searchSnapshots))),
      invitations: await tx.select({n:count()}).from(invitations).where(and(lt(invitations.createdAt,cutoff(policy.days.invitations)),or(sql`${invitations.consumedBy} is not null`,sql`${invitations.claimedAt} is null`),lt(invitations.expiresAt,now))),
      deletionRecords: await tx.select({n:count()}).from(deletionRecords).where(lt(deletionRecords.deletedAt,cutoff(policy.days.deletionRecords))),
      activity: await tx.select({n:count()}).from(activity).where(lt(activity.createdAt,cutoff(policy.days.activity))),
      events: await tx.select({n:count()}).from(operationalEvents).where(sql`${operationalEvents.createdAt}<${cutoff(policy.days.operationalEvents)} and ${operationalEvents.kind} not like 'auth.%' or ${operationalEvents.createdAt}<${cutoff(policy.days.authEvents)} and ${operationalEvents.kind} like 'auth.%'`),
      expiredSessions:await tx.select({n:count()}).from(session).where(lt(session.expiresAt,now)),
      expiredVerification:await tx.select({n:count()}).from(verification).where(lt(verification.expiresAt,now)),
    };
    if(options.execute) {
      // Operator pauses admissions/workers for a consistent preview/apply maintenance window.
      await tx.execute(sql`lock table tenants, audits, background_jobs, search_console_jobs in share row exclusive mode`);
      await tx.update(audits).set({log:[]}).where(and(terminal,lt(audits.createdAt,cutoff(policy.days.scanLogs))));
      await tx.update(audits).set({aiReport:null,aiModel:null,aiGeneratedAt:null}).where(and(terminal,lt(audits.aiGeneratedAt,cutoff(policy.days.generatedReports))));
      await tx.delete(audits).where(and(terminal,lt(audits.createdAt,cutoff(policy.days.audits))));
      await tx.delete(jobs).where(and(inArray(jobs.state,['failed','completed','cancelled']),lt(jobs.finishedAt,cutoff(policy.days.failedJobs))));
      await tx.delete(searchConsoleJobs).where(and(inArray(searchConsoleJobs.state,['failed','completed']),lt(searchConsoleJobs.finishedAt,cutoff(policy.days.failedJobs))));
      await tx.delete(searchSnapshots).where(lt(searchSnapshots.fetchedAt,cutoff(policy.days.searchSnapshots)));
      await tx.delete(invitations).where(and(lt(invitations.createdAt,cutoff(policy.days.invitations)),or(sql`${invitations.consumedBy} is not null`,sql`${invitations.claimedAt} is null`),lt(invitations.expiresAt,now)));
      await tx.delete(deletionRecords).where(lt(deletionRecords.deletedAt,cutoff(policy.days.deletionRecords)));
      await tx.delete(activity).where(lt(activity.createdAt,cutoff(policy.days.activity)));
      await tx.delete(operationalEvents).where(sql`${operationalEvents.createdAt}<${cutoff(policy.days.operationalEvents)} and ${operationalEvents.kind} not like 'auth.%' or ${operationalEvents.createdAt}<${cutoff(policy.days.authEvents)} and ${operationalEvents.kind} like 'auth.%'`);
      await tx.delete(session).where(lt(session.expiresAt,now)); await tx.delete(verification).where(lt(verification.expiresAt,now));
      await tx.delete(systemHeartbeats).where(lt(systemHeartbeats.lastSeenAt,cutoff(1)));
    }
    return {policy, mode:options.execute?'applied':'preview', candidates:Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,v[0].n])), backups:'External encrypted storage; managed by the backup operator, not this database job.'};
  });
}
