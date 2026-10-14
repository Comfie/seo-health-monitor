import { Suspense } from "react";
import { and, desc, eq, gt } from "drizzle-orm";
import Loading from "@/app/(app)/loading";
import { PageHeader, Section } from "@/components/app/page-header";
import { PasswordForm, ProfileForm, SessionList } from "@/components/beta/account-forms";
import { session } from "@/lib/saas/auth-schema";
import { getCustomerPage } from "@/lib/saas/page";

export const metadata = { title: "Account settings" };

async function AccountContent() {
  const { runtime, tenant, user, sessionId } = await getCustomerPage();
  // Session IDs and metadata only; tokens and IP addresses are not sent to the page.
  const sessions = await runtime.db.select({ id: session.id, userAgent: session.userAgent, createdAt: session.createdAt, expiresAt: session.expiresAt })
    .from(session).where(and(eq(session.userId, tenant.userId), gt(session.expiresAt, new Date()))).orderBy(desc(session.createdAt)).limit(20);
  return (
    <>
      <PageHeader title="Account settings" description="Manage your profile, password and signed-in devices." />
      <Section title="Profile">
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
          <div className="text-sm">
            <p className="font-medium">Email</p>
            <p className="text-muted-foreground">{user.email} · verified</p>
          </div>
          <ProfileForm name={user.name} />
        </div>
      </Section>
      <Section title="Password" description="Changing your password signs out every other session.">
        <div className="rounded-lg border bg-card p-4">
          <PasswordForm />
        </div>
      </Section>
      <Section title="Signed-in sessions" description="Sessions expire after 7 days. Sign out any device you don't recognise, then change your password.">
        <SessionList sessions={sessions.map((s) => ({ id: s.id, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt.toISOString(), current: s.id === sessionId }))} />
      </Section>
    </>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AccountContent />
    </Suspense>
  );
}
