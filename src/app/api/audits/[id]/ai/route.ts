import { NextResponse } from "next/server";
import { getFullAudit, saveAiReport } from "@/lib/audit/repository";
import { AiUnavailableError, generateConsultantReport } from "@/lib/ai/consultant";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/audits/[id]/ai">) {
  const id = Number.parseInt((await ctx.params).id, 10);
  const full = Number.isFinite(id) ? getFullAudit(id) : null;
  if (!full) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  if (full.audit.status !== "completed") return NextResponse.json({ error: "The audit must complete before the AI consultant can review it." }, { status: 409 });
  try {
    const { report, model } = await generateConsultantReport(full);
    saveAiReport(id, report, model);
    return NextResponse.json({ report, model });
  } catch (err) {
    if (err instanceof AiUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error(err);
    return NextResponse.json({ error: "The AI consultant failed unexpectedly." }, { status: 500 });
  }
}
