"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BRAND_ICON as Brand, NAV_VARIANTS, type NavVariant } from "./nav";
import { BrandFooter } from "./brand-footer";

function isActive(pathname: string, href: string, destinations: string[]) {
  // Only the most specific navigation destination owns a nested page.
  if (destinations.some(other => other !== href && other.startsWith(`${href}/`) && (pathname === other || pathname.startsWith(`${other}/`)))) return false;
  if (href === "/" || href === "/beta") return pathname === href;
  if (href === "/audits") return pathname === "/audits" || (pathname.startsWith("/audits/") && pathname !== "/audits/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ variant, onNavigate }: { variant: NavVariant; onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const destinations = NAV_VARIANTS[variant].groups.flatMap(group => group.items.map(item => item.href));
  const audit = params.get("audit") ?? /^\/audits\/(\d+)/.exec(pathname)?.[1] ?? null;
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAV_VARIANTS[variant].groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-xs font-medium text-sidebar-foreground/60">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href, destinations);
              const href = item.auditScoped && audit ? `${item.href}?audit=${audit}` : item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function BrandMark({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 px-3 text-white">
      <span className="grid size-8 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
        <Brand className="size-4.5" aria-hidden />
      </span>
      <span className="font-heading text-[1.05rem] font-semibold leading-tight">SEO Health Monitor</span>
    </Link>
  );
}

/** `variant` is a string key (not the nav array) because icons cannot cross the client boundary. */
export function AppShell({ children, signOut, variant = "legacy" }: { children: React.ReactNode; signOut?: React.ReactNode; variant?: NavVariant }) {
  const [open, setOpen] = useState(false);
  const home = NAV_VARIANTS[variant].home;
  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-60 shrink-0 bg-sidebar lg:block">
        <div className="sticky top-0 flex h-screen flex-col gap-8 overflow-y-auto px-3 py-5">
          <BrandMark href={home} />
          <Suspense>
            <NavLinks variant={variant} />
          </Suspense>
          {signOut}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b bg-sidebar px-4 py-3 lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="text-white hover:bg-sidebar-accent" aria-label="Open navigation" />}>
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0 py-5">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex flex-col gap-8 px-3">
                <BrandMark href={home} />
                <Suspense>
                  <NavLinks variant={variant} onNavigate={() => setOpen(false)} />
                </Suspense>
                {signOut}
              </div>
            </SheetContent>
          </Sheet>
          <span className="font-heading font-semibold text-white">SEO Health Monitor</span>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
        <BrandFooter />
      </div>
    </div>
  );
}
