import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaasAuth } from '@/lib/saas/auth';
import { bootstrapAdministrator } from '@/lib/saas/bootstrap';
import { saasSchema as s, type SaasDb } from '@/lib/saas/db';
import { createInvitation } from '@/lib/saas/invitations';
import { readLimitSettings, usedUnits, dayStart } from '@/lib/saas/limits';
import { requireTenant, provisionPersonalTenant } from '@/lib/saas/tenant';
import { tenantRepository } from '@/lib/saas/repository';
import { deleteAccount, deletionHash } from '@/lib/saas/lifecycle';
import { adminAccounts, changeAccount } from '@/lib/saas/administration';
import { claimJob, completeJob, failJob, heartbeat, reportProgress, recoverExpiredJobs } from '@/lib/saas/jobs';
import { claimRefresh, completeRefresh, failRefresh } from '@/lib/saas/gsc-jobs';
import { recordHeartbeat, recordEvent } from '@/lib/saas/telemetry';
import { operationsSnapshot } from '@/lib/saas/monitoring';
import { retentionMaintenance } from '@/lib/saas/retention';
import { setBetaRuntimeForTests, type BetaRuntime } from '@/lib/saas/server';
import * as authRoute from '@/app/api/beta/auth/[...all]/route';
import * as registerRoute from '@/app/api/beta/register/route';
import * as accountsRoute from '@/app/api/beta/admin/accounts/route';
import * as accountRoute from '@/app/api/beta/admin/accounts/[id]/route';
import * as operationsRoute from '@/app/api/beta/admin/operations/route';
import * as exportRoute from '@/app/api/beta/account/export/route';
import * as deleteRoute from '@/app/api/beta/account/delete/route';
import * as sitesRoute from '@/app/api/beta/websites/route';

