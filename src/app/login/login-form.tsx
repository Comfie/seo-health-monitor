"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const next = params.get("next");
  const target = next && /^\/(?!\/)/.test(next) ? next : "/";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Sign-in failed.");
      setPending(false);
      return;
    }
    router.replace(target);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="password" className="text-sm font-medium">Password</label>
      <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 bg-card" aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} autoFocus required />
      {error && <p id="login-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="h-10" disabled={pending || !password}>
        {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
        Sign in
      </Button>
    </form>
  );
}
