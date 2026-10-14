import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const SEVERITY: Record<string, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-sev-critical text-white" },
  high: { label: "High", className: "bg-sev-high/15 text-[#9a4a0b] ring-1 ring-inset ring-sev-high/40" },
  medium: { label: "Medium", className: "bg-sev-medium/12 text-[#7a5b00] ring-1 ring-inset ring-sev-medium/40" },
  low: { label: "Low", className: "bg-sev-low/10 text-sev-low ring-1 ring-inset ring-sev-low/30" },
};

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const s = SEVERITY[severity] ?? { label: severity, className: "bg-muted" };
  return <span className={cn("inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold", s.className, className)}>{s.label}</span>;
}

const STATUS: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, className: "text-sev-pass" },
  warning: { label: "Warning", icon: AlertTriangle, className: "text-sev-medium" },
  fail: { label: "Fail", icon: XCircle, className: "text-sev-critical" },
  unavailable: { label: "Not verified", icon: CircleDashed, className: "text-sev-na" },
  info: { label: "Info", icon: Info, className: "text-sev-low" },
};

export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.info;
  return <s.icon className={cn("size-4.5 shrink-0", s.className, className)} aria-label={s.label} />;
}

export function StatusLabel({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.info;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", s.className)}>
      <s.icon className="size-3.5" aria-hidden />
      {s.label}
    </span>
  );
}

export function AuditStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-sev-pass/10 text-sev-pass",
    running: "bg-primary/10 text-primary",
    queued: "bg-muted text-muted-foreground",
    failed: "bg-sev-critical/10 text-sev-critical",
  };
  return <span className={cn("inline-flex rounded px-1.5 py-0.5 text-xs font-medium capitalize", map[status])}>{status}</span>;
}

export { AlertOctagon };
