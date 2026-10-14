import { guard } from "@/lib/security/guard";
import { NextResponse } from "next/server";
import { getFullAudit, saveAiReport } from "@/lib/audit/repository";
import { AiUnavailableError, generateConsultantReport } from "@/lib/ai/consultant";
import { checkLimits, clientKey } from "@/lib/rate-limit";

const COOLDOWN_MS = 2 * 60_000;
const inFlight = ((globalThis as unknown as { __aiInFlight?: Set<number> }).__aiInFlight ??= new Set<number>());

export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/audits/[id]/ai">) {
  const denied = guard(req);
  if (denied) return denied;
  const id = Number.parseInt((await ctx.params).id, 10);
  const full = Number.isFinite(id) ? getFullAudit(id) : null;
  if (!full) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  if (full.audit.status !== "completed") return NextResponse.json({ error: "The audit must complete before the AI consultant can review it." }, { status: 409 });
  // Paid API: reuse the stored report unless regeneration is explicitly requested.
  const regenerate = new URL(req.url).searchParams.get("regenerate") === "1";
  if (full.audit.aiReport && !regenerate) return NextResponse.json({ report: full.audit.aiReport, model: full.audit.aiModel, cached: true });
  if (full.audit.aiGeneratedAt && Date.now() - full.audit.aiGeneratedAt.getTime() < COOLDOWN_MS) {
    return NextResponse.json({ error: "This report was generated moments ago. Wait two minutes before regenerating." }, { status: 429 });
  }
  if (inFlight.has(id)) return NextResponse.json({ error: "A report for this audit is already being generated." }, { status: 409 });
  const limit = checkLimits(clientKey(req.headers), "ai", { max: 10, windowMs: 60 * 60_000 }, { max: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: `AI report limit reached. Try again in ${Math.ceil(limit.retryAfterMs / 60_000)} minutes.` }, { status: 429 });

  inFlight.add(id);
  try {
    const { report, model } = await generateConsultantReport(full);
    saveAiReport(id, report, model);
    return NextResponse.json({ report, model });
  } catch (err) {
    if (err instanceof AiUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error(err);
    return NextResponse.json({ error: "The AI consultant failed unexpectedly." }, { status: 500 });
  } finally {
    inFlight.delete(id);
  }
}
