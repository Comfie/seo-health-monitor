import { auditError, auditsFor, parseId } from "@/lib/saas/audit-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

/** ?a=&b= : two completed audits of the same website, both owned by this account. */
export async function GET(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const params = new URL(request.url).searchParams;
    const a = parseId(params.get("a"));
    const b = parseId(params.get("b"));
    if (!a || !b) return denied();
    try {
      const { older, newer, result } = await auditsFor(runtime, tenant).compare(a, b);
      return betaJson(200, { previous: { id: older.audit.id, completedAt: older.audit.completedAt }, current: { id: newer.audit.id, completedAt: newer.audit.completedAt }, comparison: result });
    } catch (error) {
      return auditError(error);
    }
  });
}
