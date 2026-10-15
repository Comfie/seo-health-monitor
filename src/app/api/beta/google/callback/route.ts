import { NextResponse } from "next/server";
import { readCookie, searchConsoleFor } from "@/lib/saas/gsc-http";
import { GSC_BROWSER_COOKIE, googleCookiePath, SEARCH_PAGE, SearchConsoleError, type CallbackOutcome } from "@/lib/saas/search-console";
import { atRequestTime, betaJson, getBeta, notFound } from "@/lib/saas/server";
import { AccessDeniedError, requireTenant } from "@/lib/saas/tenant";

/**
 * Google's redirect back to the beta. The tenant comes from the beta session (never from the
 * callback parameters); the state must have been issued to that same tenant, user, session and
 * browser, and is single-use. Only an outcome code goes back to the page: no Google response
 * text, code or token is reflected or logged.
 */
export async function GET(request: Request) {
  await atRequestTime();
  const beta = await getBeta();
  if (beta.state === "disabled") return notFound();
  if (beta.state === "misconfigured") return betaJson(503, { error: "The beta is not available." });
  const { runtime } = beta;
  const finish = (location: string) => {
    const response = NextResponse.redirect(new URL(location, runtime.config.origin), 303);
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    response.cookies.set(GSC_BROWSER_COOKIE, "", { httpOnly: true, secure: runtime.config.origin.startsWith("https:"), sameSite: "lax", path: googleCookiePath(runtime.config.google), maxAge: 0 });
    return response;
  };

  let tenant;
  try {
    tenant = await requireTenant(runtime.db, runtime.auth, request.headers);
  } catch (error) {
    if (error instanceof AccessDeniedError) return finish("/beta/login");
    throw error;
  }
  const session = await runtime.auth.api.getSession({ headers: request.headers });
  if (!session) return finish("/beta/login");

  const params = new URL(request.url).searchParams;
  let result: { outcome: CallbackOutcome | SearchConsoleError["code"]; returnTo: string };
  try {
    result = await searchConsoleFor(runtime, tenant).completeAuthorisation({
      state: params.get("state"), code: params.get("code"), error: params.get("error"), sessionId: session.session.id, browserNonce: readCookie(request, GSC_BROWSER_COOKIE),
    });
  } catch (error) {
    if (error instanceof SearchConsoleError) result = { outcome: error.code, returnTo: SEARCH_PAGE };
    else if (error instanceof AccessDeniedError) return finish("/beta/login?error=unavailable");
    else {
      console.error(`[beta-google] callback failed: ${(error as Error)?.name ?? "Error"}`);
      result = { outcome: "failed", returnTo: SEARCH_PAGE };
    }
  }
  return finish(`${result.returnTo}${result.returnTo.includes("?") ? "&" : "?"}gsc=${result.outcome}`);
}