const client = new PGlite(); const db=drizzle(client,{schema:s}) as unknown as SaasDb;
const origin='https://beta.example.com', password=randomUUID()+'!Aa';
const outbox:{to:string;url:string;purpose:string}[]=[];
const settings=readLimitSettings({PHASE2_LIMIT_AUDITS_PER_MONTH:'100',PHASE2_LIMIT_WEBSITES:'20'});
const config:BetaRuntime['config']={databaseUrl:'pglite://memory',origin,authSecret:randomUUID()+randomUUID(),registration:'invite-only',invitationsEnabled:true,invitationTtlHours:24,email:{transport:'log',allowlist:[]},google:{state:'unavailable',problem:'Not configured',redirectUri:origin+'/api/beta/google/callback'}};
const runtime:BetaRuntime={config,db,limits:settings,mail:async()=>{},auth:createSaasAuth({db,origin,secret:config.authSecret,registration:'invite-only',sendMail:async m=>{outbox.push(m);}})};
type Handler=(req:Request,ctx:{params:Promise<{id:string}>})=>Promise<Response>;
async function call(h:unknown,method:string,cookie?:string,body?:unknown,id='',requestOrigin:string|null=origin){
  const headers=new Headers({'content-type':'application/json'});if(cookie) headers.set('cookie',cookie);if(requestOrigin)headers.set('origin',requestOrigin);
  return (h as Handler)(new Request(origin+'/api/beta/test',{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({id})});
}
async function signIn(email:string){
  const r=await authRoute.POST(new Request(origin+'/api/beta/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password})}));
  expect(r.status).toBe(200);return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
}
async function onboard(label:string){
  await db.delete(s.rateLimit);const email=`${label}-${randomUUID()}@example.com`;
  const {token}=await createInvitation(db,{email,createdBy:null,ttlHours:24});
  expect((await call(registerRoute.POST,'POST',undefined,{email,token,name:label,password})).status).toBe(200);
  const mail=outbox.filter(x=>x.to===email).at(-1)!; expect((await authRoute.GET(new Request(mail.url))).status).toBe(302);
  const cookie=await signIn(email);const context=await requireTenant(db,runtime.auth,new Headers({cookie}));
  return {email,cookie,context};
}
type Customer=Awaited<ReturnType<typeof onboard>>;
let admin:Customer,alice:Customer,bob:Customer;
beforeAll(async()=>{await migrate(drizzle(client),{migrationsFolder:'drizzle-saas'});setBetaRuntimeForTests(runtime);admin=await onboard('operator');await bootstrapAdministrator(db,admin.email);alice=await onboard('alice');bob=await onboard('bob');},60_000);
beforeEach(async()=>{await db.delete(s.rateLimit);});
afterAll(async()=>{setBetaRuntimeForTests(undefined);await client.close();});
async function site(c:Customer,host='example.com'){return tenantRepository(db,c.context,settings).addWebsite('https://'+host,host);}
async function completed(c:Customer,host:string){
 const website=await site(c,host);const [audit]=await db.insert(s.audits).values({tenantId:c.context.tenantId,siteId:website.id,inputUrl:website.displayUrl,startUrl:website.displayUrl,status:'completed',overallScore:77,aiReport:'Private report '+c.email,aiGeneratedAt:new Date(),log:['Crawl complete']}).returning();
 await db.insert(s.pages).values({tenantId:c.context.tenantId,auditId:audit.id,url:website.displayUrl,finalUrl:website.displayUrl,depth:0,source:'crawl',data:{title:'Private '+c.email}});
 await db.insert(s.checks).values({tenantId:c.context.tenantId,auditId:audit.id,checkId:'title',category:'on_page',title:'Title',description:'Check',status:'warn',weight:1,summary:'Missing'});
 await db.insert(s.issues).values({tenantId:c.context.tenantId,auditId:audit.id,issueKey:'title',checkId:'title',category:'on_page',severity:'high',title:'Missing title',url:website.displayUrl,evidence:['Private finding '+c.email],why:'Search',fix:'Add title',implementation:'Edit HTML',benefit:'Clarity',impact:3,confidence:'high',effort:'low',priorityScore:5});
 await db.insert(s.performanceResults).values({tenantId:c.context.tenantId,auditId:audit.id,url:website.displayUrl,strategy:'mobile',status:'unavailable',error:'API not configured'});
 await db.insert(s.searchSnapshots).values({tenantId:c.context.tenantId,siteId:website.id,auditId:audit.id,property:'sc-domain:'+host,status:'ok',startDate:'2026-01-01',endDate:'2026-01-28',topQueries:[{key:'Private query '+c.email,clicks:1,impressions:3,ctr:1/3,position:2}],fetchedAt:new Date()});
 return {website,audit};
}

describe('G6 administration permissions and operations',()=>{
 it('denies customer and unauthenticated access to every new admin endpoint',async()=>{
  for(const [h,method,body] of [[accountsRoute.GET,'GET',undefined],[accountRoute.PATCH,'PATCH',{status:'suspended'}],[operationsRoute.GET,'GET',undefined]] as const){
   expect((await call(h,method,alice.cookie,body,bob.context.userId)).status).toBe(404);
   expect((await call(h,method,undefined,body,bob.context.userId)).status).toBe(401);
  }
  await expect(adminAccounts(db,alice.context.userId)).rejects.toThrow('Resource unavailable');
  await expect(changeAccount(db,alice.context.userId,bob.context.userId,{status:'suspended'})).rejects.toThrow('Resource unavailable');
 });
 it('shows aggregate counts, searchable account status and no private reports or credentials',async()=>{
  const r=await call(accountsRoute.GET,'GET',admin.cookie); expect(r.status).toBe(200);const data=await r.json();expect(data.totals).toMatchObject({registered:3,active:3,suspended:0,pending:0});
  expect(JSON.stringify(data)).not.toMatch(/password|encryptedRefreshToken|session_token|aiReport/);
  expect((await adminAccounts(db,admin.context.userId,alice.email)).accounts.map(x=>x.email)).toEqual([alice.email]);
  expect((await adminAccounts(db,admin.context.userId,'%')).accounts).toHaveLength(0);
 });
 it('sets/removes overrides with old/new administrative evidence and rejects unknown fields',async()=>{
  expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,{monthlyAuditLimit:12,monthlyPagespeedLimit:0},alice.context.userId)).status).toBe(200);
  let data=await adminAccounts(db,admin.context.userId,alice.email,settings);expect(data.accounts[0].limits).toMatchObject({auditsPerMonth:12,pagespeedPerMonth:0});
  expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,{monthlyAuditLimit:null,monthlyPagespeedLimit:null},alice.context.userId)).status).toBe(200);
  data=await adminAccounts(db,admin.context.userId,alice.email,settings);expect(data.accounts[0].limits!.auditsPerMonth).toBe(100);
  expect(data.recent.some(x=>x.metadata.field==='monthlyAuditLimit' && x.metadata.before===12 && x.metadata.after==='default')).toBe(true);
  for(const body of [{role:'admin'},{websiteLimit:-1},{monthlyAiLimit:1001},{concurrentAuditLimit:0},{}]) expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,body,alice.context.userId)).status).toBe(400);
 });
 it('blocks CSRF, missing targets and suspension of the administrator',async()=>{
  expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,{status:'suspended'},alice.context.userId,'https://evil.example')).status).toBe(403);
  expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,{status:'suspended'},alice.context.userId,null)).status).toBe(403);
  expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,{status:'suspended'},'unknown')).status).toBe(404);
  expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,{status:'suspended'},admin.context.userId)).status).toBe(404);
 });
 it('suspends and fences work, revokes sessions, then permits a fresh sign-in after reactivation',async()=>{
  const website=await site(bob);await tenantRepository(db,bob.context,settings).enqueueAudit(website.id);const lease=await claimJob(db,'suspend-worker',settings);expect(lease).not.toBeNull();
  expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,{status:'suspended'},bob.context.userId)).status).toBe(200);
  expect(await heartbeat(db,lease!)).toBeNull();expect(await failJob(db,lease!,{message:'late',retryable:true})).toBe('stale');
  expect((await call(sitesRoute.GET,'GET',bob.cookie)).status).toBe(401);
  expect((await call(accountRoute.PATCH,'PATCH',admin.cookie,{status:'active'},bob.context.userId)).status).toBe(200);
  expect((await call(sitesRoute.GET,'GET',bob.cookie)).status).toBe(401);bob.cookie=await signIn(bob.email);expect((await call(sitesRoute.GET,'GET',bob.cookie)).status).toBe(200);
 });
 it('reports queue/worker failure alerts and fixed-code provider events without leaking payloads',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
   const now=new Date();await recordHeartbeat(db,'test-worker','worker',0,true,now);await recordHeartbeat(db,'test-web','web',0,false,now);
   await recordEvent(db,'database.failure');await recordEvent(db,'pagespeed.failure',alice.context.tenantId);await recordEvent(db,'google.refresh_failure',alice.context.tenantId);await recordEvent(db,'ai.failure',alice.context.tenantId);
   for(let i=0;i<3;i++)await recordEvent(db,'audit.failed',alice.context.tenantId);
   const d=await operationsSnapshot(db,admin.context.userId,settings,now);expect(d.workerHealthy).toBe(true);expect(d.webHealthy).toBe(true);expect(d.alerts.map(x=>x.code)).toContain('database_failures');expect(d.alerts.map(x=>x.code)).toContain('repeated_audit_failures');
   const later=await operationsSnapshot(db,admin.context.userId,settings,new Date(now.getTime()+120_000));expect(later.alerts.map(x=>x.code)).toContain('worker_missing');
   expect(JSON.stringify(d)).not.toMatch(/encrypted|leaseToken|Private query|session_token/);
  } finally {log.mockRestore();}
 });
});

