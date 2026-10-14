import { Suspense } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/app/page-header";
import { AuditStatusBadge } from "@/components/app/status";
import { formatDate, scoreTone, TONE_COLOR } from "@/components/app/format";
import { ComparePicker, RunAuditButton } from "@/components/beta/audit-actions";
import { auditsFor } from "@/lib/saas/audit-http";
import { getCustomerPage } from "@/lib/saas/page";
import { tenantRepository } from "@/lib/saas/repository";
import { AccessDeniedError } from "@/lib/saas/tenant";
import { notFound } from "next/navigation";

export const metadata = { title: "Audit history" };

async function HistoryContent({ searchParams }: PageProps<"/beta/audits">) {
  const { runtime, tenant } = await getCustomerPage();
  const raw = (await searchParams).website;
  const websiteId = typeof raw === "string" && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : undefined;
  if (raw !== undefined && websiteId === undefined) notFound();
  const websites = await tenantRepository(runtime.db, tenant, runtime.limits).listWebsites();
  let audits;
  try {
    audits = await auditsFor(runtime, tenant).history({ websiteId });
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }
  const site = websites.find((w) => w.id === websiteId);
  const completed = audits.filter((a) => a.status === "completed");
  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-sm ${active ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted"}`;

  return (
    <>
      <PageHeader
        title="Audit history"
        description={site ? `Every scan of ${site.displayName ?? site.host}. Only your account can see these results.` : "Every scan run by your account. Only your account can see these results."}
        actions={site && <RunAuditButton websiteId={site.id} />}
      />
      {websites.length > 1 && (
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Filter by website">
          <Link href="/beta/audits" className={chip(!site)}>All websites</Link>
          {websites.map((w) => <Link key={w.id} href={`/beta/audits?website=${w.id}`} className={chip(w.id === websiteId)}>{w.displayName ?? w.host}</Link>)}
        </nav>
      )}

      {audits.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card px-6 py-14 text-center">
          <History className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-xl font-semibold">No audits yet</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            {websites.length ? "Run an audit from your websites list to see technical, on-page and performance findings here." : "Add a website first, then run its first audit."}
          </p>
          <div className="mt-6"><Link href="/beta/websites" className={buttonVariants()}>{websites.length ? "Go to websites" : "Add website"}</Link></div>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {audits.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span className="w-10 font-heading text-lg font-semibold tabular-nums" style={{ color: TONE_COLOR[scoreTone(a.overallScore)] }}>{a.overallScore == null ? "—" : Math.round(a.overallScore)}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/beta/audits/${a.id}`} className="font-medium hover:underline">Audit #{a.id} · {a.displayName ?? a.host}</Link>
                <p className="text-xs text-muted-foreground">{formatDate(a.completedAt ?? a.createdAt)}{a.pagesScanned ? ` · ${a.pagesScanned} pages` : ""}{a.counts ? ` · ${a.counts.critical ?? 0} critical, ${a.counts.warnings ?? 0} warnings` : ""}</p>
              </div>
              <AuditStatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}

      {completed.length > 1 && (
        <Section title="Compare scans" description="See what was fixed, what is new and how scores moved between two scans of the same website.">
          <ComparePicker audits={completed.map((a) => ({ id: a.id, websiteId: a.websiteId, label: `#${a.id} ${a.displayName ?? a.host} · ${formatDate(a.completedAt)}` }))} />
        </Section>
      )}
    </>
  );
}

export default function AuditHistoryPage(props: PageProps<"/beta/audits">) {
  return (
    <Suspense fallback={<Loading />}>
      <HistoryContent {...props} />
    </Suspense>
  );
}
