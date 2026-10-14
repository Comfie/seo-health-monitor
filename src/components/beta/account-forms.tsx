"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Loader2, LogOut, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage } from "./auth-card";
import { errorText, postJson } from "./forms";

export function ProfileForm({ name: initial }: { name: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [pending, setPending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    const r = await postJson("/api/beta/auth/update-user", { name: name.trim() });
    setPending(false);
    if (!r.ok) return toast.error(errorText(r, "Couldn't save your name."));
    toast.success("Profile saved");
    router.refresh();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">Name</label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className="h-10 bg-card" />
      </div>
      <Button type="submit" className="h-10" disabled={pending || !name.trim() || name.trim() === initial}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />}
        Save
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError("The new passwords do not match.");
    setPending(true);
    setError(null);
    // Requires the current password; every other session is signed out.
    const r = await postJson("/api/beta/auth/change-password", { currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setPending(false);
    if (!r.ok) return setError(r.data.code === "INVALID_PASSWORD" ? "Your current password is incorrect." : errorText(r, "Couldn't change your password."));
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success("Password changed. Other sessions were signed out.");
    router.refresh();
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      {([["current-password", "Current password", current, setCurrent, "current-password"], ["new-password", "New password (12+ characters)", next, setNext, "new-password"], ["confirm-password", "Confirm new password", confirm, setConfirm, "new-password"]] as const).map(([id, label, value, set, auto]) => (
        <div key={id} className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium">{label}</label>
          <Input id={id} type="password" autoComplete={auto} value={value} onChange={(e) => set(e.target.value)} maxLength={128} required className="h-10 bg-card" />
        </div>
      ))}
      {error && <div className="sm:col-span-3"><FormMessage>{error}</FormMessage></div>}
      <div className="sm:col-span-3">
        <Button type="submit" disabled={pending || !current || next.length < 12}>
          {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Change password
        </Button>
      </div>
    </form>
  );
}

export type SessionRow = { id: string; userAgent: string | null; createdAt: string; expiresAt: string; current: boolean };

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const revoke = async (id: string) => {
    setPending(id);
    const res = await fetch(`/api/beta/account/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    setPending(null);
    if (!res.ok) return toast.error("Couldn't sign out that session.");
    toast.success("Session signed out");
    router.refresh();
  };
  const revokeOthers = async () => {
    setPending("others");
    const r = await postJson("/api/beta/auth/revoke-other-sessions", {});
    setPending(null);
    if (!r.ok) return toast.error(errorText(r, "Couldn't sign out other sessions."));
    toast.success("Other sessions signed out");
    router.refresh();
  };
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y rounded-lg border bg-card text-sm">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.userAgent ? s.userAgent.slice(0, 120) : "Unknown device"}</p>
              <p className="text-xs text-muted-foreground">Signed in {fmt(s.createdAt)} · expires {fmt(s.expiresAt)}</p>
            </div>
            {s.current ? (
              <span className="rounded bg-sev-pass/10 px-1.5 py-0.5 text-xs font-medium text-sev-pass">This device</span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => revoke(s.id)} disabled={pending !== null}><LogOut />Sign out</Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <div>
          <Button variant="outline" onClick={revokeOthers} disabled={pending !== null}>
            {pending === "others" ? <Loader2 className="animate-spin" /> : <LogOut />}
            Sign out all other sessions
          </Button>
        </div>
      )}
    </div>
  );
}
