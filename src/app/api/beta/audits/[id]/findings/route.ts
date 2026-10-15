import { CATEGORIES, type Category } from "@/lib/audit/types";
import { auditError, auditId, auditsFor, type IdContext } from "@/lib/saas/audit-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

/** Checks, issues and PageSpeed results of a completed audit; ?category= narrows them. */
export async function GET(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = await auditId(context);
    if (!id) return denied();
    const raw = new URL(request.url).searchParams.get("category");
    if (raw !== null && !CATEGORIES.includes(raw as Category)) return betaJson(400, { error: "Unknown category." });
    try {
      const { checks, issues, performance } = await auditsFor(runtime, tenant).findings(id, (raw ?? undefined) as Category | undefined);
      // Internal row, audit and tenant identifiers are never sent to the browser.
      const strip = (row: object) => { const { id: _i, tenantId: _t, auditId: _a, ...rest } = row as Record<string, unknown>; return rest; };
      return betaJson(200, { checks: checks.map(strip), issues: issues.map(strip), performance: performance.map(strip) });
    } catch (error) {
      return auditError(error);
    }
  });
}
