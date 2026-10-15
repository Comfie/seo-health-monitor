import { PrivacyLinks } from "./privacy-links";
import { Activity, Gauge, ListChecks, ScanSearch, Sparkles, type LucideIcon } from "lucide-react";
import { BrandFooter } from "@/components/app/brand-footer";

const features: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ScanSearch, title: "Website SEO audits", text: "Identify technical, on-page and other SEO issues." },
  { icon: Gauge, title: "Google performance insights", text: "PageSpeed measurements and Search Console data when connected and available." },
  { icon: ListChecks, title: "Prioritised recommendations", text: "Understand the issues and what action to take." },
  { icon: Sparkles, title: "Reports and Fix with AI", text: "Export results and generate practical instructions for AI coding tools or developers." },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-md bg-sidebar text-sidebar-primary">
        <Activity className="size-5" aria-hidden />
      </span>
      <div>
        <p className="font-heading text-lg font-semibold leading-tight">SEO Health Monitor</p>
        <p className="text-xs font-medium text-muted-foreground">Private beta · Invitation only</p>
      </div>
    </div>
  );
}

/** Product overview beside the sign-in forms; hidden on small screens. */
function Overview() {
  return (
    <aside aria-label="About SEO Health Monitor" className="relative hidden overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:w-[44%] lg:flex-col lg:justify-center xl:w-[46%]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,color-mix(in_oklab,var(--sidebar-primary)_18%,transparent),transparent_45%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(var(--sidebar-foreground)_1px,transparent_1px),linear-gradient(90deg,var(--sidebar-foreground)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
      <div className="relative mx-auto w-full max-w-lg px-10 py-16 xl:px-14">
        <h2 className="font-heading text-3xl font-semibold leading-tight tracking-tight text-sidebar-accent-foreground xl:text-[2.125rem]">
          Know what&apos;s holding your website back — and what to fix first.
        </h2>
        <ul className="mt-10 space-y-6">
          {features.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent text-sidebar-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-medium text-sidebar-accent-foreground">{title}</p>
                <p className="mt-0.5 text-sm leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-12 border-t border-sidebar-border pt-6 text-sm font-medium text-sidebar-accent-foreground">
          Clear evidence. Actionable fixes. No guesswork.
        </p>
      </div>
    </aside>
  );
}

/** Two-panel sign-in layout shared by sign-in, registration and password pages. */
export function AuthCard({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-card">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="px-4 pt-6 sm:px-10 sm:pt-8">
          <Brand />
          <p className="mt-3 max-w-md text-sm text-muted-foreground lg:hidden">SEO audits with clear evidence and actionable fixes.</p>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-10 sm:px-10 lg:items-center lg:py-10">
          <div className="w-full max-w-sm">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
            <div className="mt-7">{children}</div>
            <PrivacyLinks />
          </div>
        </main>
        <BrandFooter />
      </div>
      <Overview />
    </div>
  );
}

export function FormMessage({ tone = "error", id, children }: { tone?: "error" | "info" | "success"; id?: string; children: React.ReactNode }) {
  const color = tone === "error" ? "text-destructive" : tone === "success" ? "text-sev-pass" : "text-muted-foreground";
  return <p id={id} role={tone === "error" ? "alert" : "status"} className={`text-sm ${color}`}>{children}</p>;
}
