import { guard } from "@/lib/security/guard";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { buildAuthUrl } from "@/lib/integrations/search-console/google";
import { OAUTH_COOKIE, createOAuthState } from "@/lib/integrations/search-console/oauth-state";
import { oauthClient, searchConsoleSetup } from "@/lib/integrations/search-console/service";
import { pkceChallenge } from "@/lib/security/crypto";

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const setup = searchConsoleSetup();
  if (!setup.configured) {
    return NextResponse.json({ error: `Search Console is not configured. Missing: ${setup.missing.join(", ")}.` }, { status: 503 });
  }
  const returnTo = new URL(request.url).searchParams.get("returnTo");
  const { state, verifier, cookie } = createOAuthState(returnTo ?? "/search-console");
  const response = NextResponse.redirect(buildAuthUrl(oauthClient(), state, pkceChallenge(verifier)));
  response.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: config.appUrl.startsWith("https:"),
    sameSite: "lax",
    path: "/api/integrations/google",
    maxAge: 600,
  });
  return response;
}
