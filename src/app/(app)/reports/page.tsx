import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CategoryHeader } from "@/components/app/category-header";
import { NoAuditYet } from "@/components/app/empty-state";
import { ExportToolbar } from "@/components/app/export-toolbar";
import { Section } from "@/components/app/page-header";
import { formatDate } from "@/components/app/format";
import { loadAuditView } from "@/lib/audit/views";
import { buildDeveloperTasks } from "@/lib/reports/action-plan";

export const metadata = { title: "Reports" };

async function ReportsContent({ searchParams }: PageProps<"/reports">) {
  const view = await loadAuditView(searchParams);
  if (!view.full) return <NoAuditYet />;
  const { audit, issues, meta } = view.full;
  const tasks = buildDeveloperTasks(meta?.origin ?? audit.startUrl, audit.completedAt, issues);

  return (
    <>
      <CategoryHeader view={view} title="Reports" description="Export this audit or hand the fixes to a developer." />

      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Audit #{audit.id}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF for sharing with the business owner, JSON for tooling, CSV for spreadsheets, and a Markdown task list you can paste into an AI coding tool or a ticket.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link href={`/audits/${audit.id}/report`} className={buttonVariants({ variant: "secondary" })}>Open detailed report</Link>
          <ExportToolbar auditId={audit.id} />
        </div>
      </section>

      <Section title="Developer Fix Instructions" description="Exactly what the “Copy tasks” button copies: one task per problem, in priority order, with URLs, evidence and acceptance checks.">
        <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-card p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{tasks}</pre>
      </Section>

      <Section title="Earlier reports">
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {view.completed.slice(0, 20).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <Link href={`/audits/${a.id}/report`} className="font-medium hover:underline">#{a.id} {a.host}</Link>
              <span className="text-muted-foreground">{formatDate(a.completedAt)}</span>
              <span className="font-heading font-semibold tabular-nums">{a.overallScore ?? "—"}</span>
              <span className="ml-auto flex gap-3 text-primary">
                <a href={`/api/audits/${a.id}/export?format=pdf`} className="hover:underline">PDF</a>
                <a href={`/api/audits/${a.id}/export?format=json`} className="hover:underline">JSON</a>
                <a href={`/api/audits/${a.id}/export?format=csv`} className="hover:underline">CSV</a>
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

export default function ReportsPage(props: PageProps<"/reports">) {
  return (
    <Suspense fallback={<Loading />}>
      <ReportsContent {...props} />
    </Suspense>
  );
}
