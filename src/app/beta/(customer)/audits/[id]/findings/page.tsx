import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import Loading from "@/app/(app)/loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckList } from "@/components/app/check-list";
import { PageHeader, Section } from "@/components/app/page-header";
import { formatMs, shortUrl } from "@/components/app/format";
import { RerunPagespeedButton } from "@/components/beta/audit-actions";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/audit/types";
import { getCustomerAudit } from "@/lib/saas/audit-page";
import { cn } from "@/lib/utils";

export const metadata = { title: "Findings" };

async function FindingsContent({ params, searchParams }: PageProps<"/beta/audits/[id]/findings">) {
  const { audits, status } = await getCustomerAudit((await params).id);
  if (status.status !== "completed") redirect(`/beta/audits/${status.id}`);
  const raw = (await searchParams).category;
  const category: Category = typeof raw === "string" && CATEGORIES.includes(raw as Category) ? (raw as Category) : "technical";
  const full = await audits.full(status.id);
  const checks = full.checks.filter((c) => c.category === category);
  const issues = full.issues.filter((i) => i.category === category);
  const score = (full.audit.categoryScores as Partial<Record<Category, number | null>> | null)?.[category];
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm", active ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted");

  return (
    <>
      <PageHeader
        title={`${CATEGORY_LABELS[category]} findings`}
        description={<>Audit #{full.audit.id} of {full.meta?.siteHost ?? full.site.host} · score {score ?? "not available"} · {issues.length} {issues.length === 1 ? "issue" : "issues"}. <Link className="text-primary hover:underline" href={`/beta/audits/${full.audit.id}`}>Back to overview</Link></>}
      />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Finding categories">
        {CATEGORIES.map((c) => <Link key={c} href={`/beta/audits/${full.audit.id}/findings?category=${c}`} className={chip(c === category)}>{CATEGORY_LABELS[c]}</Link>)}
      </nav>
      {checks.length === 0 ? <p className="rounded-lg border bg-card px-4 py-6 text-muted-foreground">No checks in this category.</p> : <CheckList checks={checks} issues={issues} />}

      {category === "performance" && (
        <Section title="PageSpeed Insights results" description="Lab measurements from Google for a sample of pages. Tests that timed out, hit Google's rate limits or exceeded the beta budget are listed as not measured." actions={<RerunPagespeedButton auditId={full.audit.id} active={status.pagespeedRerun !== null} />}>
          {full.performance.length === 0 ? (
            <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">{full.meta?.performanceSkippedReason ?? "No PageSpeed tests were run."}</p>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">LCP</TableHead>
                    <TableHead className="text-right">CLS</TableHead>
                    <TableHead className="text-right">TBT</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {full.performance.map((p) => (
                    <TableRow key={`${p.url}|${p.strategy}`}>
                      <TableCell className="font-mono text-xs">{shortUrl(p.url)}</TableCell>
                      <TableCell className="capitalize">{p.strategy}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.performanceScore ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMs(p.lcpMs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.cls == null ? "—" : p.cls.toFixed(3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMs(p.tbtMs)}</TableCell>
                      <TableCell className="max-w-72 whitespace-normal text-xs">{p.status === "ok" ? "Measured" : <span className="text-muted-foreground">Not measured: {p.error}</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>
      )}
    </>
  );
}

export default function FindingsPage(props: PageProps<"/beta/audits/[id]/findings">) {
  return (
    <Suspense fallback={<Loading />}>
      <FindingsContent {...props} />
    </Suspense>
  );
}
