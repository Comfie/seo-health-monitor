import type { AuditView } from "@/lib/audit/views";
import type { Category } from "@/lib/audit/types";
import { AuditPicker } from "./audit-picker";
import { toPickerAudits } from "./picker-data";
import { PageHeader } from "./page-header";
import { TONE_COLOR, formatDate, scoreTone } from "./format";

export function CategoryHeader({ view, title, description, category }: { view: AuditView; title: string; description: string; category?: Category }) {
  const full = view.full!;
  const score = category ? ((full.audit.categoryScores ?? {}) as Record<string, number | null>)[category] ?? null : undefined;
  return (
    <PageHeader
      title={title}
      description={
        <>
          {description}{" "}
          <span className="whitespace-nowrap">
            {full.meta?.siteHost ?? full.site.host} · scanned {formatDate(full.audit.completedAt)}
          </span>
        </>
      }
      actions={
        <>
          {view.completed.length > 1 && <AuditPicker audits={toPickerAudits(view.completed)} current={full.audit.id} />}
          {score !== undefined && (
            <div className="rounded-lg border bg-card px-4 py-2 text-right">
              <p className="text-xs text-muted-foreground">Category score</p>
              <p className="font-heading text-2xl font-semibold leading-tight tabular-nums" style={{ color: TONE_COLOR[scoreTone(score)] }}>
                {score ?? "—"}
                {score !== null && <span className="text-sm font-normal text-muted-foreground"> / 100</span>}
              </p>
            </div>
          )}
        </>
      }
    />
  );
}
