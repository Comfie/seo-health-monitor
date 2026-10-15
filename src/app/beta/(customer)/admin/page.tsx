import Link from "next/link";
import { AdminAccounts } from "@/components/beta/admin-accounts";
import { adminAccounts } from "@/lib/saas/administration";
import { readRetentionPolicy } from "@/lib/saas/retention";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Loading from "@/app/(app)/loading";
import { PageHeader, Section } from "@/components/app/page-header";
import { CreateInvitationForm, InvitationTable } from "@/components/beta/invitation-manager";
import { listInvitations } from "@/lib/saas/invitations";
import { getCustomerPage } from "@/lib/saas/page";

export const metadata = { title: "Beta administration" };

async function AdminContent({searchParams}: {searchParams: Promise<{email?:string}>}) {
  const { runtime, tenant, isAdmin } = await getCustomerPage();
  // Same response as a missing page: customers learn nothing about the admin area.
  if (!isAdmin) notFound();
  const invitations = await listInvitations(runtime.db);
  const data = await adminAccounts(runtime.db, tenant.userId, (await searchParams).email, runtime.limits);
  return (
    <>
      <PageHeader
        title="Beta administration"
        description={`Invite testers by email. Each link is single-use, bound to that address and expires after ${runtime.config.invitationTtlHours} hours. Registration stays invite-only.`}
      />
      <Section title="Customer accounts" description={`${data.totals.registered} registered · ${data.totals.active} active · ${data.totals.suspended} suspended · ${data.totals.pending} pending`}>
        <Link className="text-sm underline" href="/beta/admin/operations">Worker and system monitoring</Link>
        <form className="my-4 flex flex-wrap gap-2" action="/beta/admin"><label className="text-sm">Search email <input className="rounded border bg-card p-2" name="email" type="search" maxLength={254} /></label><button className="rounded border px-3" type="submit">Search</button></form>
        <AdminAccounts accounts={JSON.parse(JSON.stringify(data.accounts))} />
      </Section>
      <Section title="Recent administrative activity"><ul className="space-y-2 text-sm">{data.recent.map(e=><li key={e.id}>{e.createdAt.toISOString()} · {e.action} · {JSON.stringify(e.metadata)}</li>)}</ul></Section>
      <Section title="Retention policy" description="Proposed defaults; destructive cleanup is disabled until operator review."><dl className="grid gap-2 text-sm sm:grid-cols-2">{Object.entries(readRetentionPolicy().days).map(([key,days])=><div key={key}><dt className="font-medium">{key}</dt><dd>{days} days</dd></div>)}</dl></Section>
      <Section title="New invitation">
        <CreateInvitationForm enabled={runtime.config.invitationsEnabled && runtime.config.registration === "invite-only"} />
      </Section>
      <Section title="Invitations" description="Revoking an invitation stops registration, and stops account creation for testers who have registered but not yet verified.">
        <InvitationTable invitations={invitations} />
      </Section>
    </>
  );
}

export default function AdminPage({searchParams}: {searchParams: Promise<{email?:string}>}) {
  return (
    <Suspense fallback={<Loading />}>
      <AdminContent searchParams={searchParams} />
    </Suspense>
  );
}
