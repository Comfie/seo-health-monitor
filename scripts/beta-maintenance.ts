// Explicit operator actions only. Never invoked by build, startup or a scheduler.
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createSaasDb } from '../src/lib/saas/db';
import { captureBackup, decryptBackup, encryptBackup, invalidateRecoveredSessions, restoreBackup } from '../src/lib/saas/backup';
import { deletionRecords } from '../src/lib/saas/operations-schema';
import { retentionMaintenance } from '../src/lib/saas/retention';
async function main(){
  const [action,file,confirmation]=process.argv.slice(2);
  const connection=action==='restore'?process.env.ISOLATED_RESTORE_DATABASE_URL:process.env.STAGING_DATABASE_URL;
  if(!connection || process.env.PHASE2_DATABASE_PURPOSE!=='staging' || connection===process.env.DATABASE_URL || connection===process.env.PRODUCTION_DATABASE_URL) throw Error('Separate explicit beta target required');
  const target=new URL(connection);
  if(action==='restore' && (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || confirmation!==`--confirm-isolated=${target.hostname}${target.pathname}`)) throw Error('Restore only to a confirmed local isolated PostgreSQL target');
  if(!['backup','deletion-ledger','restore','retention-preview','retention-apply'].includes(action)) throw Error('Unknown maintenance action');
  const db=createSaasDb(connection);
  try {
    if(action==='backup' || action==='deletion-ledger'){
      const output=resolve(file??''); if(!file || output.startsWith(resolve('.')+'/')) throw Error('Backup must be outside the repository');
      const secret=process.env.BETA_BACKUP_ENCRYPTION_SECRET??''; if(secret.length<32) throw Error('Separate encryption secret required');
      const data=await captureBackup(db); if(action==='deletion-ledger') {data.tables=data.tables.filter(t=>t.name==='account_deletion_records');data.sequences=[];} mkdirSync(resolve(output,'..'),{recursive:true,mode:0o700});writeFileSync(output,encryptBackup(data,secret),{mode:0o600,flag:'wx'});
      console.log(JSON.stringify({encrypted:true,tables:data.tables.length,createdAt:data.createdAt}));
    } else if(action==='restore') {
      if(!process.env.BETA_DELETION_LEDGER_FILE) throw Error('A current separately preserved deletion ledger is mandatory');
      const ledger=decryptBackup(readFileSync(process.env.BETA_DELETION_LEDGER_FILE),process.env.BETA_BACKUP_ENCRYPTION_SECRET??'');
      const table=ledger.tables.find(t=>t.name==='account_deletion_records');if(!table)throw Error('Deletion ledger missing');
      const records=table.rows.map(r=>({id:String(r.id),userHash:String(r.user_hash),tenantHash:String(r.tenant_hash),deletedAt:new Date(String(r.deleted_at))})) as (typeof deletionRecords.$inferSelect)[];
      console.log(await restoreBackup(db,decryptBackup(readFileSync(file),process.env.BETA_BACKUP_ENCRYPTION_SECRET??''),records));await invalidateRecoveredSessions(db);
    }
    else console.log(await retentionMaintenance(db,{execute:action==='retention-apply',confirmation:file}));
  }finally{await db.$client.end();}
}
main().catch(()=>{console.error('Beta maintenance failed; sensitive diagnostics withheld. Check the target, policy approval, encryption key and isolated schema.');process.exitCode=1;});
