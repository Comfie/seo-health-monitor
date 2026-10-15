import { auditToJson, issuesToCsv } from "@/lib/reports/export";
import { buildDeveloperTasks } from "@/lib/reports/action-plan";
import { renderAuditPdf } from "@/lib/reports/pdf";
import { auditError, auditId, auditsFor, download, throttle, type IdContext } from "@/lib/saas/audit-http";
import { auditSearchSummary } from "@/lib/saas/search-console";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

export const maxDuration = 60;

/**
 * Reports rendered on demand from the owner's tenant data. Nothing is cached or stored,
 * so there is no shareable download URL: every request repeats the ownership check.
 */
export async function GET(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = await auditId(context);
    if (!id) return denied();
    const format = new URL(request.url).searchParams.get("format") ?? "json";
    if (!["json", "csv", "md", "tasks", "pdf"].includes(format)) return betaJson(400, { error: "Unknown format. Use json, csv, md, tasks or pdf." });
    let full;
    try {
      full = await auditsFor(runtime, tenant).full(id);
    } catch (error) {
      return auditError(error);
    }
    const limited = await throttle(runtime, tenant, "export", 60, 10 * 60_000);
    if (limited) return limited;
    // The owner's own Search Console data for this website only, or an explicit "not verified".
    const searchConsole = format === "json" || format === "pdf" ? await auditSearchSummary(runtime.db, runtime.config.google, tenant, full.site.id) : undefined;
    const base = `seo-audit-${full.meta?.siteHost ?? full.site.host}-${full.audit.id}`;
    switch (format) {
      case "json":
        return new Response(JSON.stringify(auditToJson(full, { searchConsole }), null, 2), { headers: download("application/json; charset=utf-8", `${base}.json`) });
      case "csv":
        return new Response("﻿" + issuesToCsv(full), { headers: download("text/csv; charset=utf-8", `${base}.csv`) });
      case "md":
      case "tasks": {
        const md = buildDeveloperTasks(full.meta?.origin ?? full.audit.startUrl, full.audit.completedAt, full.issues);
        return new Response(md, { headers: download("text/markdown; charset=utf-8", format === "md" ? `${base}-tasks.md` : undefined) });
      }
      default:
        return new Response(new Uint8Array(await renderAuditPdf(full, { searchConsole })), { headers: download("application/pdf", `${base}.pdf`) });
    }
  });
}
