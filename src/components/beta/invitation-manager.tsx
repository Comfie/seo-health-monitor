"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Loader2, MailPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/app/copy-button";
import { cn } from "@/lib/utils";
import { FormMessage } from "./auth-card";
import { errorText, postJson } from "./forms";

export type InvitationRow = { id: string; email: string; status: "pending" | "registered" | "accepted" | "expired" | "revoked"; expiresAt: string; createdAt: string };

const STATUS: Record<InvitationRow["status"], { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-primary/10 text-primary" },
  registered: { label: "Awaiting verification", className: "bg-sev-medium/12 text-[#7a5b00]" },
  accepted: { label: "Accepted", className: "bg-sev-pass/10 text-sev-pass" },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
  revoked: { label: "Revoked", className: "bg-sev-critical/10 text-sev-critical" },
};

export function CreateInvitationForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setIssued(null);
    const r = await postJson("/api/beta/admin/invitations", { email });
    setPending(false);
    if (!r.ok) return setError(errorText(r, "Couldn't create the invitation."));
    setIssued({ email, link: String(r.data.link), emailed: r.data.emailed === true });
    setEmail("");
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-sm font-medium">Tester email</label>
          <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required disabled={!enabled} className="h-10 bg-card" />
        </div>
        <Button type="submit" className="h-10" disabled={!enabled || pending || !email}>
          {pending ? <Loader2 className="animate-spin" /> : <MailPlus />}
          Send invitation
        </Button>
      </form>
      {!enabled && <FormMessage tone="info">New invitations are disabled. Set PHASE2_INVITATIONS_ENABLED=true to allow them.</FormMessage>}
      {error && <FormMessage>{error}</FormMessage>}
      {issued && (
        <div className="rounded-md border border-primary/30 bg-accent p-3 text-sm text-accent-foreground">
          <p>
            {issued.emailed ? `Invitation emailed to ${issued.email}.` : `The email to ${issued.email} could not be sent.`} This link is shown once and is not stored; anyone with it can register as that email address only.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1 font-mono text-xs">{issued.link}</code>
            <CopyButton text={issued.link} label="Copy link" copiedMessage="Invitation link copied" />
          </div>
        </div>
      )}
    </div>
  );
}

function RevokeButton({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const revoke = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setPending(true);
    const res = await fetch(`/api/beta/admin/invitations/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) return toast.error(data.error ?? "Couldn't revoke the invitation.");
    toast.success(`Invitation for ${email} revoked`);
    router.refresh();
  };
  return (
    <Button size="sm" variant={armed ? "destructive" : "ghost"} onClick={revoke} disabled={pending} aria-label={`Revoke invitation for ${email}`}>
      <Ban />
      {armed ? "Confirm revoke" : "Revoke"}
    </Button>
  );
}

export function InvitationTable({ invitations }: { invitations: InvitationRow[] }) {
  if (invitations.length === 0) return <p className="rounded-lg border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">No invitations yet.</p>;
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <ul className="divide-y rounded-lg border bg-card text-sm">
      {invitations.map((inv) => (
        <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <span className="min-w-0 flex-1 truncate font-medium">{inv.email}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS[inv.status].className)}>{STATUS[inv.status].label}</span>
          <span className="text-xs text-muted-foreground">{inv.status === "pending" || inv.status === "expired" ? `${inv.status === "expired" ? "Expired" : "Expires"} ${fmt(inv.expiresAt)}` : `Sent ${fmt(inv.createdAt)}`}</span>
          {(inv.status === "pending" || inv.status === "registered") && <RevokeButton id={inv.id} email={inv.email} />}
        </li>
      ))}
    </ul>
  );
}
