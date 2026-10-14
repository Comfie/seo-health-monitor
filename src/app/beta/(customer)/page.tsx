import { Suspense } from "react";
import Link from "next/link";
import { Globe, Plus } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/app/page-header";
import { AuditStatusBadge } from "@/components/app/status";
import { formatDate, scoreTone, TONE_COLOR } from "@/components/app/format";
import { BetaNotice } from "@/components/beta/beta-notice";
import { RunAuditButton } from "@/components/beta/audit-actions";
import { tenantRepository } from "@/lib/saas/repository";
import { getCustomerPage } from "@/lib/saas/page";

export const metadata = { title: "Dashboard" };

function describe(action: string, metadata: Record<string, string | number | boolean>) {
  const host = typeof metadata.host === "string" ? metadata.host : "a website";
  switch (action) {
    case "account.created": return "Account created";
    case "website.added": return `Added ${host}`;
    case "website.removed": return `Removed ${host}`;
    case "website.renamed": return "Renamed a website";
    case "audit.started": return `Started an audit of ${host}`;
    case "audit.completed": return `Audit of ${host} completed`;
    case "audit.failed": return "An audit failed";
    case "audit.cancelled": return "Cancelled an audit";
    case "pagespeed.requested": return "Requested a PageSpeed re-test";
    case "pagespeed.completed": return "PageSpeed re-test completed";
    case "pagespeed.failed": return "A PageSpeed re-test failed";
    default: return action;
  }
}

function Score({ value }: { value: number | null | undefined }) {
  return (
    <span className="font-heading text-lg font-semibold tabular-nums" style={{ color: TONE_COLOR[scoreTone(value)] }}>
      {value == null ? "—" : Math.round(value)}
    </span>
  );
}

async function DashboardContent() {
  const { runtime, tenant, user } = await getCustomerPage();
  const data = await tenantRepository(runtime.db, tenant).dashboard();
  const addWebsite = (
    <Link href="/beta/websites" className={buttonVariants()}>
      <Plus />
      Add website
    </Link>
  );

  if (data.websites.length === 0) {
    return (
      <>
        <PageHeader title={`Welcome, ${user.name}`} description="Your private SEO workspace. Websites and results you add here are visible only to your account." />
        <BetaNotice />
        <div className="rounded-lg border border-dashed bg-card px-6 py-14 text-center">
          <Globe className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-xl font-semibold">Add your first website</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            Add a public website you want to monitor. You can track up to {data.usage.websiteLimit} websites during the beta.
          </p>
          <div className="mt-6">{addWebsite}</div>
        </div>
      </>
    );
  }

  const stats: { label: string; value: React.ReactNode }[] = [
    { label: "Websites", value: `${data.usage.websites}/${data.usage.websiteLimit}` },
    { label: "Average health score", value: <Score value={data.overview.averageScore} /> },
    { label: "Critical issues", value: data.overview.criticalIssues },
    { label: "Audits this month", value: `${data.usage.auditsThisMonth}/${data.usage.monthlyAuditLimit}` },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description={`Signed in as ${user.email}. Only your account can see these websites and results.`} actions={addWebsite} />
      <BetaNotice />
      <dl className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card text-sm sm:grid-cols-4 sm:divide-y-0">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3">
            <dt className="text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 font-heading text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Your websites" description="Latest completed audit per website." actions={<Link href="/beta/websites" className={buttonVariants({ variant: "link", className: "px-0" })}>Manage websites</Link>}>
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {data.websites.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <Score value={w.latest?.overallScore} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{w.displayName ?? w.host}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{w.displayUrl}</p>
              </div>
              {w.latest ? (
                <Link href={`/beta/audits/${w.latest.id}`} className="text-xs text-primary hover:underline">Last audit {formatDate(w.latest.completedAt)}</Link>
              ) : (
                <span className="text-xs text-muted-foreground">Not audited yet</span>
              )}
              {w.activeAuditId ? (
                <Link href={`/beta/audits/${w.activeAuditId}`}><AuditStatusBadge status="running" /></Link>
              ) : (
                <RunAuditButton websiteId={w.id} variant={w.latest ? "outline" : "default"} label={w.latest ? "Re-run audit" : "Run audit"} />
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* Each column wraps its Section so both lose the first-child top margin equally. */}
      <div className="mt-10 grid gap-x-8 gap-y-10 lg:grid-cols-2">
        <div>
          <Section title="Latest audits" actions={<Link href="/beta/audits" className={buttonVariants({ variant: "link", className: "px-0" })}>Audit history</Link>}>
            {data.latestAudits.length === 0 ? (
              <p className="rounded-lg border border-dashed bg-card px-4 py-6 text-sm text-muted-foreground">No audits yet. Use <span className="font-medium">Run audit</span> next to a website to start one.</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card text-sm">
                {data.latestAudits.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                    <Link href={`/beta/audits/${a.id}`} className="font-medium hover:underline">{a.site?.displayName ?? a.site?.host ?? "Removed website"}</Link>
                    <AuditStatusBadge status={a.status} />
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(a.completedAt ?? a.createdAt)}</span>
                    <Score value={a.overallScore} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div>
          <Section title="Recent activity">
            <ul className="divide-y rounded-lg border bg-card text-sm">
              {data.activity.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                  <span>{describe(e.action, e.metadata)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatDate(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}

export default function BetaDashboardPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DashboardContent />
    </Suspense>
  );
}
