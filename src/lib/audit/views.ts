import "server-only";
import { connection } from "next/server";
import { getFullAudit, listAudits, resolveAuditId, type AuditSummary, type FullAudit } from "./repository";

export interface AuditView {
  full: FullAudit | null;
  completed: AuditSummary[];
}

/** Loads the audit a findings page should show (?audit=ID, else newest completed). */
export async function loadAuditView(searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<AuditView> {
  await connection();
  const params = await searchParams;
  const id = resolveAuditId(params.audit);
  const completed = listAudits({ status: "completed", limit: 100 });
  const full = id ? getFullAudit(id) : null;
  return { full: full && full.audit.status === "completed" ? full : null, completed };
}
