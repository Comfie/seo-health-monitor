import { PrivacyLinks } from "./privacy-links";
import { Activity } from "lucide-react";
import { BrandFooter } from "@/components/app/brand-footer";

/** Same centred card as the owner sign-in page, with a beta label. */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-xl border bg-card p-8">
          <div className="mb-6 flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-md bg-sidebar text-sidebar-primary">
              <Activity className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-heading text-xl font-semibold leading-tight">SEO Health Monitor</p>
              <p className="text-xs font-medium text-muted-foreground">Private beta</p>
            </div>
          </div>
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
          <PrivacyLinks />
        </div>
      </main>
      <BrandFooter />
    </div>
  );
}

export function FormMessage({ tone = "error", id, children }: { tone?: "error" | "info" | "success"; id?: string; children: React.ReactNode }) {
  const color = tone === "error" ? "text-destructive" : tone === "success" ? "text-sev-pass" : "text-muted-foreground";
  return <p id={id} role={tone === "error" ? "alert" : "status"} className={`text-sm ${color}`}>{children}</p>;
}
