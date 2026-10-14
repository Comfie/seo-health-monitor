import type { PickerAudit } from "./audit-picker";

/** Serialisable picker rows; lives outside the client module so server components can call it. */
export function toPickerAudits(rows: { id: number; host: string; completedAt: Date | null; overallScore: number | null }[]): PickerAudit[] {
  return rows.map((r) => ({ id: r.id, host: r.host, completedAt: r.completedAt ? r.completedAt.toISOString() : null, overallScore: r.overallScore }));
}
