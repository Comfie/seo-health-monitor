import { auditError, auditId, auditsFor, throttle, type IdContext } from "@/lib/saas/audit-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

/** Queues a PageSpeed-only re-test of a completed audit; the worker charges each test to the budget. */
export async function POST(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = await auditId(context);
    if (!id) return denied();
    const limited = await throttle(runtime, tenant, "pagespeed", 10, 60 * 60_000);
    if (limited) return limited;
    try {
      await auditsFor(runtime, tenant).rerunPagespeed(id);
      return betaJson(202, { queued: true });
    } catch (error) {
      return auditError(error);
    }
  });
}
