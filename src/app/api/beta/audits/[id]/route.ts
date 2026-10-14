import { auditId, auditsFor, type IdContext } from "@/lib/saas/audit-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

/** Status and progress of one owned audit (polled by the progress view). */
export async function GET(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = await auditId(context);
    if (!id) return denied();
    return betaJson(200, { audit: await auditsFor(runtime, tenant).status(id) });
  });
}
