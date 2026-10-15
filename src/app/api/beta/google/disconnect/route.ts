import { searchConsoleError, searchConsoleFor } from "@/lib/saas/gsc-http";
import { betaJson, withCustomer } from "@/lib/saas/server";

/** Deletes this account's Google credential and property links; revokes the grant where safe. */
export async function POST(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    try {
      return betaJson(200, await searchConsoleFor(runtime, tenant).disconnect());
    } catch (error) {
      return searchConsoleError(error);
    }
  });
}
