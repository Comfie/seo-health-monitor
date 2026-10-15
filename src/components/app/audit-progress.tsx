"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";

interface StatusPayload {
  status: string;
  stage: string | null;
  progress: number;
  log: string[];
  error: string | null;
}

export function AuditProgress({ auditId, initial, statusUrl = `/api/audits/${auditId}` }: { auditId: number; initial: StatusPayload; statusUrl?: string }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(statusUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { audit } = (await res.json()) as { audit: StatusPayload };
        if (stopped) return;
        setState(audit);
        setPollError(null);
        if (audit.status === "completed" || audit.status === "failed" || audit.status === "cancelled") {
          router.refresh();
          return;
        }
      } catch (err) {
        if (!stopped) setPollError(`Lost contact with the server (${(err as Error).message}); retrying…`);
      }
      if (!stopped) setTimeout(tick, 1500);
    };
    const timer = setTimeout(tick, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [statusUrl, router]);

  return (
    <div className="rounded-lg border bg-card p-6" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium">{state.stage ?? "Queued"}</p>
        <span className="font-heading text-2xl font-semibold tabular-nums">{state.progress}%</span>
      </div>
      <Progress value={state.progress} className="mt-3" />
      <p className="mt-3 text-sm text-muted-foreground">
        Crawling is deliberately polite (robots.txt respected, limited concurrency). PageSpeed tests take 20–60 seconds each, so a full audit usually takes 1–4 minutes. You can leave this page; the audit keeps running.
      </p>
      {pollError && <p className="mt-2 text-sm text-destructive">{pollError}</p>}
      {state.log.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-primary">Activity log ({state.log.length})</summary>
          <ol className="mt-2 max-h-64 overflow-y-auto rounded-md bg-muted/70 p-3 font-mono text-xs">
            {[...state.log].reverse().map((line, i) => (
              <li key={i} className="break-all">{line}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
