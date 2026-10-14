import { Suspense } from "react";
import { AuthCard } from "@/components/beta/auth-card";
import { ForgotPasswordForm } from "@/components/beta/forms";
import { requireBetaRuntime } from "@/lib/saas/page";

export const metadata = { title: "Reset password" };

async function Gate() {
  await requireBetaRuntime();
  return <ForgotPasswordForm />;
}

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password">
      <Suspense>
        <Gate />
      </Suspense>
    </AuthCard>
  );
}
