"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RerunPerformanceButton({ auditId, label = "Re-run PageSpeed tests" }: { auditId: number; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    const res = await fetch(`/api/audits/${auditId}/performance`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) return toast.error(data.error ?? "PageSpeed re-test failed.");
    if (data.measured === 0) toast.error(`PageSpeed returned no results for ${data.total} tests. See the reasons on the page.`);
    else toast.success(`PageSpeed measured ${data.measured} of ${data.total} tests; scores updated.`);
    router.refresh();
  };
  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Gauge />}
      {pending ? "Testing (20–60s per test)…" : label}
    </Button>
  );
}
