import { Suspense } from "react";
import Link from "next/link";
import { AuthCard, FormMessage } from "@/components/beta/auth-card";
import { RegisterForm } from "@/components/beta/forms";
import { lookupInvitationToken } from "@/lib/saas/invitations";
import { requireBetaRuntime } from "@/lib/saas/page";

export const metadata = { title: "Create your beta account" };

async function Invitation({ searchParams }: PageProps<"/beta/register">) {
  const runtime = await requireBetaRuntime();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const invite = runtime.config.registration === "invite-only" && token ? await lookupInvitationToken(runtime.db, token) : null;
  if (!invite) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage>This invitation is invalid, expired or has already been used. Ask the administrator for a new invitation.</FormMessage>
        <Link href="/beta/login" className="text-sm text-primary hover:underline">Already registered? Sign in</Link>
      </div>
    );
  }
  return <RegisterForm token={token} email={invite.email} />;
}

export default function RegisterPage(props: PageProps<"/beta/register">) {
  return (
    <AuthCard title="Accept your invitation to get started" description="Create your account with the email address your invitation was sent to.">
      <Suspense>
        <Invitation {...props} />
      </Suspense>
    </AuthCard>
  );
}
