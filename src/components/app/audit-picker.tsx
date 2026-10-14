"use client";

import { usePathname, useRouter } from "next/navigation";

export interface PickerAudit {
  id: number;
  host: string;
  completedAt: string | null;
  overallScore: number | null;
}

export function AuditPicker({ audits, current }: { audits: PickerAudit[]; current: number }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Audit</span>
      <select
        className="h-8 max-w-[18rem] rounded-md border border-input bg-card px-2 text-sm"
        value={current}
        onChange={(e) => router.push(`${pathname}?audit=${e.target.value}`)}
      >
        {audits.map((a) => (
          <option key={a.id} value={a.id}>
            #{a.id} {a.host} · {a.completedAt ? new Date(a.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""} · {a.overallScore ?? "–"}
          </option>
        ))}
      </select>
    </label>
  );
}
