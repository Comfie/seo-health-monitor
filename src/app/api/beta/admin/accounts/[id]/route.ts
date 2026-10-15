import { ZodError } from 'zod';
import { changeAccount } from '@/lib/saas/administration';
import { betaJson, withCustomer, hitBetaLimit } from '@/lib/saas/server';
export async function PATCH(request: Request, {params}: {params: Promise<{id: string}>}) {
  return withCustomer(request, async ({runtime, tenant}) => {
    const limit = await hitBetaLimit(runtime.db, `admin:${tenant.userId}`, 60, 60_000);
    if (!limit.allowed) return betaJson(429, {error: 'Please wait before making more changes.'}, {'retry-after': String(limit.retryAfterSeconds)});
    const body = await request.json().catch(() => null);
    try { return betaJson(200, await changeAccount(runtime.db, tenant.userId, (await params).id, body)); }
    catch (e) { if (e instanceof ZodError) return betaJson(400, {error: 'Enter valid account settings within the beta limits.'}); throw e; }
  }, {admin: true});
}
