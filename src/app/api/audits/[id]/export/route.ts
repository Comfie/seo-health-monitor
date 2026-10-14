import { guard } from "@/lib/security/guard";
import { NextResponse, connection } from "next/server";
import { getFullAudit } from "@/lib/audit/repository";
import { auditToJson, issuesToCsv } from "@/lib/reports/export";
import { buildDeveloperTasks } from "@/lib/reports/action-plan";
import { renderAuditPdf } from "@/lib/reports/pdf";

export async function GET(request: Request, ctx: RouteContext<"/api/audits/[id]/export">) {
  const denied = guard(request);
  if (denied) return denied;
  await connection();
  const id = Number.parseInt((await ctx.params).id, 10);
  const full = Number.isFinite(id) ? getFullAudit(id) : null;
  if (!full) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  if (full.audit.status !== "completed") return NextResponse.json({ error: "This audit has not completed yet." }, { status: 409 });

  const format = new URL(request.url).searchParams.get("format") ?? "json";
  const host = (full.meta?.siteHost ?? full.site.host).replace(/[^a-z0-9.-]/gi, "_");
  const base = `seo-audit-${host}-${full.audit.id}`;
  const attachment = (name: string) => ({ "content-disposition": `attachment; filename="${name}"` });

  switch (format) {
    case "json":
      return new NextResponse(JSON.stringify(auditToJson(full), null, 2), { headers: { "content-type": "application/json; charset=utf-8", ...attachment(`${base}.json`) } });
    case "csv":
      return new NextResponse("﻿" + issuesToCsv(full), { headers: { "content-type": "text/csv; charset=utf-8", ...attachment(`${base}.csv`) } });
    case "tasks":
    case "md": {
      const md = buildDeveloperTasks(full.meta?.origin ?? full.audit.startUrl, full.audit.completedAt, full.issues);
      const headers: Record<string, string> = { "content-type": "text/markdown; charset=utf-8" };
      if (format === "md") Object.assign(headers, attachment(`${base}-tasks.md`));
      return new NextResponse(md, { headers });
    }
    case "pdf": {
      const pdf = await renderAuditPdf(full);
      return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", ...attachment(`${base}.pdf`) } });
    }
    default:
      return NextResponse.json({ error: "Unknown format. Use json, csv, md, tasks or pdf." }, { status: 400 });
  }
}