describe('G6 customer data export',()=>{
 it('requires session, canonical origin and correct current password',async()=>{
  expect((await call(exportRoute.POST,'POST',undefined,{password})).status).toBe(401);
  expect((await call(exportRoute.POST,'POST',alice.cookie,{password},'',null)).status).toBe(403);
  for(const body of [{},{password:'wrong'},{password:42}])expect((await call(exportRoute.POST,'POST',alice.cookie,body)).status).toBe(403);
 });
 it('exports every owned domain record including findings/performance/snapshots and excludes all auth secrets and another tenant',async()=>{
  const a=await completed(alice,'alice.example.com');await completed(bob,'bob.example.com');
  await db.insert(s.googleAccounts).values({tenantId:alice.context.tenantId,userId:alice.context.userId,email:'google@example.com',encryptedRefreshToken:'SYNTHETIC-CIPHERTEXT',scopes:'readonly',connectedAt:new Date()});
  const r=await call(exportRoute.POST,'POST',alice.cookie,{password,tenantId:bob.context.tenantId,userId:bob.context.userId});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(r.headers.get('content-disposition')).toContain('attachment');
  const text=await r.text();const data=JSON.parse(text);expect(data.profile.email).toBe(alice.email);expect(data.audits.map((x:{id:number})=>x.id)).toContain(a.audit.id);expect(data.findings).toHaveLength(1);expect(data.performance[0].status).toBe('unavailable');expect(data.searchSnapshots[0].topQueries[0].key).toContain(alice.email);
  expect(text).not.toContain(bob.email);expect(text).not.toMatch(/password|SYNTHETIC-CIPHERTEXT|encryptedRefreshToken|leaseToken|session_token|authSecret/);expect(text).not.toContain(password);
 });
 it('throttles repeated expensive exports and password guesses per account',async()=>{
  for(let i=0;i<5;i++)await call(exportRoute.POST,'POST',alice.cookie,{password:'wrong'});
  const denied=await call(exportRoute.POST,'POST',alice.cookie,{password});expect(denied.status).toBe(429);expect(denied.headers.get('retry-after')).toBeTruthy();
  expect((await call(exportRoute.POST,'POST',bob.cookie,{password})).status).toBe(200);
 });
});

