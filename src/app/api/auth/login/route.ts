import { NextResponse } from "next/server";
import { z } from "zod";
import { checkLimits, clientKey } from "@/lib/rate-limit";
import { authMode, createSessionToken, isHttpsRequest, SESSION_COOKIE, SESSION_TTL_MS, verifyPassword } from "@/lib/security/auth";

const body = z.object({ password: z.string().min(1).max(500) });

export async function POST(request: Request) {
  if (process.env.PHASE2_UNIFIED === "true") return NextResponse.json({ error: "Use account sign-in." }, { status: 410 });
  if (authMode() !== "password") return NextResponse.json({ error: "Password sign-in is not enabled." }, { status: 400 });
  // Brute-force protection: per client and across all clients.
  const limit = checkLimits(clientKey(request.headers), "login", { max: 10, windowMs: 15 * 60_000 }, { max: 50, windowMs: 15 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: `Too many sign-in attempts. Try again in ${Math.ceil(limit.retryAfterMs / 60_000)} minutes.` }, { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !verifyPassword(parsed.data.password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: isHttpsRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
