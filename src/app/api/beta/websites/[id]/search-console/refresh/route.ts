import { parseId, throttle, type IdContext } from "@/lib/saas/audit-http";
import { searchConsoleError, searchConsoleFor } from "@/lib/saas/gsc-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

/** Queues a background Search Console refresh for one owned, linked website. */
export async function POST(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = parseId((await context.params).id);
    if (!id) return denied();
    try {
      await searchConsoleFor(runtime, tenant).overview(id);
      const limited = await throttle(runtime, tenant, "gsc-refresh", 10, 60 * 60_000);
      if (limited) return limited;
      return betaJson(202, await searchConsoleFor(runtime, tenant).requestRefresh(id));
    } catch (error) {
      return searchConsoleError(error);
    }
  });
}
