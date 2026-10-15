import { operationsSnapshot } from '@/lib/saas/monitoring';
import { betaJson, withCustomer } from '@/lib/saas/server';
export async function GET(request: Request) {
  return withCustomer(request, async ({runtime,tenant}) => betaJson(200, await operationsSnapshot(runtime.db, tenant.userId, runtime.limits)), {admin:true});
}