describe('G6 account erasure',()=>{
 it('requires current password plus exact confirmation and refuses administrator self-deletion',async()=>{
  expect((await call(deleteRoute.POST,'POST',alice.cookie,{password,confirmation:true})).status).toBe(400);
  expect((await call(deleteRoute.POST,'POST',alice.cookie,{password:'wrong',confirmation:'DELETE MY ACCOUNT'})).status).toBe(403);
  expect((await call(deleteRoute.POST,'POST',admin.cookie,{password,confirmation:'DELETE MY ACCOUNT'})).status).toBe(409);
  expect((await call(deleteRoute.POST,'POST',alice.cookie,{password,confirmation:'DELETE MY ACCOUNT'},'','https://evil.example')).status).toBe(403);
 });
 it('deletes a disposable empty account and makes retries harmless',async()=>{
  const c=await onboard('empty');const body={password,confirmation:'DELETE MY ACCOUNT'};
  expect((await call(deleteRoute.POST,'POST',c.cookie,body)).status).toBe(200);expect((await call(deleteRoute.POST,'POST',c.cookie,body)).status).toBe(401);
  expect(await deleteAccount(db,c.context)).toEqual({deleted:true});
  const receipt=await db.select().from(s.deletionRecords).where(eq(s.deletionRecords.userHash,deletionHash(c.context.userId)));expect(receipt).toHaveLength(1);expect(JSON.stringify(receipt)).not.toContain(c.email);
 });
 it('erases multiple completed audits, sessions, credentials and only the requesting tenant',async()=>{
  const c=await onboard('completed');await completed(c,'one.example.com');await completed(c,'two.example.com');await signIn(c.email);
  const [otherGrant]=await db.insert(s.googleAccounts).values({tenantId:bob.context.tenantId,userId:bob.context.userId,googleSubject:'shared-google',encryptedRefreshToken:'BOB-CREDENTIAL',scopes:'readonly',connectedAt:new Date()}).returning();
  await db.insert(s.googleAccounts).values({tenantId:c.context.tenantId,userId:c.context.userId,googleSubject:'shared-google',encryptedRefreshToken:'DISPOSABLE-CREDENTIAL',scopes:'readonly',connectedAt:new Date()});
  const before=await db.select().from(s.audits).where(eq(s.audits.tenantId,bob.context.tenantId));
  const fetchSpy=vi.spyOn(globalThis,'fetch');
  try {expect((await call(deleteRoute.POST,'POST',c.cookie,{password,confirmation:'DELETE MY ACCOUNT',tenantId:bob.context.tenantId})).status).toBe(200);expect(fetchSpy).not.toHaveBeenCalled();}finally{fetchSpy.mockRestore();}
  for(const table of [s.sites,s.audits,s.pages,s.checks,s.issues,s.performanceResults,s.searchSnapshots,s.googleAccounts,s.memberships,s.usageRecords,s.activity,s.operationalEvents])expect(await db.select().from(table).where(eq(table.tenantId,c.context.tenantId))).toHaveLength(0);
  expect(await db.select().from(s.session).where(eq(s.session.userId,c.context.userId))).toHaveLength(0);expect(await db.select().from(s.account).where(eq(s.account.userId,c.context.userId))).toHaveLength(0);
  expect(await db.select().from(s.audits).where(eq(s.audits.tenantId,bob.context.tenantId))).toEqual(before);
  expect(await db.select().from(s.googleAccounts).where(eq(s.googleAccounts.id,otherGrant.id))).toEqual([otherGrant]);expect((await call(sitesRoute.GET,'GET',bob.cookie)).status).toBe(200);
 });
 it('preserves anonymous global daily usage so deletion cannot rewind shared provider budgets',async()=>{
  const c=await onboard('cost-erasure');
  await db.insert(s.usageRecords).values({id:randomUUID(),tenantId:c.context.tenantId,auditId:0,kind:'pagespeed',units:3});
  const before=await usedUnits(db,{kind:'pagespeed',since:dayStart(new Date())});await deleteAccount(db,c.context);
  expect(await usedUnits(db,{kind:'pagespeed',since:dayStart(new Date())})).toBe(before);
  expect(await db.select().from(s.usageRecords).where(eq(s.usageRecords.tenantId,c.context.tenantId))).toHaveLength(0);
  const rows=await db.select().from(s.activity).where(eq(s.activity.action,'usage.anonymised'));
  expect(rows.some(r=>r.metadata.kind==='pagespeed'&&r.metadata.units===3)).toBe(true);
  for(const row of rows){expect(row.actorId).toBeNull();expect(row.tenantId).toBeNull();expect(JSON.stringify(row)).not.toContain(c.context.userId);expect(JSON.stringify(row)).not.toContain(c.email);}
 });
 it('removes queued jobs before they can be claimed and rejects stale contexts/verified identities',async()=>{
  const c=await onboard('queued');const website=await site(c);const [identity]=await db.select().from(s.user).where(eq(s.user.id,c.context.userId));await tenantRepository(db,c.context,settings).enqueueAudit(website.id);
  await deleteAccount(db,c.context);expect(await claimJob(db,'late-worker',settings)).toBeNull();
  await expect(tenantRepository(db,c.context,settings).enqueueAudit(website.id)).rejects.toThrow('Resource unavailable');
  await expect(provisionPersonalTenant(db,identity)).rejects.toThrow('Resource unavailable');
 });
 it('invalidates running audit/Google leases so late progress/completion/retry cannot resurrect rows',async()=>{
  const c=await onboard('running');const website=await site(c);await tenantRepository(db,c.context,settings).enqueueAudit(website.id);const lease=await claimJob(db,'deletion-worker',settings);expect(lease).not.toBeNull();
  await db.insert(s.searchConsoleJobs).values({id:randomUUID(),tenantId:c.context.tenantId,siteId:website.id});const refresh=await claimRefresh(db,'deletion-worker');expect(refresh).not.toBeNull();
  await deleteAccount(db,c.context);expect(await heartbeat(db,lease!)).toBeNull();expect(await reportProgress(db,lease!,99,'late')).toBe(false);
  const write=vi.fn();await expect(completeJob(db,lease!,write)).rejects.toThrow('lease');expect(write).not.toHaveBeenCalled();expect(await failJob(db,lease!,{message:'late',retryable:true})).toBe('stale');
  await expect(completeRefresh(db,refresh!,write)).rejects.toThrow('lease');expect(await failRefresh(db,refresh!,{message:'late',retryable:true})).toBe('stale');
  await recoverExpiredJobs(db);expect(await db.select().from(s.audits).where(eq(s.audits.tenantId,c.context.tenantId))).toHaveLength(0);
 });
 it('serialises concurrent deletion requests and produces one receipt',async()=>{
  const c=await onboard('concurrent');const results=await Promise.all([deleteAccount(db,c.context),deleteAccount(db,c.context)]);expect(results).toEqual([{deleted:true},{deleted:true}]);
  expect(await db.select().from(s.deletionRecords).where(eq(s.deletionRecords.userHash,deletionHash(c.context.userId)))).toHaveLength(1);
 });
});

