"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Two-step delete (no browser confirm dialog): first click arms, second deletes. */
export function DeleteAuditButton({ auditId }: { auditId: number }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const remove = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    const res = await fetch(`/api/audits/${auditId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error ?? "Couldn't delete the audit.");
    toast.success(`Audit #${auditId} deleted`);
    router.refresh();
  };
  return (
    <Button variant={armed ? "destructive" : "ghost"} size="sm" onClick={remove} aria-label={`Delete audit ${auditId}`}>
      <Trash2 />
      {armed ? "Confirm delete" : ""}
    </Button>
  );
}
