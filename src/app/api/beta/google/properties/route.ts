import { propertyMatchesSite } from "@/lib/integrations/search-console/google";
import { throttle } from "@/lib/saas/audit-http";
import { searchConsoleError, searchConsoleFor } from "@/lib/saas/gsc-http";
import { tenantRepository } from "@/lib/saas/repository";
import { betaJson, withCustomer } from "@/lib/saas/server";

/** Properties the account's own Google authorisation can read, with the websites each one covers. */
export async function GET(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const limited = await throttle(runtime, tenant, "gsc-properties", 30, 10 * 60_000);
    if (limited) return limited;
    try {
      const [properties, websites] = await Promise.all([searchConsoleFor(runtime, tenant).properties(), tenantRepository(runtime.db, tenant, runtime.limits).listWebsites()]);
      return betaJson(200, {
        properties: properties.map((p) => ({ ...p, websiteIds: websites.filter((w) => propertyMatchesSite(p.property, w.host)).map((w) => w.id) })),
      });
    } catch (error) {
      return searchConsoleError(error);
    }
  });
}
