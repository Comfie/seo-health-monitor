import Link from "next/link";
import { AdminAccounts } from "@/components/beta/admin-accounts";
import { adminAccounts } from "@/lib/saas/administration";
import { readRetentionPolicy } from "@/lib/saas/retention";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Loading from "@/app/(app)/loading";
import { Section } from "@/components/app/page-header";
import { CreateInvitationForm, InvitationTable } from "@/components/beta/invitation-manager";
import { listInvitations } from "@/lib/saas/invitations";
import { getCustomerPage } from "@/lib/saas/page";
import { Activity, ArrowUpRight, Clock3, LockKeyhole, Search, ShieldCheck, UserRoundCheck, UserRoundX, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminActivity } from "@/components/beta/admin-activity";
import { MetricCard, StatusPill, surface, WorkspaceHero } from "@/components/beta/workspace-ui";

export const metadata = { title: "Administration" };

async function AdminContent({searchParams}: {searchParams: Promise<{email?:string}>}) {
  const { runtime, tenant, isAdmin } = await getCustomerPage();
  // Same response as a missing page: customers learn nothing about the admin area.
  if (!isAdmin) notFound();
  const invitations = await listInvitations(runtime.db);
  const email = (await searchParams).email;
  const data = await adminAccounts(runtime.db, tenant.userId, email, runtime.limits);
  const policy = readRetentionPolicy();
  const retentionLabels: Record<string, string> = {audits:'Audit history',scanLogs:'Scan logs',failedJobs:'Finished jobs',authEvents:'Authentication events',invitations:'Invitations',searchSnapshots:'Search Console snapshots',generatedReports:'Generated reports',deletionRecords:'Deletion receipts',operationalEvents:'Operational events',activity:'Account activity',backups:'Backups'};
  return (
    <>
      <WorkspaceHero eyebrow="Workspace management" title="Administration" description="Manage account access, adjust allowances and review changes across your workspace." icon={ShieldCheck}
        actions={<Link className={buttonVariants({variant:'secondary',className:'h-10 px-4'})} href="/beta/admin/operations"><Activity/>System monitoring<ArrowUpRight/></Link>}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-sidebar-foreground"><span className="inline-flex items-center gap-1.5"><LockKeyhole className="size-3.5" aria-hidden/>{runtime.config.registration === 'closed'?'Registration closed':'Invitation-only registration'}</span><span>{runtime.config.invitationsEnabled?'Invitations enabled':'New invitations disabled'}</span></div>
      </WorkspaceHero>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Registered accounts" value={data.totals.registered} note="All workspace identities" icon={Users}/>
        <MetricCard label="Active accounts" value={data.totals.active} note="Ready to use the application" icon={UserRoundCheck} tone="good"/>
        <MetricCard label="Suspended" value={data.totals.suspended} note="Access and active work paused" icon={UserRoundX}/>
        <MetricCard label="Pending setup" value={data.totals.pending} note="Account setup not yet complete" icon={Clock3}/>
      </dl>
      <Section title="Customer accounts" description="Review usage and manage each account's allowances and access.">
        <form className={`${surface} mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end`} action="/beta/admin"><label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium" htmlFor="account-search">Find an account<Input id="account-search" className="h-10" placeholder="Search by email address" name="email" type="search" maxLength={254} defaultValue={email}/></label><Button className="h-10 px-4" type="submit"><Search/>Search accounts</Button>{email && <Link href="/beta/admin" className={buttonVariants({variant:'outline',className:'h-10 px-4'})}>Clear search</Link>}</form>
        <AdminAccounts accounts={JSON.parse(JSON.stringify(data.accounts))} />
      </Section>
      <Section title="Recent administrative activity" description="A recorded history of account, access and invitation changes."><AdminActivity events={data.recent} accounts={data.accounts}/></Section>
      <Section title="Retention policy" description="Review the proposed storage periods for application data."><div className={`${surface} overflow-hidden`}><div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 p-4 sm:px-5"><div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-primary" aria-hidden/>Data retention safeguards</div><StatusPill tone={policy.approved?'good':'warning'}>{policy.approved?'Policy approved':'Preview only · cleanup disabled'}</StatusPill></div><dl className="grid divide-y text-sm sm:grid-cols-2">{Object.entries(policy.days).map(([key,days])=><div key={key} className="flex items-center justify-between gap-3 px-5 py-3"><dt className="text-muted-foreground">{retentionLabels[key]??key}</dt><dd className="shrink-0 font-semibold tabular-nums">{days} days</dd></div>)}</dl></div></Section>
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
