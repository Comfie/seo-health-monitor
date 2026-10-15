"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";

async function call(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

/** A real form POST (same-origin, checked server-side); the server answers with a redirect to Google. */
export function ConnectGoogleForm({ returnTo, label = "Connect with Google", variant = "default" }: { returnTo: string; label?: string; variant?: "default" | "outline" }) {
  const [pending, setPending] = useState(false);
  return (
    <form method="post" action="/api/beta/google/connect" onSubmit={() => setPending(true)}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className={buttonVariants({ variant, size: variant === "outline" ? "sm" : "default" })} disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {label}
      </button>
    </form>
  );
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
    const { ok, data } = await call("/api/beta/google/disconnect", { method: "POST" });
    setPending(false);
    if (!ok) return toast.error(String(data.error ?? "Couldn't disconnect."));
    if (data.revokedAtGoogle) toast.success("Search Console disconnected and access revoked at Google");
    else toast.success("Search Console disconnected. Stored access was deleted; you can also remove the app at myaccount.google.com/permissions.");
    router.refresh();
  };
  return (
    <Button variant={armed ? "destructive" : "outline"} size="sm" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Unlink />}
      {armed ? "Confirm disconnect" : "Disconnect Google"}
    </Button>
  );
}

export type PropertyOption = { property: string; type: "domain" | "url-prefix"; matches: boolean };

export function PropertyLinker({ websiteId, host, properties, current }: { websiteId: number; host: string; properties: PropertyOption[]; current: string | null }) {
  const router = useRouter();
  const suitable = properties.filter((p) => p.matches);
  const [value, setValue] = useState(current ?? suitable[0]?.property ?? "");
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    const { ok, data } = await call(`/api/beta/websites/${websiteId}/search-console`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ property: value }) });
    setPending(false);
    if (!ok) return toast.error(String(data.error ?? "Couldn't link the property."));
    toast.success("Property linked. Fetching your Search Console data in the background…");
    router.refresh();
  };
  const unlink = async () => {
    const { ok } = await call(`/api/beta/websites/${websiteId}/search-console`, { method: "DELETE" });
    if (ok) {
      toast.success("Property unlinked");
      router.refresh();
    }
  };
  if (!suitable.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Your connected Google account has no verified Search Console property covering <span className="font-medium">{host}</span>. Add a domain property for {host} (or a URL-prefix property on the same host) in Search Console, then reload this page.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`gsc-property-${websiteId}`} className="text-sm text-muted-foreground">Property</label>
      <select id={`gsc-property-${websiteId}`} value={value} onChange={(e) => setValue(e.target.value)} className="h-8 max-w-full rounded-md border border-input bg-card px-2 text-sm">
        {suitable.map((p) => (
          <option key={p.property} value={p.property}>
            {p.property} ({p.type === "domain" ? "domain property" : "URL prefix"})
          </option>
        ))}
      </select>
      <Button size="sm" onClick={save} disabled={pending || !value || value === current}>
        {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
        {current ? "Change property" : "Link property"}
      </Button>
      {current && <Button size="sm" variant="ghost" onClick={unlink}>Unlink</Button>}
    </div>
  );
}

/** Queues a background refresh and follows it until the worker finishes. */
export function RefreshSearchButton({ websiteId, active }: { websiteId: number; active: boolean }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(active);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(async () => {
      const { ok, data } = await call(`/api/beta/websites/${websiteId}/search-console`, { method: "GET" });
      if (!ok || (data.refresh !== "queued" && data.refresh !== "running")) {
        setWaiting(false);
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting, websiteId, router]);
  const run = async () => {
    const { ok, data } = await call(`/api/beta/websites/${websiteId}/search-console/refresh`, { method: "POST" });
    if (!ok) return toast.error(String(data.error ?? "Couldn't refresh Search Console data."));
    setWaiting(true);
  };
  return (
    <Button variant="outline" onClick={run} disabled={waiting}>
      {waiting ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {waiting ? "Fetching from Google…" : "Refresh data"}
    </Button>
  );
}
