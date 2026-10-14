import { guard } from "@/lib/security/guard";
import { NextResponse, connection } from "next/server";
import { getFullAudit } from "@/lib/audit/repository";
import { fixOptionsFrom, fixPromptForAudit } from "@/lib/reports/fix-request";

/** Markdown "Fix with Claude" prompt. ?scope=first|all&low=1&task=<action item id>&download=1 */
export async function GET(request: Request, ctx: RouteContext<"/api/audits/[id]/fix">) {
  const denied = guard(request);
  if (denied) return denied;
  await connection();
  const id = Number.parseInt((await ctx.params).id, 10);
  const full = Number.isFinite(id) ? getFullAudit(id) : null;
  if (!full || full.audit.status !== "completed") return NextResponse.json({ error: "Completed audit not found." }, { status: 404 });
  const params = new URL(request.url).searchParams;
  const body = fixPromptForAudit(full, fixOptionsFrom(params));
  const headers: Record<string, string> = { "content-type": "text/markdown; charset=utf-8" };
  if (params.get("download") === "1") headers["content-disposition"] = `attachment; filename="fix-with-claude-audit-${id}.md"`;
  return new NextResponse(body, { headers });
}
