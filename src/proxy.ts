import { NextResponse, type NextRequest } from "next/server";
import { authMode, authProblem, isSameOrigin, SESSION_COOKIE, verifySessionToken } from "@/lib/security/auth";
import { readBetaConfig } from "@/lib/saas/config";
import { unifiedDestination } from "@/lib/saas/unified-routes";

/** Reachable without a session. Everything else requires one when auth is enabled. */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/health"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/**
 * Customer beta area. It has its own session cookie and tenant checks in every page and
 * handler, and never reads Phase 1 data. The owner cookie is not accepted there, and a
 * customer session is never accepted by the legacy routes below.
 */
const BETA_PUBLIC_PAGES = new Set(["/beta/login", "/beta/register", "/beta/forgot-password", "/beta/reset-password", "/beta/privacy", "/beta/terms", "/beta/data-use"]);
const BETA_COOKIES = ["shm_beta.session_token", "__Secure-shm_beta.session_token"];
const isBetaPath = (pathname: string) => pathname === "/beta" || pathname.startsWith("/beta/") || pathname.startsWith("/api/beta/");

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (MUTATING.has(request.method) && !isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
  }
  if (process.env.PHASE2_UNIFIED === "true" && !isBetaPath(pathname)) {
    const ready = readBetaConfig();
    if (ready.state !== 'ready') return NextResponse.json({ error: 'Application configuration unavailable.' }, { status: 503 });
    const destination = unifiedDestination(request.nextUrl);
    if (!destination) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const target = new URL(destination.path, ready.config.origin);
    // Keep bookmark filters and report formats; the explicit category mapping takes precedence.
    for (const [key, value] of request.nextUrl.searchParams) if (!target.searchParams.has(key)) target.searchParams.append(key, value);
    return destination.rewrite ? NextResponse.rewrite(target) : NextResponse.redirect(target, 307);
  }
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (isBetaPath(pathname)) {
    if (readBetaConfig().state === "disabled") return isApi ? NextResponse.json({ error: "Not found." }, { status: 404 }) : new NextResponse("Not found", { status: 404 });
    // Optimistic only: pages and handlers still validate the session against the database.
    if (!isApi && !BETA_PUBLIC_PAGES.has(pathname) && !BETA_COOKIES.some((name) => request.cookies.has(name))) {
      return NextResponse.redirect(new URL("/beta/login", request.url));
    }
    return NextResponse.next();
  }

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
