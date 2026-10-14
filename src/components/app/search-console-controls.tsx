"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

async function call(url: string, init: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, init);
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export function DisconnectGoogleButton() {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const run = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setPending(true);
    const { ok, data } = await call("/api/integrations/google/disconnect", { method: "POST" });
    setPending(false);
    if (!ok) return toast.error(String(data.error ?? "Couldn't disconnect."));
    toast.success("Search Console disconnected and access revoked");
    router.refresh();
  };
  return (
    <Button variant={armed ? "destructive" : "outline"} size="sm" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Unlink />}
      {armed ? "Confirm disconnect" : "Disconnect"}
    </Button>
  );
}

export function PropertyLinker({ siteId, properties, current, suggested }: { siteId: number; properties: string[]; current: string | null; suggested: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? suggested ?? properties[0] ?? "");
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    const { ok, data } = await call(`/api/sites/${siteId}/search-console`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ property: value }) });
    if (!ok) {
      setPending(false);
      return toast.error(String(data.error ?? "Couldn't link the property."));
    }
    toast.success("Property linked. Fetching Search Console data…");
    const refresh = await call(`/api/sites/${siteId}/search-console/refresh`, { method: "POST" });
    setPending(false);
    if (!refresh.ok) toast.error(String(refresh.data.error ?? "Linked, but the first data fetch failed."));
    router.refresh();
  };
  const unlink = async () => {
    const { ok } = await call(`/api/sites/${siteId}/search-console`, { method: "DELETE" });
    if (ok) router.refresh();
  };
  if (!properties.length) {
    return <p className="text-sm text-muted-foreground">The connected Google account has no verified Search Console properties. Verify the site in Search Console first, then reload this page.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="gsc-property" className="text-sm text-muted-foreground">Property</label>
      <select id="gsc-property" value={value} onChange={(e) => setValue(e.target.value)} className="h-8 max-w-full rounded-md border border-input bg-card px-2 text-sm">
        {properties.map((p) => (
          <option key={p} value={p}>
            {p}
            {p === suggested ? " (matches this site)" : ""}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={save} disabled={pending || !value || value === current}>
        {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
        {current ? "Change property" : "Link property"}
      </Button>
      {current && (
        <Button size="sm" variant="ghost" onClick={unlink}>
          Unlink
        </Button>
      )}
    </div>
  );
}

export function RefreshSnapshotButton({ siteId }: { siteId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    const { ok, data } = await call(`/api/sites/${siteId}/search-console/refresh`, { method: "POST" });
    setPending(false);
    if (!ok) return toast.error(String(data.error ?? "Couldn't fetch Search Console data."));
    toast.success("Search Console data updated");
    router.refresh();
  };
  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {pending ? "Fetching from Google…" : "Refresh data"}
    </Button>
  );
}
