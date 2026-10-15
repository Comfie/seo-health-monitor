import { parseId, throttle, type IdContext } from "@/lib/saas/audit-http";
import { searchConsoleError, searchConsoleFor } from "@/lib/saas/gsc-http";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

/** Stored Search Console data for one owned website (its currently linked property only). */
export async function GET(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = parseId((await context.params).id);
    if (!id) return denied();
    return betaJson(200, await searchConsoleFor(runtime, tenant).overview(id));
  });
}

/** Links the website to a property that this account's Google authorisation can read. */
export async function POST(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = parseId((await context.params).id);
    if (!id) return denied();
    const body = (await request.json().catch(() => null)) as { property?: unknown } | null;
    try {
      // Ownership first, so a foreign website ID gets the same 404 before any throttling or Google call.
      await searchConsoleFor(runtime, tenant).overview(id);
      const limited = await throttle(runtime, tenant, "gsc-link", 20, 60 * 60_000);
      if (limited) return limited;
      return betaJson(200, await searchConsoleFor(runtime, tenant).link(id, body?.property));
    } catch (error) {
      return searchConsoleError(error);
    }
  });
}

export async function DELETE(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = parseId((await context.params).id);
    if (!id) return denied();
    return betaJson(200, await searchConsoleFor(runtime, tenant).unlink(id));
  });
}
