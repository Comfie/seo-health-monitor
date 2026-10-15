"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, History, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage } from "./auth-card";
import { RunAuditButton } from "./audit-actions";
import { errorText, postJson } from "./forms";

export type WebsiteRow = { id: number; host: string; displayName: string | null; url: string; createdAt: string; activeAuditId?: number | null };

export function AddWebsiteForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await postJson("/api/beta/websites", { url, displayName: name || url });
    setPending(false);
    if (!r.ok) return setError(errorText(r, "Couldn't add the website."));
    toast.success(r.data.created ? "Website added" : "That website is already in your list");
    setUrl("");
    setName("");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="url" className="text-sm font-medium">Website URL</label>
          <Input id="url" placeholder="example.com" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2048} required disabled={disabled} className="h-10 bg-card" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="display-name" className="text-sm font-medium">Display name</label>
          <Input id="display-name" placeholder="My company site" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={disabled} className="h-10 bg-card" />
        </div>
        <Button type="submit" size="lg" className="h-10" disabled={disabled || pending || !url}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add website
        </Button>
      </form>
      {error && <FormMessage>{error}</FormMessage>}
    </div>
  );
}

function WebsiteItem({ site }: { site: WebsiteRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.displayName ?? site.host);
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);

  const save = async () => {
    setPending(true);
    const r = await postJson(`/api/beta/websites/${site.id}`, { displayName: name }, "PATCH");
    setPending(false);
    if (!r.ok) return toast.error(errorText(r, "Couldn't rename the website."));
    setEditing(false);
    router.refresh();
  };

  // Two-step removal (no browser confirm dialog): first click arms, second removes.
  const remove = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setPending(true);
    const res = await fetch(`/api/beta/websites/${site.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) return toast.error(data.error ?? "Couldn't remove the website.");
    toast.success(`${site.displayName ?? site.host} removed`);
    router.refresh();
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input aria-label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-9 max-w-sm bg-card" autoFocus />
        ) : (
          <p className="truncate font-medium">{site.displayName ?? site.host}</p>
        )}
        <p className="truncate font-mono text-xs text-muted-foreground">{site.url}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {site.activeAuditId ? (
          <Link href={`/beta/audits/${site.activeAuditId}`} className={buttonVariants({ size: "sm", variant: "outline" })}><Loader2 className="animate-spin" />Audit running</Link>
        ) : (
          <RunAuditButton websiteId={site.id} />
        )}
        <Link href={`/beta/audits?website=${site.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })} aria-label={`Audit history for ${site.host}`}><History />History</Link>
        {editing ? (
          <>
            <Button size="sm" onClick={save} disabled={pending || !name.trim()}><Check />Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(site.displayName ?? site.host); }} aria-label="Cancel rename"><X /></Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Rename ${site.host}`}><Pencil />Rename</Button>
        )}
        <Button size="sm" variant={armed ? "destructive" : "ghost"} onClick={remove} disabled={pending} aria-label={`Remove ${site.host}`}>
          <Trash2 />
          {armed ? "Confirm remove" : "Remove"}
        </Button>
      </div>
    </li>
  );
}

export function WebsiteList({ websites }: { websites: WebsiteRow[] }) {
  if (websites.length === 0) return <p className="rounded-lg border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">No websites yet. Add one above to get started.</p>;
  return (
    <ul className="divide-y rounded-lg border bg-card text-sm">
      {websites.map((site) => <WebsiteItem key={site.id} site={site} />)}
    </ul>
  );
}
