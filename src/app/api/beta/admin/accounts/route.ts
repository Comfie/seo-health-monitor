import { adminAccounts } from '@/lib/saas/administration';
import { betaJson, withCustomer } from '@/lib/saas/server';
export async function GET(request: Request) {
  return withCustomer(request, async ({runtime, tenant}) => betaJson(200, await adminAccounts(runtime.db, tenant.userId, new URL(request.url).searchParams.get('email') ?? '', runtime.limits)), {admin: true});
}
