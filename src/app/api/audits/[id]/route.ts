import { guard } from "@/lib/security/guard";
import { NextResponse, connection } from "next/server";
import { deleteAudit, getAuditRow } from "@/lib/audit/repository";
import { isAuditRunningHere } from "@/lib/audit/queue";

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(req: Request, ctx: RouteContext<"/api/audits/[id]">) {
  const denied = guard(req);
  if (denied) return denied;
  await connection();
  const id = parseId((await ctx.params).id);
  const audit = id ? getAuditRow(id) : null;
  if (!audit) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  const { meta: _meta, aiReport: _ai, ...summary } = audit;
  return NextResponse.json({ audit: summary });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/audits/[id]">) {
  const denied = guard(req);
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  const audit = id ? getAuditRow(id) : null;
  if (!audit || !id) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  if (audit.status === "running" && isAuditRunningHere(audit.id)) {
    return NextResponse.json({ error: "This audit is still running; wait for it to finish before deleting it." }, { status: 409 });
  }
  deleteAudit(id);
  return NextResponse.json({ deleted: id });
}
