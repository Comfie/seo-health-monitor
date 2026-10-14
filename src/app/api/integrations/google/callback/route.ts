import { guard } from "@/lib/security/guard";
import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, readOAuthState } from "@/lib/integrations/search-console/oauth-state";
import { completeConnection } from "@/lib/integrations/search-console/service";

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const saved = readOAuthState(request.cookies.get(OAUTH_COOKIE)?.value, params.get("state"));
  const back = (path: string, query: Record<string, string>) => {
    const url = new URL(path, request.url);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/integrations/google" });
    return res;
  };

  if (!saved) return back("/search-console", { error: "The sign-in session expired or didn't match. Please try connecting again." });
  if (params.get("error")) {
    const reason = params.get("error") === "access_denied" ? "Access was not granted on Google's consent screen." : "Google sign-in failed. Try connecting again.";
    return back(saved.returnTo, { error: reason });
  }
  const code = params.get("code");
  if (!code) return back(saved.returnTo, { error: "Google did not return an authorisation code." });

  try {
    await completeConnection(code, saved.verifier);
    return back(saved.returnTo, { connected: "1" });
  } catch {
    return back(saved.returnTo, { error: "Google connection failed. Check the callback URL, credentials and permissions, then reconnect." });
  }
}
