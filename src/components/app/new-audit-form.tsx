"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewAuditForm({ defaultUrl = "" }: { defaultUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(defaultUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `The server responded with HTTP ${res.status}.`);
      router.push(`/audits/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <label htmlFor="audit-url" className="text-sm font-medium">
        Website address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="audit-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-11 flex-1 bg-card text-base"
          aria-invalid={!!error}
          aria-describedby={error ? "audit-url-error" : "audit-url-hint"}
          required
        />
        <Button type="submit" size="lg" className="h-11 px-5" disabled={pending || !url.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : <Search />}
          {pending ? "Starting audit…" : "Run SEO audit"}
        </Button>
      </div>
      {error ? (
        <p id="audit-url-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p id="audit-url-hint" className="text-sm text-muted-foreground">
          Any public http(s) address. Private and internal network addresses are blocked.
        </p>
      )}
    </form>
  );
}
