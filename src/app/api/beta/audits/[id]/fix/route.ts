import { fixOptionsFrom, fixPromptForAudit } from "@/lib/reports/fix-request";
import { auditError, auditId, auditsFor, download, type IdContext } from "@/lib/saas/audit-http";
import { denied, withCustomer } from "@/lib/saas/server";

/**
 * Tool-neutral "Fix with AI" Markdown (Claude Code, Codex, Cursor, Copilot or a developer).
 * Crawled text is fenced and labelled as untrusted data by the shared generator.
 * ?scope=first|all&low=1&task=<action id>&download=1
 */
export async function GET(request: Request, context: IdContext) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = await auditId(context);
    if (!id) return denied();
    try {
      const full = await auditsFor(runtime, tenant).full(id);
      const params = new URL(request.url).searchParams;
      return new Response(fixPromptForAudit(full, fixOptionsFrom(params)), {
        headers: download("text/markdown; charset=utf-8", params.get("download") === "1" ? `seo-fix-tasks-audit-${full.audit.id}.md` : undefined),
      });
    } catch (error) {
      return auditError(error);
    }
  });
}
