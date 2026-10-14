import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import { AppShell } from "@/components/app/app-shell";
import { SignOutButton } from "@/components/app/sign-out-button";
import { getCustomerPage } from "@/lib/saas/page";

/** Customer chrome. Pages re-derive the tenant themselves; this only picks the navigation. */
async function Frame({ children }: { children: React.ReactNode }) {
  const { isAdmin } = await getCustomerPage();
  return (
    <AppShell variant={isAdmin ? "beta-admin" : "beta"} signOut={<SignOutButton beta />}>
      {children}
    </AppShell>
  );
}

export default function CustomerLayout({ children }: LayoutProps<"/beta">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1200px] px-4 py-10"><Loading /></div>}>
      <Frame>{children}</Frame>
    </Suspense>
  );
}
