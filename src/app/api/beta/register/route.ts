import { betaJson, getBeta, hitBetaLimit, notFound } from "@/lib/saas/server";
import { VERIFIED_CALLBACK } from "@/lib/saas/auth";
import { registerWithInvitation } from "@/lib/saas/registration";

/** The only way to create a beta account: a valid, unexpired, single-use invitation token. */
export async function POST(request: Request) {
  const beta = await getBeta();
  if (beta.state === "disabled") return notFound();
  if (beta.state === "misconfigured") return betaJson(503, { error: "The beta is not available." });
  const { runtime } = beta;
  if (request.headers.get("origin") !== runtime.config.origin) return betaJson(403, { error: "Cross-origin request blocked." });
  if (runtime.config.registration !== "invite-only") return betaJson(403, { error: "Registration is closed." });
  const limit = await hitBetaLimit(runtime.db, "register", 20, 3_600_000);
  if (!limit.allowed) return betaJson(429, { error: "Too many registration attempts. Try again later." }, { "retry-after": String(limit.retryAfterSeconds) });
  const body = await request.json().catch(() => null);
  const result = await registerWithInvitation(runtime.db, runtime.auth, body, request.headers, VERIFIED_CALLBACK);
  return result.ok ? betaJson(200, { ok: true }) : betaJson(result.status, { error: result.error });
}
