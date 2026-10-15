"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { KeyRound, Loader2, LogIn, MailCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeNext } from "@/app/login/login-form";
import { FormMessage } from "./auth-card";

type Result = { ok: boolean; status: number; data: Record<string, unknown> };

/** JSON POST to a same-origin beta endpoint; the browser adds the Origin header checked server-side. */
export async function postJson(url: string, body: unknown, method = "POST"): Promise<Result> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: data ?? {} };
}

export const errorText = (r: Result, fallback: string) =>
  (typeof r.data.error === "string" && r.data.error) || (typeof r.data.message === "string" && r.data.message) || (r.status === 429 ? "Too many attempts. Wait a few minutes and try again." : fallback);

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Input id={id} name={id} className="h-10 bg-card" {...props} />
    </div>
  );
}

const NOTICES: Record<string, { tone: "error" | "info" | "success"; text: string }> = {
  deleted: { tone: "success", text: "Your account and active data have been deleted. All sessions have been revoked." },
  verified: { tone: "success", text: "Email verified. Sign in to open your dashboard." },
  reset: { tone: "success", text: "Password changed. Sign in with your new password." },
  unverified: { tone: "info", text: "Verify your email before signing in. Signing in sends a new link." },
  unavailable: { tone: "error", text: "This account is not available. Contact the administrator if you think this is a mistake." },
  invalid_token: { tone: "error", text: "That verification link is invalid or has expired. Sign in to receive a new one." },
  invalid_user: { tone: "error", text: "That verification link belongs to a different account. Sign out, then open the link again." },
  token_expired: { tone: "error", text: "That verification link has expired. Sign in to receive a new one." },
};

export function BetaLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(
    // Verification failures redirect with both ?verified=1 and ?error=..., so errors win.
    NOTICES[params.get("error") ? params.get("error")!.toLowerCase() : params.get("deleted") ? "deleted" : params.get("verified") ? "verified" : params.get("reset") ? "reset" : ""] ?? null,
  );
  const [pending, setPending] = useState(false);
  const target = safeNext(params.get("next"));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const r = await postJson("/api/beta/auth/sign-in/email", { email, password });
    setPending(false);
    if (r.ok) {
      router.replace(target === "/" ? "/beta" : target);
      router.refresh();
      return;
    }
    if (r.data.code === "EMAIL_NOT_VERIFIED") setMessage({ tone: "info", text: "Your email is not verified yet. We've sent a new verification link." });
    else setMessage({ tone: "error", text: r.status === 401 ? "Incorrect email or password." : errorText(r, "Sign-in failed.") });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {message && <FormMessage tone={message.tone} id="login-message">{message.text}</FormMessage>}
      <Field id="email" label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Button type="submit" size="lg" className="mt-1 h-10" disabled={pending || !email || !password}>
        {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
        Sign in
      </Button>
      <Link href="/beta/forgot-password" className="text-center text-sm text-primary hover:underline">Forgot your password?</Link>
    </form>
  );
}

export function RegisterForm({ token, email }: { token: string; email: string }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (done) {
    return (
      <div className="flex flex-col items-start gap-3 text-sm">
        <MailCheck className="size-6 text-primary" aria-hidden />
        <p>We sent a verification link to <span className="font-medium">{email}</span>. Open it within an hour to activate your account, then sign in.</p>
        <Link href="/beta/login" className="text-primary hover:underline">Go to sign in</Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords do not match.");
    setPending(true);
    setError(null);
    const r = await postJson("/api/beta/register", { token, email, name, password });
    setPending(false);
    if (r.ok) setDone(true);
    else setError(errorText(r, "Registration failed."));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field id="email" label="Email (from your invitation)" type="email" value={email} readOnly className="h-10 bg-muted" />
      <Field id="name" label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
      <Field id="password" label="Password (12+ characters)" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {error && <FormMessage>{error}</FormMessage>}
      <Button type="submit" size="lg" className="mt-1 h-10" disabled={pending || !name || password.length < 12}>
        {pending ? <Loader2 className="animate-spin" /> : <UserPlus />}
        Create account
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await postJson("/api/beta/auth/request-password-reset", { email, redirectTo: `${window.location.origin}/beta/reset-password` });
    setPending(false);
    // Same message whether or not the account exists.
    if (r.ok) setSent(true);
    else setError(errorText(r, "Couldn't send the reset email."));
  };

  if (sent) return <FormMessage tone="info">If an account exists for {email}, a reset link is on its way. It expires in 30 minutes.</FormMessage>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field id="email" label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      {error && <FormMessage>{error}</FormMessage>}
      <Button type="submit" size="lg" className="mt-1 h-10" disabled={pending || !email}>
        {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
        Send reset link
      </Button>
      <Link href="/beta/login" className="text-center text-sm text-primary hover:underline">Back to sign in</Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") ? "This reset link is invalid or has expired. Request a new one." : null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage>{error ?? "This reset link is incomplete. Request a new one."}</FormMessage>
        <Link href="/beta/forgot-password" className="text-sm text-primary hover:underline">Request a new link</Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords do not match.");
    setPending(true);
    setError(null);
    const r = await postJson("/api/beta/auth/reset-password", { token, newPassword: password });
    setPending(false);
    if (r.ok) router.replace("/beta/login?reset=1");
    else setError(r.status === 400 && r.data.code === "INVALID_TOKEN" ? "This reset link is invalid or has expired. Request a new one." : errorText(r, "Couldn't reset the password."));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field id="password" label="New password (12+ characters)" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      <Field id="confirm" label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {error && <FormMessage>{error}</FormMessage>}
      <Button type="submit" size="lg" className="mt-1 h-10" disabled={pending || password.length < 12}>
        {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
        Set new password
      </Button>
    </form>
  );
}
