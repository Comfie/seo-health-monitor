import { NextResponse } from "next/server";
import { authMode, authProblem, isAuthenticated, isSameOrigin } from "./auth";

/**
 * Defence in depth for API route handlers: the proxy already enforces auth,
 * but handlers re-check so a proxy misconfiguration can't expose them.
 * Returns a response to send, or null to continue.
 */
export function guard(request: Request): NextResponse | null {
  if (process.env.PHASE2_UNIFIED === "true") return NextResponse.json({ error: "Legacy endpoint retired. Use the account application." }, { status: 410 });
  if (authMode() === "misconfigured") return NextResponse.json({ error: authProblem() }, { status: 503 });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
  }
  if (!isAuthenticated(request)) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return null;
}
