import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { SignOutGate } from "@/components/app/sign-out";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell
      signOut={
        <Suspense>
          <SignOutGate />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
