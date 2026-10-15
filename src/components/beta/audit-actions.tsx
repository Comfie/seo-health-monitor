"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Gauge, GitCompare, Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorText, postJson } from "./forms";

/** Starts an audit of one of the customer's websites; only the website ID is sent. */
export function RunAuditButton({ websiteId, label = "Run audit", variant = "default", disabled }: { websiteId: number; label?: string; variant?: "default" | "outline"; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    const r = await postJson("/api/beta/audits", { websiteId });
    if (!r.ok) {
      setPending(false);
      return toast.error(errorText(r, "The audit could not be started."));
    }
    router.push(`/beta/audits/${(r.data.audit as { id: number }).id}`);
  };
  return (
    <Button size="sm" variant={variant} onClick={run} disabled={pending || disabled}>
      {pending ? <Loader2 className="animate-spin" /> : label === "Run audit" ? <Play /> : <RefreshCw />}
      {label}
    </Button>
  );
}

export function CancelAuditButton({ auditId, requested }: { auditId: number; requested: boolean }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(requested);
  // Two-step confirmation instead of a browser dialog.
  const cancel = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setPending(true);
    const r = await postJson(`/api/beta/audits/${auditId}/cancel`, {});
    if (!r.ok) {
      setPending(false);
      return toast.error(errorText(r, "The audit could not be cancelled."));
    }
    toast.success(r.data.outcome === "cancelled" ? "Audit cancelled" : "Stopping the audit…");
    router.refresh();
  };
  return (
    <Button size="sm" variant={armed ? "destructive" : "outline"} onClick={cancel} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Ban />}
      {pending ? "Cancelling…" : armed ? "Confirm cancel" : "Cancel audit"}
    </Button>
  );
}

export function RerunPagespeedButton({ auditId, active }: { auditId: number; active: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    const r = await postJson(`/api/beta/audits/${auditId}/pagespeed`, {});
    setPending(false);
    if (!r.ok) return toast.error(errorText(r, "The PageSpeed re-test could not be queued."));
    toast.success("PageSpeed re-test queued. Results replace the current performance findings when it finishes.");
    router.refresh();
  };
  return (
    <Button variant="outline" onClick={run} disabled={pending || active}>
      {pending || active ? <Loader2 className="animate-spin" /> : <Gauge />}
      {active ? "PageSpeed re-test running…" : "Re-run PageSpeed tests"}
    </Button>
  );
}

export function AiReportButton({ auditId, hasReport }: { auditId: number; hasReport: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    const r = await postJson(`/api/beta/audits/${auditId}/ai${hasReport ? "?regenerate=1" : ""}`, {});
    setPending(false);
    if (!r.ok) return toast.error(errorText(r, "The AI consultant report could not be generated."));
    router.refresh();
  };
  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pending ? "Writing report (up to a few minutes)…" : hasReport ? "Regenerate AI report" : "Generate AI consultant report"}
    </Button>
  );
}

/** Pick two completed scans of the same website and open the comparison. */
export function ComparePicker({ audits }: { audits: { id: number; label: string; websiteId: number }[] }) {
  const router = useRouter();
  const [a, setA] = useState(audits[1]?.id ?? 0);
  const [b, setB] = useState(audits[0]?.id ?? 0);
  const site = (id: number) => audits.find((x) => x.id === id)?.websiteId;
  const valid = a && b && a !== b && site(a) === site(b);
  const select = (value: number, set: (n: number) => void, label: string) => (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <select className="h-9 rounded-md border bg-card px-2" value={value} onChange={(e) => set(Number(e.target.value))}>
        {audits.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </label>
  );
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
      {select(a, setA, "Previous scan")}
      {select(b, setB, "Current scan")}
      <Button onClick={() => router.push(`/beta/audits/compare?a=${a}&b=${b}`)} disabled={!valid}>
        <GitCompare />
        Compare
      </Button>
      {!valid && a !== b && <p className="text-sm text-muted-foreground">Choose two scans of the same website.</p>}
    </div>
  );
}
