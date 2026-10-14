import { Suspense } from "react";
import { notFound } from "next/navigation";
import Loading from "@/app/(app)/loading";
import { PageHeader, Section } from "@/components/app/page-header";
import { CreateInvitationForm, InvitationTable } from "@/components/beta/invitation-manager";
import { listInvitations } from "@/lib/saas/invitations";
import { getCustomerPage } from "@/lib/saas/page";

export const metadata = { title: "Beta invitations" };

async function AdminContent() {
  const { runtime, isAdmin } = await getCustomerPage();
  // Same response as a missing page: customers learn nothing about the admin area.
  if (!isAdmin) notFound();
  const invitations = await listInvitations(runtime.db);
  return (
    <>
      <PageHeader
        title="Beta invitations"
        description={`Invite testers by email. Each link is single-use, bound to that address and expires after ${runtime.config.invitationTtlHours} hours. Registration stays invite-only.`}
      />
      <Section title="New invitation">
        <CreateInvitationForm enabled={runtime.config.invitationsEnabled && runtime.config.registration === "invite-only"} />
      </Section>
      <Section title="Invitations" description="Revoking an invitation stops registration, and stops account creation for testers who have registered but not yet verified.">
        <InvitationTable invitations={invitations} />
      </Section>
    </>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminContent />
    </Suspense>
  );
}
