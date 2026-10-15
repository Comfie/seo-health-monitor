// Designed for an operator-owned scheduler. No automatic registration or notification delivery.
import { createSaasDb } from '../src/lib/saas/db';
import { administrators } from '../src/lib/saas/schema';
import { operationsSnapshot } from '../src/lib/saas/monitoring';
async function main(){
 const connection=process.env.STAGING_DATABASE_URL;
 if(!connection || process.env.PHASE2_DATABASE_PURPOSE!=='staging' || connection===process.env.DATABASE_URL || connection===process.env.PRODUCTION_DATABASE_URL) throw Error('Separate staging target required');
 const db=createSaasDb(connection);
 try{const [admin]=await db.select({id:administrators.userId}).from(administrators).limit(1);if(!admin)throw Error('Administrator missing');
  const report=await operationsSnapshot(db,admin.id);
  // Fixed alert codes/messages and counts only: suitable for a restricted scheduler log.
  console.log(JSON.stringify({kind:'beta.monitor',at:report.checkedAt,alerts:report.alerts,webHealthy:report.webHealthy,workerHealthy:report.workerHealthy}));
  if(report.alerts.length)process.exitCode=2;
 }finally{await db.$client.end();}
}
main().catch(()=>{console.error(JSON.stringify({kind:'database.failure',at:new Date().toISOString()}));process.exitCode=2;});
