"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AiConsultantButton({ auditId, configured, hasReport }: { auditId: number; configured: boolean; hasReport: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Add <code className="rounded bg-muted px-1 font-mono text-xs">ANTHROPIC_API_KEY</code> to <code className="rounded bg-muted px-1 font-mono text-xs">.env.local</code> and restart the app to enable the AI consultant. Everything else works without it.
      </p>
    );
  }

  const run = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/ai${hasReport ? "?regenerate=1" : ""}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={run} disabled={pending} variant={hasReport ? "outline" : "default"}>
        {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {pending ? "Writing report (up to a few minutes)…" : hasReport ? "Regenerate AI report" : "Generate AI consultant report"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
