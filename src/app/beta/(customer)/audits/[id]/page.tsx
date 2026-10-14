import { Suspense } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, Sparkles } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { AuditProgress } from "@/components/app/audit-progress";
import { ExportToolbar } from "@/components/app/export-toolbar";
import { Markdown } from "@/components/app/markdown";
import { PageHeader, Section } from "@/components/app/page-header";
import { ScoreBar, ScoreDial } from "@/components/app/score-dial";
import { ScoreCoverage } from "@/components/app/score-coverage";
import { SeverityBadge } from "@/components/app/status";
import { formatDate, shortUrl } from "@/components/app/format";
import { AiReportButton, CancelAuditButton, RerunPagespeedButton, RunAuditButton } from "@/components/beta/audit-actions";
import { isAiConfigured } from "@/lib/ai/consultant";
import { CATEGORY_WEIGHTS, assessScore, scoreLabel } from "@/lib/audit/scoring";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/audit/types";
import { buildActionPlan } from "@/lib/reports/action-plan";
import { getCustomerAudit } from "@/lib/saas/audit-page";

export const metadata = { title: "Audit" };

async function AuditContent({ params }: PageProps<"/beta/audits/[id]">) {
  const { audits, status } = await getCustomerAudit((await params).id);
  const base = `/beta/audits/${status.id}`;

  if (status.status === "queued" || status.status === "running") {
    return (
      <>
        <PageHeader title={`Audit #${status.id}`} description="Your audit is in progress. You can leave this page; it keeps running." actions={<CancelAuditButton auditId={status.id} requested={status.cancelRequested} />} />
        <div className="max-w-2xl">
          <AuditProgress auditId={status.id} statusUrl={`/api/beta/audits/${status.id}`} initial={{ status: status.status, stage: status.stage, progress: status.progress, log: status.log, error: status.error }} />
          {status.attempts > 1 && <p className="mt-3 text-sm text-muted-foreground">Attempt {status.attempts}: the previous attempt was interrupted and is being retried automatically.</p>}
        </div>
      </>
    );
  }

  if (status.status !== "completed") {
    const cancelled = status.status === "cancelled";
    return (
      <>
        <PageHeader title={`Audit #${status.id} ${cancelled ? "was cancelled" : "failed"}`} actions={<RunAuditButton websiteId={status.websiteId} label="Run again" />} />
        <Alert variant={cancelled ? "default" : "destructive"} className="max-w-2xl">
          <AlertCircle />
          <AlertTitle>{cancelled ? "This audit was cancelled before it finished" : "The audit couldn’t be completed"}</AlertTitle>
          <AlertDescription>
            {cancelled ? <p>No results were stored. Run the audit again whenever you are ready.</p> : (
              <>
                <p>{status.error ?? "Unknown error."}</p>
                <p className="mt-2">Check the address opens in a browser, that it is a public website, and that it isn’t blocking automated requests. Then try again.</p>
              </>
            )}
          </AlertDescription>
        </Alert>
        <p className="mt-6 text-sm"><Link href={`/beta/audits?website=${status.websiteId}`} className="text-primary hover:underline">Audit history for this website</Link></p>
      </>
    );
  }

  const [full, history] = await Promise.all([audits.full(status.id), audits.history({ websiteId: status.websiteId, limit: 50 })]);
  const { audit, meta, issues, checks, performance } = full;
  const previous = history.find((h) => h.status === "completed" && h.id !== audit.id && (h.completedAt ?? "") < (audit.completedAt?.toISOString() ?? ""));
  const counts = audit.counts ?? {};
  const categories = (audit.categoryScores ?? {}) as Partial<Record<Category, number | null>>;
  const plan = buildActionPlan(issues).slice(0, 8);
  const unverified = checks.filter((c) => c.status === "unavailable");
  const measured = performance.filter((p) => p.status === "ok").length;
  const stats: { label: string; value: React.ReactNode; tone?: string }[] = [
    { label: "Critical issues", value: counts.critical ?? 0, tone: (counts.critical ?? 0) > 0 ? "text-sev-critical" : undefined },
    { label: "Warnings", value: counts.warnings ?? 0, tone: (counts.warnings ?? 0) > 0 ? "text-sev-medium" : undefined },
    { label: "Passing checks", value: `${counts.passing ?? 0}/${(counts.totalChecks ?? 0) - (counts.unavailable ?? 0)}`, tone: "text-sev-pass" },
    { label: "Pages scanned", value: audit.pagesScanned ?? 0 },
    { label: "Not verifiable", value: counts.unavailable ?? 0 },
    { label: "Completed", value: <span className="text-base">{formatDate(audit.completedAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={meta?.siteHost ?? full.site.host}
        description={<>Audit #{audit.id} of <a className="text-primary hover:underline" href={meta?.origin ?? audit.startUrl} target="_blank" rel="noreferrer noopener">{meta?.origin ?? audit.startUrl}</a></>}
        actions={
          <>
            {previous && <Link href={`/beta/audits/compare?a=${previous.id}&b=${audit.id}`} className={buttonVariants({ variant: "outline" })}>Compare with previous</Link>}
            <RunAuditButton websiteId={status.websiteId} label="Re-run audit" variant="outline" />
            <Link href={`${base}/fix`} className={buttonVariants()}><Sparkles />Fix with AI</Link>
          </>
        }
      />

      <section className="grid items-center gap-8 rounded-xl border bg-card p-6 md:grid-cols-[auto_1fr] md:p-8">
        <div className="flex flex-col items-center">
          <ScoreDial overall={audit.overallScore} categories={categories} />
          <p className="-mt-6 font-heading text-lg font-semibold">{scoreLabel(audit.overallScore)}</p>
          <p className="text-sm text-muted-foreground">On-site SEO health</p>
          <div className="mt-2 max-w-60"><ScoreCoverage assessment={assessScore(checks, CATEGORY_LABELS)} compact /></div>
        </div>
        <div className="flex flex-col gap-5">
          {CATEGORIES.map((c) => <ScoreBar key={c} label={CATEGORY_LABELS[c]} score={categories[c] ?? null} weight={CATEGORY_WEIGHTS[c]} href={`${base}/findings?category=${c}`} />)}
        </div>
      </section>

      <dl className="mt-6 grid grid-cols-2 divide-x divide-y rounded-xl border bg-card sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-4">
            <dt className="text-sm text-muted-foreground">{s.label}</dt>
            <dd className={`mt-1 font-heading text-2xl font-semibold tabular-nums ${s.tone ?? ""}`}>{s.value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Fix these first" description="Grouped by problem and ranked by severity, confidence and effort." actions={<Link href={`${base}/findings`} className={buttonVariants({ variant: "link", className: "px-0" })}>All findings <ArrowUpRight /></Link>}>
        {plan.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-muted-foreground">No issues were found in this audit.</p>
        ) : (
          <ol className="divide-y rounded-lg border bg-card">
            {plan.map((item, i) => (
              <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                <span className="mt-0.5 w-5 text-right font-heading text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={item.severity} /><span className="font-medium">{item.title}</span></div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.fix}</p>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {item.issues.slice(0, 3).map((x) => shortUrl(x.url)).join(", ")}{item.issues.length > 3 ? ` +${item.issues.length - 3} more` : ""}
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{item.bucket}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Reports" description="Generated on request from your account's data only. Links work only while you are signed in.">
        <ExportToolbar auditId={audit.id} baseHref={`/api/beta/audits/${audit.id}`} />
      </Section>

      <Section
        title="Performance"
        description={performance.length ? `Real Google PageSpeed Insights measurements: ${measured} of ${performance.length} tests returned results. Tests Google could not run are shown as not measured, never as passed.` : (meta?.performanceSkippedReason ?? "No PageSpeed tests were run.")}
        actions={<Link href={`${base}/findings?category=performance`} className={buttonVariants({ variant: "link", className: "px-0" })}>Performance findings <ArrowUpRight /></Link>}
      >
        <RerunPagespeedButton auditId={audit.id} active={status.pagespeedRerun !== null} />
      </Section>

      <Section title="AI consultant report" description="Optional narrative report written by an AI model from this audit's measured data only. Uses your monthly AI allowance.">
        {audit.aiReport ? <div className="rounded-lg border bg-card p-5"><Markdown>{audit.aiReport}</Markdown></div> : null}
        {isAiConfigured() ? <div className="mt-3"><AiReportButton auditId={audit.id} hasReport={!!audit.aiReport} /></div> : <p className="text-sm text-muted-foreground">The AI consultant is not enabled for the beta yet. Fix with AI instructions above work with any AI coding tool.</p>}
      </Section>

      {(unverified.length > 0 || (meta?.notes.length ?? 0) > 0) && (
        <Section title="Limits of this audit" description="What this scan could not measure, so you know what the scores do and don't cover.">
          <ul className="space-y-1.5 text-sm">
            {meta?.performanceSkippedReason && <li>• {meta.performanceSkippedReason}</li>}
            {unverified.map((c) => <li key={c.checkId}>• <span className="font-medium">{c.title}:</span> <span className="text-muted-foreground">{c.unavailableReason}</span></li>)}
            {meta?.notes.map((n) => <li key={n}>• {n}</li>)}
          </ul>
        </Section>
      )}
    </>
  );
}

export default function BetaAuditPage(props: PageProps<"/beta/audits/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <AuditContent {...props} />
    </Suspense>
  );
}