describe('G6 retention policy',()=>{
 it('defaults to a read-only preview and refuses destructive execution without policy review',async()=>{
  const before=await db.execute(sql`select count(*)::int n from auth_user`);const r=await retentionMaintenance(db);expect(r.mode).toBe('preview');expect(r.policy.approved).toBe(false);expect(await db.execute(sql`select count(*)::int n from auth_user`)).toEqual(before);
  await expect(retentionMaintenance(db,{execute:true})).rejects.toThrow('review');
  await expect(retentionMaintenance(db,{env:{PHASE2_RETENTION_BACKUPS_DAYS:'100'}})).rejects.toThrow('outlive');
 });
 it('applies reviewed cleanup only to old terminal rows and preserves live jobs/usage',async()=>{
  const c=await onboard('retention');const old=new Date('2020-01-01');const {audit,website}=await completed(c,'retention.example.com');await db.update(s.audits).set({createdAt:old,aiGeneratedAt:old}).where(eq(s.audits.id,audit.id));
  const active=await tenantRepository(db,c.context,settings).enqueueAudit(website.id);await db.update(s.audits).set({createdAt:old}).where(eq(s.audits.id,active.id));
  await retentionMaintenance(db,{execute:true,confirmation:'APPLY g6-draft-1',env:{PHASE2_RETENTION_APPROVED_REVISION:'g6-draft-1'}});
  expect(await db.select().from(s.audits).where(eq(s.audits.id,audit.id))).toHaveLength(0);expect(await db.select().from(s.audits).where(eq(s.audits.id,active.id))).toHaveLength(1);expect(await db.select().from(s.usageRecords).where(eq(s.usageRecords.auditId,active.id))).toHaveLength(1);
 });
});
