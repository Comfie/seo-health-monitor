import { AiUnavailableError, generateConsultantReport, isAiConfigured } from "@/lib/ai/consultant";
import { auditError, auditId, auditsFor, throttle, type IdContext } from "@/lib/saas/audit-http";
import { auditSearchSummary } from "@/lib/saas/search-console";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

export const maxDuration = 300;

/** AI consultant report for an owned audit, within the account's monthly and the beta's daily AI budget. */
export async function POST(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = await auditId(context);
    if (!id) return denied();
    try {
      // Check ownership before provider availability or throttling, so foreign IDs
      // always receive the same denial as missing IDs, including when AI is disabled.
      const status = await auditsFor(runtime, tenant).status(id);
      if (!isAiConfigured()) return betaJson(503, { error: "The AI consultant is not enabled for the beta." });
      const limited = await throttle(runtime, tenant, "ai", 5, 60 * 60_000);
      if (limited) return limited;
      const searchConsole = await auditSearchSummary(runtime.db, runtime.config.google, tenant, status.websiteId);
      return betaJson(200, await auditsFor(runtime, tenant).consultantReport(id, (full) => generateConsultantReport(full, { searchConsole })));
    } catch (error) {
      if (error instanceof AiUnavailableError) return betaJson(503, { error: error.message });
      return auditError(error);
    }
  });
}
