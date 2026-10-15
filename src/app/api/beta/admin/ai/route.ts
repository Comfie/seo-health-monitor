import { setAiPaused } from '@/lib/saas/administration';
import { betaJson, withCustomer, hitBetaLimit } from '@/lib/saas/server';
/** Administrator kill switch: pauses or resumes AI consultant reports for every account. */
export async function POST(request: Request) {
  return withCustomer(request, async ({runtime, tenant}) => {
    const limit = await hitBetaLimit(runtime.db, `admin:${tenant.userId}`, 60, 60_000);
    if (!limit.allowed) return betaJson(429, {error: 'Please wait before making more changes.'}, {'retry-after': String(limit.retryAfterSeconds)});
    const body = await request.json().catch(() => null) as {paused?: unknown} | null;
    if (typeof body?.paused !== 'boolean') return betaJson(400, {error: 'Choose whether AI reports are paused.'});
    return betaJson(200, await setAiPaused(runtime.db, tenant.userId, body.paused));
  }, {admin: true});
}
