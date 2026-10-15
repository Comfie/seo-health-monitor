"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function SignOutButton({ beta = false }: { beta?: boolean }) {
  const router = useRouter();
  const signOut = async () => {
    // Beta sessions are revoked server-side by the auth library, not just cleared.
    if (beta) await fetch("/api/beta/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    else await fetch("/api/auth/logout", { method: "POST" });
    router.replace(beta ? "/beta/login" : "/login");
    router.refresh();
  };
  return (
    <button onClick={signOut} className="mt-auto flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
      <LogOut className="size-4" aria-hidden />
      Sign out
    </button>
  );
}
