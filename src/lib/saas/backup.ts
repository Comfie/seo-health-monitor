import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SaasDb } from './db';
import { reconcileDeletionLedger } from './lifecycle';
import { deletionRecords } from './operations-schema';
import { session, verification, googleOauthStates } from './schema';

export type LogicalBackup = {version:1; createdAt:string; tables:{schema:string;name:string; rows:Record<string,unknown>[]; fingerprint:string}[]; sequences:{schema:string;name:string;lastValue:string;isCalled:boolean}[]};
const quote=(v:string)=>'"'+v.replaceAll('"','""')+'"';
const canonical=(v:unknown):string => v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';
export const fingerprint=(rows:Record<string,unknown>[])=>createHash('sha256').update(rows.map(canonical).sort().join('\n')).digest('hex');
type Executor=Pick<SaasDb,'execute'>;
async function rows<T>(db:Executor, query:string) {return (await db.execute(sql.raw(query)) as unknown as {rows:T[]}).rows;}

/** Complete public schema + migration metadata, consistent read-only transaction. No disk writes. */
export async function captureBackup(db:SaasDb):Promise<LogicalBackup> {
  return db.transaction(async tx=>{
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    await tx.execute(sql`set local timezone='UTC'`);
    const tables=await rows<{schema:string;name:string}>(tx,`select table_schema as schema,table_name as name from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','drizzle') order by table_schema,table_name`);
    const result:LogicalBackup={version:1,createdAt:new Date().toISOString(),tables:[],sequences:[]};
    for(const table of tables) {
      // PostgreSQL JSON representation preserves timestamps, numeric values, bigint and bytea.
      const data=await rows<{row:Record<string,unknown>}>(tx,`select to_jsonb(t) as row from ${quote(table.schema)}.${quote(table.name)} t`);
      const all=data.map(x=>x.row); result.tables.push({...table,rows:all,fingerprint:fingerprint(all)});
    }
    const seq=await rows<{schema:string;name:string}>(tx,`select schemaname as schema,sequencename as name from pg_sequences where schemaname in ('public','drizzle')`);
    for(const s of seq) {const [v]=await rows<{last_value:string;is_called:boolean}>(tx,`select last_value::text,is_called from ${quote(s.schema)}.${quote(s.name)}`);result.sequences.push({...s,lastValue:v.last_value,isCalled:v.is_called});}
    return result;
  });
}

/** Target must already have matching migrations and NO application rows. Never disables FKs. */
export async function restoreBackup(db:SaasDb, backup:LogicalBackup, deletionLedger: (typeof deletionRecords.$inferSelect)[] = []) {
  if(backup.version!==1) throw Error('Unsupported backup format');
  return db.transaction(async tx=>{
    await tx.execute(sql`set local timezone='UTC'`);
    const live=await rows<{schema:string;name:string}>(tx,`select table_schema as schema,table_name as name from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','drizzle')`);
    const key=(t:{schema:string;name:string})=>t.schema+'.'+t.name;
    if(live.map(key).sort().join()!==backup.tables.map(key).sort().join()) throw Error('Schema table coverage differs');
    const [migrations]=backup.tables.filter(t=>t.schema==='drizzle'&&t.name==='__drizzle_migrations');
    if(!migrations) throw Error('Migration metadata missing');
    const actual=await rows<{row:Record<string,unknown>}>(tx,'select to_jsonb(t) as row from drizzle.__drizzle_migrations t');
    // Drizzle timestamps of application differ by restore time, IDs/hashes/created_at remain the same.
    if(fingerprint(actual.map(x=>x.row))!==migrations.fingerprint) throw Error('Migration history differs');
    const dependencies=await rows<{child:string;parent:string}>(tx,`select tc.table_schema||'.'||tc.table_name child,ccu.table_schema||'.'||ccu.table_name parent from information_schema.table_constraints tc join information_schema.constraint_column_usage ccu on tc.constraint_name=ccu.constraint_name and tc.constraint_schema=ccu.constraint_schema where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'`);
    const pending=backup.tables.filter(t=>t.schema==='public'); const done=new Set<string>();
    for(const t of pending) {const [n]=await rows<{n:number}>(tx,`select count(*)::int n from ${quote(t.schema)}.${quote(t.name)}`); if(n.n) throw Error('Restore target is not empty'); if(fingerprint(t.rows)!==t.fingerprint) throw Error('Backup fingerprint mismatch');}
    while(pending.length) {
      const i=pending.findIndex(t=>dependencies.filter(d=>d.child===key(t)).every(d=>done.has(d.parent)||d.parent===key(t)));
      if(i<0) throw Error('Cyclic schema requires explicit recovery review');
      const [t]=pending.splice(i,1); const table=quote(t.schema)+'.'+quote(t.name);
      for(const row of t.rows) {
        await tx.execute(sql`insert into ${sql.raw(table)} select * from jsonb_populate_record(null::${sql.raw(table)}, ${JSON.stringify(row)}::jsonb)`);
      }
      const verify=await rows<{row:Record<string,unknown>}>(tx,`select to_jsonb(t) as row from ${table} t`);
      if(fingerprint(verify.map(x=>x.row))!==t.fingerprint) throw Error('Restore consistency mismatch');
      done.add(key(t));
    }
    for(const s of backup.sequences) await tx.execute(sql`select setval(${`${quote(s.schema)}.${quote(s.name)}` }::regclass,${s.lastValue}::bigint,${s.isCalled})`);
    const erasedAccounts=await reconcileDeletionLedger(tx as unknown as SaasDb, deletionLedger);
    return {erasedAccounts,tablesVerified:backup.tables.length,foreignKeys:'enforced throughout restore',sequences:backup.sequences.length};
  });
}

export function encryptBackup(backup:LogicalBackup, secret:string) {
  if(secret.length<32) throw Error('Separate backup encryption secret must contain at least 32 characters');
  const salt=randomBytes(16),iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',scryptSync(secret,salt,32),iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(backup),'utf8'),cipher.final()]);
  return Buffer.concat([Buffer.from('SHMBK01'),salt,iv,cipher.getAuthTag(),data]);
}
export function decryptBackup(data:Buffer,secret:string):LogicalBackup {
  if(data.subarray(0,7).toString()!=='SHMBK01') throw Error('Invalid encrypted backup');
  const decipher=createDecipheriv('aes-256-gcm',scryptSync(secret,data.subarray(7,23),32),data.subarray(23,35)); decipher.setAuthTag(data.subarray(35,51));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(51)),decipher.final()]).toString('utf8'));
}

/** Before traffic/worker startup: recovered sessions and pending OAuth/reset links are invalid. */
export async function invalidateRecoveredSessions(db:SaasDb) {
  await db.transaction(async tx=>{await tx.delete(session);await tx.delete(verification);await tx.delete(googleOauthStates);});
}
