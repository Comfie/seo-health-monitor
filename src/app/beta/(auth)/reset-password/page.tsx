import { Suspense } from "react";
import { AuthCard } from "@/components/beta/auth-card";
import { ResetPasswordForm } from "@/components/beta/forms";
import { requireBetaRuntime } from "@/lib/saas/page";

export const metadata = { title: "Create a new password" };

async function Gate() {
  await requireBetaRuntime();
  return <ResetPasswordForm />;
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Create a new password" description="Choose a strong password you don't use anywhere else.">
      <Suspense>
        <Gate />
      </Suspense>
    </AuthCard>
  );
}
