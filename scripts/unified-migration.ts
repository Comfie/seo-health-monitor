// Offline operator command. Never imported by startup, build, web handlers or workers.
// Provision/review the isolated database and roles first; final production cutover needs approval.
import fs from 'node:fs';
import path from 'node:path';
import {sql} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {createSaasDb, type SaasDb} from '../src/lib/saas/db';
import {seedUnifiedOwner, type UnifiedOwner} from '../src/lib/saas/unified-owner';
import {importSqliteBackup} from '../src/lib/saas/import-sqlite';
import {verifySqliteBackup} from './verify-sqlite-backup';

function privateInput(file:string|undefined) {
  if(!file)throw Error('Private input required');
  const resolved=path.resolve(file),root=path.resolve('.');
  if(resolved.startsWith(root+path.sep)||fs.statSync(resolved).mode&0o077)throw Error('Inputs must be private and outside the repository');
  return resolved;
}
async function main(){
  const [action,...args]=process.argv.slice(2);
  const confirmation=args.pop();
  const [backupFile,ownerFile]=args;
  const connection=process.env.UNIFIED_DATABASE_URL;
  if(!connection||process.env.PHASE2_DATABASE_PURPOSE!=='unified-production')throw Error('Explicit unified target required');
  const target=new URL(connection);
  if(!['postgres:','postgresql:'].includes(target.protocol)||target.pathname!=='/seo_health_production'||connection===process.env.STAGING_DATABASE_URL||connection===process.env.PHASE2_DATABASE_URL)throw Error('Dedicated production logical database required');
  if(confirmation!==`--confirm-unified=${target.hostname}${target.pathname}`)throw Error('Confirm the exact database');
  if(!['migrate','import','check'].includes(action))throw Error('Unknown action');
  if(args.length!==(action==='import'?2:0))throw Error('Unexpected arguments');
  const db=createSaasDb(connection);
  try{
    if(action==='migrate'){
      await migrate(db,{migrationsFolder:'drizzle-saas'});
      console.log(JSON.stringify({schemaMigrated:true,applicationDeployed:false}));
    }else if(action==='check'){
      const result=await db.execute(sql`select (select count(*)::int from auth_user) users,(select count(*)::int from administrators) administrators,(select count(*)::int from sites) websites,(select count(*)::int from audits) audits,(select count(*)::int from drizzle.__drizzle_migrations) migrations`);
      console.log(JSON.stringify(result.rows[0]));
    }else{
      const backup=privateInput(backupFile),ownerPath=privateInput(ownerFile);
      const verified=verifySqliteBackup(backup);
      if(verified.integrity!=='ok'||verified.foreignKeyViolations||verified.googleTokens.decryptable!==verified.googleTokens.total)throw Error('Backup verification required');
      const owner=JSON.parse(fs.readFileSync(ownerPath,'utf8')) as UnifiedOwner;
      const tokenSecret=process.env.PHASE2_GOOGLE_TOKEN_SECRET;
      if(!tokenSecret||tokenSecret.length<32||!process.env.UNIFIED_OWNER_EMAIL)throw Error('Owner confirmation and independent token key required');
      const result=await db.transaction(async tx=>{
        await seedUnifiedOwner(tx as unknown as SaasDb,owner,process.env.UNIFIED_OWNER_EMAIL!);
        return importSqliteBackup(tx as unknown as SaasDb,backup,owner.tenantId,owner.userId,{googleTokenSecret:tokenSecret});
      });
      console.log(JSON.stringify({imported:true,...result,applicationDeployed:false}));
    }
  }finally{await db.$client.end();}
}
main().catch(()=>{console.error('Unified migration failed; private diagnostics withheld. Verify the isolated target, approval, inputs and encryption keys.');process.exitCode=1;});
