import { z } from "zod";
import { auditError, auditsFor, parseId, throttle } from "@/lib/saas/audit-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

// Only the website ID is read from the body; tenant, owner and URL come from the session and database.
const input = z.object({ websiteId: z.union([z.number().int(), z.string()]) });

/** Audit history for this account, optionally ?websiteId= for one owned website. */
export async function GET(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const raw = new URL(request.url).searchParams.get("websiteId");
    const websiteId = raw === null ? undefined : parseId(raw);
    if (websiteId === null) return denied();
    return betaJson(200, { audits: await auditsFor(runtime, tenant).history({ websiteId }) });
  });
}

export async function POST(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return betaJson(400, { error: "Choose a website to audit." });
    const websiteId = parseId(String(parsed.data.websiteId));
    if (!websiteId) return denied();
    const limited = await throttle(runtime, tenant, "audit-start", 10, 10 * 60_000);
    if (limited) return limited;
    try {
      const audit = await auditsFor(runtime, tenant).start(websiteId);
      return betaJson(202, { audit: { id: audit.id, status: audit.status } });
    } catch (error) {
      return auditError(error);
    }
  });
}
