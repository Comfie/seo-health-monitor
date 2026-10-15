import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, it, expect } from 'vitest';
import { captureBackup, encryptBackup, decryptBackup, restoreBackup } from '@/lib/saas/backup';
import { saasSchema, type SaasDb } from '@/lib/saas/db';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const secret=randomUUID()+randomUUID();
async function fixture(){const client=new PGlite();const db=drizzle(client,{schema:saasSchema}) as unknown as SaasDb;await migrate(drizzle(client),{migrationsFolder:'drizzle-saas'});return {client,db};}
describe('G6 encrypted backup and restore',()=>{
 it('covers every schema table and migration row, preserves sequence state and enforces foreign keys during restore',async()=>{
  const a=await fixture(), b=await fixture();
  try {
   await a.client.exec(`insert into auth_user(id,name,email,email_verified) values ('u','Fixture','backup@example.com',true); insert into tenants(id,name,personal_user_id) values ('t','Fixture','u'); insert into memberships values ('t','u','owner'); insert into sites(tenant_id,host,display_url) values ('t','example.com','https://example.com'); insert into audits(tenant_id,site_id,input_url,start_url,status) values ('t',1,'https://example.com','https://example.com','completed'); insert into google_accounts(tenant_id,user_id,encrypted_refresh_token,scopes,connected_at) values ('t','u','SYNTHETIC-BACKUP-CREDENTIAL','readonly',now()); select setval('sites_id_seq',100,true);`);
   const backup=await captureBackup(a.db);expect(backup.tables).toHaveLength(28);expect(backup.tables.find(t=>t.name==='__drizzle_migrations')!.rows).toHaveLength(JSON.parse(readFileSync('drizzle-saas/meta/_journal.json','utf8')).entries.length);
   const encrypted=encryptBackup(backup,secret);expect(encrypted.toString()).not.toContain('SYNTHETIC-BACKUP-CREDENTIAL');expect(decryptBackup(encrypted,secret)).toEqual(backup);
   expect(()=>decryptBackup(encrypted,secret+'x')).toThrow();const tampered=Buffer.from(encrypted);tampered[tampered.length-1]^=1;expect(()=>decryptBackup(tampered,secret)).toThrow();expect(()=>encryptBackup(backup,'short')).toThrow();
   expect(await restoreBackup(b.db,backup)).toMatchObject({tablesVerified:28,foreignKeys:'enforced throughout restore'});
   const after=await captureBackup(b.db);expect(after.tables).toEqual(backup.tables);expect(after.sequences).toEqual(backup.sequences);
   expect((await b.client.query<{id:number}>(`insert into sites(tenant_id,host,display_url) values ('t','next.example.com','https://next.example.com') returning id`)).rows[0].id).toBe(101);
   await expect(restoreBackup(b.db,backup)).rejects.toThrow('not empty');
  } finally {await a.client.close();await b.client.close();}
 },30_000);
 it('refuses missing schema coverage and corrupt rows before a restore can commit',async()=>{
  const a=await fixture(),b=await fixture();try{const backup=await captureBackup(a.db);const bad=structuredClone(backup);bad.tables.pop();await expect(restoreBackup(b.db,bad)).rejects.toThrow('coverage');
   const broken=structuredClone(backup);broken.tables.find(t=>t.name==='sites')!.fingerprint='wrong';await expect(restoreBackup(b.db,broken)).rejects.toThrow('fingerprint');
  }finally{await a.client.close();await b.client.close();}
 },30_000);
 it('applies additive 0004 to a populated G5 schema without changing existing data',async()=>{
  const path=mkdtempSync(join(tmpdir(),'seo-g6-migration-'));const c=new PGlite();const db=drizzle(c,{schema:saasSchema}) as unknown as SaasDb;
  try {
   const journal=JSON.parse(readFileSync('drizzle-saas/meta/_journal.json','utf8'));journal.entries=journal.entries.filter((e:{idx:number})=>e.idx<4);mkdirSync(join(path,'meta'));writeFileSync(join(path,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)copyFileSync('drizzle-saas/'+e.tag+'.sql',join(path,e.tag+'.sql'));
   await migrate(drizzle(c),{migrationsFolder:path});await c.exec(`insert into auth_user(id,name,email,email_verified) values ('u','G5','g5@example.com',true); insert into tenants(id,name,personal_user_id) values ('t','G5','u'); insert into memberships values ('t','u','owner'); insert into sites(tenant_id,host,display_url) values ('t','example.com','https://example.com'); insert into audits(tenant_id,site_id,input_url,start_url,status) values ('t',1,'https://example.com','https://example.com','queued');insert into background_jobs(id,tenant_id,audit_id) values ('j','t',1);insert into usage_records(id,tenant_id,audit_id,kind) values ('r','t',1,'audit');`);
   const before=await captureBackup(db);const upTo4=join(path,'g6');mkdirSync(join(upTo4,'meta'),{recursive:true});const full=JSON.parse(readFileSync('drizzle-saas/meta/_journal.json','utf8'));full.entries=full.entries.filter((e:{idx:number})=>e.idx<=4);writeFileSync(join(upTo4,'meta/_journal.json'),JSON.stringify(full));for(const e of full.entries)copyFileSync('drizzle-saas/'+e.tag+'.sql',join(upTo4,e.tag+'.sql'));await migrate(drizzle(c),{migrationsFolder:upTo4});const after=await captureBackup(db);for(const table of before.tables.filter(t=>t.schema==='public'))expect(after.tables.find(t=>t.name===table.name)).toEqual(table);
   expect(after.tables.length-before.tables.length).toBe(3);expect(readFileSync('drizzle-saas/0004_g6_operations.sql','utf8')).not.toMatch(/\b(drop|truncate|rename|alter column|delete|update)\b(?! cascade| no action)/i);
  }finally{await c.close();rmSync(path,{recursive:true,force:true});}
 },30_000);
});

describe('G6 restore erasure safeguards',()=>{
 it('reapplies a newer deletion ledger to an older backup without erasing another account',async()=>{
  const a=await fixture(),b=await fixture();try{
   await a.client.exec(`insert into auth_user(id,name,email,email_verified) values ('deleted-u','Deleted','deleted@example.com',true),('kept-u','Kept','kept@example.com',true); insert into tenants(id,name,personal_user_id) values ('deleted-t','Deleted','deleted-u'),('kept-t','Kept','kept-u'); insert into memberships values ('deleted-t','deleted-u','owner'),('kept-t','kept-u','owner');insert into sites(tenant_id,host,display_url) values ('deleted-t','deleted.example.com','https://deleted.example.com'),('kept-t','kept.example.com','https://kept.example.com');`);
   const {deletionHash}=await import('@/lib/saas/lifecycle');const backup=await captureBackup(a.db);
   const result=await restoreBackup(b.db,backup,[{id:randomUUID(),userHash:deletionHash('deleted-u'),tenantHash:deletionHash('deleted-t'),deletedAt:new Date()}]);expect(result.erasedAccounts).toBe(1);
   expect((await b.client.query<{id:string}>('select id from auth_user')).rows).toEqual([{id:'kept-u'}]);expect((await b.client.query<{host:string}>('select host from sites')).rows).toEqual([{host:'kept.example.com'}]);
  }finally{await a.client.close();await b.client.close();}
 },30_000);
});
