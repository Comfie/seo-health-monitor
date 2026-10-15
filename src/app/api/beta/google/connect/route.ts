import { NextResponse } from "next/server";
import { throttle } from "@/lib/saas/audit-http";
import { searchConsoleFor } from "@/lib/saas/gsc-http";
import { GSC_BROWSER_COOKIE, GSC_COOKIE_PATH, SEARCH_PAGE, SearchConsoleError } from "@/lib/saas/search-console";
import { withCustomer } from "@/lib/saas/server";

/**
 * Starts Google authorisation for the signed-in account. POST only, so the canonical-Origin
 * check in withCustomer applies; the browser is sent to Google with a 303.
 */
export async function POST(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const back = (code: string) => NextResponse.redirect(new URL(`${SEARCH_PAGE}?gsc=${code}`, runtime.config.origin), 303);
    const limited = await throttle(runtime, tenant, "gsc-connect", 10, 10 * 60_000);
    if (limited) return back("busy");
    const session = await runtime.auth.api.getSession({ headers: request.headers });
    if (!session) return back("failed");
    const form = await request.formData().catch(() => null);
    const returnTo = typeof form?.get("returnTo") === "string" ? (form!.get("returnTo") as string) : null;
    try {
      const { url, browserNonce } = await searchConsoleFor(runtime, tenant).startAuthorisation({ sessionId: session.session.id, returnTo });
      const response = NextResponse.redirect(url, 303);
      response.headers.set("cache-control", "no-store");
      response.cookies.set(GSC_BROWSER_COOKIE, browserNonce, {
        httpOnly: true, secure: runtime.config.origin.startsWith("https:"), sameSite: "lax", path: GSC_COOKIE_PATH, maxAge: 600,
      });
      return response;
    } catch (error) {
      if (error instanceof SearchConsoleError) return back(error.code);
      throw error;
    }
  });
}

