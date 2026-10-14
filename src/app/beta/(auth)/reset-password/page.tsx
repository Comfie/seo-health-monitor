import { Suspense } from "react";
import { AuthCard } from "@/components/beta/auth-card";
import { ResetPasswordForm } from "@/components/beta/forms";
import { requireBetaRuntime } from "@/lib/saas/page";

export const metadata = { title: "Choose a new password" };

async function Gate() {
  await requireBetaRuntime();
  return <ResetPasswordForm />;
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password">
      <Suspense>
        <Gate />
      </Suspense>
    </AuthCard>
  );
}
