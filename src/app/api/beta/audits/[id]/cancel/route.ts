import { auditError, auditId, auditsFor, type IdContext } from "@/lib/saas/audit-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

export async function POST(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = await auditId(context);
    if (!id) return denied();
    try {
      return betaJson(200, { outcome: await auditsFor(runtime, tenant).cancel(id) });
    } catch (error) {
      return auditError(error);
    }
  });
}
