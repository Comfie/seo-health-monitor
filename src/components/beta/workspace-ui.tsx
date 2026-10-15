import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const surface = "rounded-xl border border-border bg-card shadow-sm";

export function WorkspaceHero({ eyebrow, title, description, icon: Icon, actions, children }: {
  eyebrow: string; title: string; description: string; icon: LucideIcon; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return <header className="relative mb-6 overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar p-5 text-sidebar-accent-foreground shadow-sm sm:p-7">
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-sidebar-primary uppercase"><Icon className="size-4" aria-hidden />{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sidebar-foreground">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
    {children && <div className="mt-5 border-t border-sidebar-border pt-4">{children}</div>}
  </header>;
}

export function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "warning" | "danger" | "neutral" }) {
  return <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", {
    good: "border-sev-pass/20 bg-sev-pass/10 text-sev-pass",
    warning: "border-sev-medium/30 bg-sev-medium/10 text-foreground",
    danger: "border-destructive/20 bg-destructive/10 text-destructive",
    neutral: "border-border bg-muted text-muted-foreground",
  }[tone])}><span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />{children}</span>;
}

export function MetricCard({ label, value, note, icon: Icon, tone = "primary" }: {
  label: string; value: React.ReactNode; note: string; icon: LucideIcon; tone?: "primary" | "good" | "warning";
}) {
  return <div className={cn(surface, "min-w-0 p-4 sm:p-5")}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", tone === "good" ? "bg-sev-pass/10 text-sev-pass" : tone === "warning" ? "bg-sev-medium/10 text-foreground" : "bg-accent text-primary")}><Icon className="size-4" aria-hidden /></span>
    </div>
    <dd className="font-heading text-3xl font-semibold tracking-tight tabular-nums">{value}</dd>
    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{note}</p>
  </div>;
}

export function UsageMeter({ label, used, limit, format = (n: number) => n.toLocaleString('en-GB') }: { label: string; used: number; limit: number; format?: (n: number) => string }) {
  const percent = limit > 0 ? Math.min(100, used / limit * 100) : used > 0 ? 100 : 0;
  return <div>
    <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{format(used)} <span className="font-normal text-muted-foreground">/ {format(limit)}</span></span></div>
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(limit, used, 1)} aria-valuenow={used} aria-valuetext={`${format(used)} of ${format(limit)}`} className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-sev-medium" : "bg-primary")} style={{ width: `${percent}%` }} />
    </div>
  </div>;
}
