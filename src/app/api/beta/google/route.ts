import { searchConsoleFor } from "@/lib/saas/gsc-http";
import { betaJson, withCustomer } from "@/lib/saas/server";

/** This account's Google connection and property links (no token material). */
export async function GET(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => betaJson(200, await searchConsoleFor(runtime, tenant).status()));
}
