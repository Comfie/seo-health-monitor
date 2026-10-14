import { NextResponse, type NextRequest } from "next/server";
import { authMode, authProblem, isSameOrigin, SESSION_COOKIE, verifySessionToken } from "@/lib/security/auth";

/** Reachable without a session. Everything else requires one when auth is enabled. */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/health"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (MUTATING.has(request.method) && !isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
  }
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const mode = authMode();
  if (mode === "misconfigured") {
    const message = authProblem() ?? "Authentication is not configured.";
    return isApi ? NextResponse.json({ error: message }, { status: 503 }) : new NextResponse(`SEO Health Monitor is not configured: ${message}`, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (mode === "password" && !verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    if (isApi) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp|woff2?)$).*)"],
};
