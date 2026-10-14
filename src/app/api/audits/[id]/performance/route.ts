import { guard } from "@/lib/security/guard";
import { NextResponse } from "next/server";
import { checkLimits, clientKey } from "@/lib/rate-limit";
import { RerunError, rerunAuditPerformance } from "@/lib/audit/performance-rerun";

export const maxDuration = 300;

/** Re-runs PageSpeed Insights for a completed audit and recomputes its scores. */
export async function POST(request: Request, ctx: RouteContext<"/api/audits/[id]/performance">) {
  const denied = guard(request);
  if (denied) return denied;
  const limit = checkLimits(clientKey(request.headers), "psi", { max: 10, windowMs: 60 * 60_000 }, { max: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: `Too many requests. Try again in ${Math.ceil(limit.retryAfterMs / 60_000)} minutes.` }, { status: 429 });
  const id = Number.parseInt((await ctx.params).id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  try {
    const result = await rerunAuditPerformance(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RerunError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error(err);
    return NextResponse.json({ error: "PageSpeed re-test failed unexpectedly." }, { status: 500 });
  }
}
