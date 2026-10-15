import 'server-only';
import { betaJson, hitBetaLimit, withCustomer } from './server';
import { confirmPassword, deleteAccount, exportAccount, LifecycleError } from './lifecycle';

export async function lifecycleRequest(request: Request, operation: 'export' | 'delete') {
  return withCustomer(request, async ({runtime, tenant}) => {
    const limit = await hitBetaLimit(runtime.db, `lifecycle:${tenant.userId}`, 5, 15 * 60_000);
    if (!limit.allowed) return betaJson(429, {error: 'Too many attempts. Please try again later.'}, {'retry-after': String(limit.retryAfterSeconds)});
    const body = await request.json().catch(() => null);
    if (!await confirmPassword(runtime.db, tenant.userId, body?.password)) return betaJson(403, {error: 'Confirm your current password.'});
    if (operation === 'export') {
      const data = await exportAccount(runtime.db, tenant);
      return betaJson(200, data, {'content-disposition': 'attachment; filename="seo-health-monitor-account.json"', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff'});
    }
    if (body?.confirmation !== 'DELETE MY ACCOUNT') return betaJson(400, {error: 'Type DELETE MY ACCOUNT to confirm permanent deletion.'});
    try { return betaJson(200, await deleteAccount(runtime.db, tenant)); }
    catch (e) { if (e instanceof LifecycleError) return betaJson(409, {error: e.message}); throw e; }
  });
}
