import { Suspense } from "react";
import { AuthCard } from "@/components/beta/auth-card";
import { BetaLoginForm } from "@/components/beta/forms";
import { requireBetaRuntime } from "@/lib/saas/page";

export const metadata = { title: "Beta sign in" };

async function Gate() {
  await requireBetaRuntime();
  return <BetaLoginForm />;
}

export default function BetaLoginPage() {
  return (
    <AuthCard title="Welcome back" description="Sign in to review your audits and what to fix next.">
      <Suspense>
        <Gate />
      </Suspense>
    </AuthCard>
  );
}
