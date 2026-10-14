import { AiUnavailableError, generateConsultantReport, isAiConfigured } from "@/lib/ai/consultant";
import { auditError, auditId, auditsFor, throttle, type IdContext } from "@/lib/saas/audit-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

export const maxDuration = 300;

/** AI consultant report for an owned audit, within the account's monthly and the beta's daily AI budget. */
export async function POST(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = await auditId(context);
    if (!id) return denied();
    // Refuse before any budget is reserved when the provider is not configured.
    if (!isAiConfigured()) return betaJson(503, { error: "The AI consultant is not enabled for the beta." });
    const limited = await throttle(runtime, tenant, "ai", 5, 60 * 60_000);
    if (limited) return limited;
    try {
      const regenerate = new URL(request.url).searchParams.get("regenerate") === "1";
      return betaJson(200, await auditsFor(runtime, tenant).consultantReport(id, generateConsultantReport, { regenerate }));
    } catch (error) {
      if (error instanceof AiUnavailableError) return betaJson(503, { error: error.message });
      return auditError(error);
    }
  });
}
