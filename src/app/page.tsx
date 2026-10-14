import { Suspense } from "react";
import Loading from "@/app/loading";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { AuditPicker, toPickerAudits } from "@/components/app/audit-picker";
import { NoAuditYet } from "@/components/app/empty-state";
import { PageHeader, Section } from "@/components/app/page-header";
import { RerunAuditButton } from "@/components/app/rerun-button";
import { ScoreBar, ScoreDial } from "@/components/app/score-dial";
import { AuditStatusBadge, SeverityBadge } from "@/components/app/status";
import { formatDate, shortUrl } from "@/components/app/format";
import { listAudits } from "@/lib/audit/repository";
import { CATEGORY_WEIGHTS, scoreLabel } from "@/lib/audit/scoring";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/audit/types";
import { loadAuditView } from "@/lib/audit/views";
import { buildActionPlan } from "@/lib/reports/action-plan";

const CATEGORY_PAGE: Record<Category, string> = {
  technical: "/technical",
  onpage: "/on-page",
  performance: "/performance",
  local: "/local",
  conversion: "/local",
};

const categoryHref = (c: Category, auditId: number) => `${CATEGORY_PAGE[c]}?audit=${auditId}${c === "conversion" ? "#conversion" : ""}`;

async function DashboardContent({ searchParams }: PageProps<"/">) {
  const { full, completed } = await loadAuditView(searchParams);
  const active = listAudits({ limit: 10 }).filter((a) => a.status === "running" || a.status === "queued");

  const runningBanner = active.length > 0 && (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm">
      <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
      {active.map((a) => (
        <Link key={a.id} href={`/audits/${a.id}`} className="font-medium text-accent-foreground hover:underline">
          Audit #{a.id} of {a.host} is {a.status} ({a.progress}%)
        </Link>
      ))}
    </div>
  );

  if (!full) {
    return (
      <>
        <PageHeader title="Dashboard" description="Audit any public website for technical, on-page, performance, local SEO and conversion issues." />
        {runningBanner}
        <NoAuditYet />
      </>
    );
  }

  const { audit, meta, issues, checks } = full;
  const counts = audit.counts ?? {};
  const categories = (audit.categoryScores ?? {}) as Partial<Record<Category, number | null>>;
  const plan = buildActionPlan(issues).slice(0, 6);
  const q = `?audit=${audit.id}`;
  const unverified = checks.filter((c) => c.status === "unavailable");

  const stats: { label: string; value: React.ReactNode; tone?: string }[] = [
    { label: "Critical issues", value: counts.critical ?? 0, tone: (counts.critical ?? 0) > 0 ? "text-sev-critical" : undefined },
    { label: "Warnings", value: counts.warnings ?? 0, tone: (counts.warnings ?? 0) > 0 ? "text-sev-medium" : undefined },
    { label: "Passing checks", value: `${counts.passing ?? 0}/${(counts.totalChecks ?? 0) - (counts.unavailable ?? 0)}`, tone: "text-sev-pass" },
    { label: "Pages scanned", value: audit.pagesScanned ?? 0 },
    { label: "Not verifiable", value: counts.unavailable ?? 0 },
    { label: "Last scan", value: <span className="text-base">{formatDate(audit.completedAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={meta?.siteHost ?? full.site.host}
        description={
          <>
            Audit #{audit.id} of <a className="text-primary hover:underline" href={meta?.origin ?? audit.startUrl} target="_blank" rel="noreferrer noopener">{meta?.origin ?? audit.startUrl}</a>
          </>
        }
        actions={
          <>
            {completed.length > 1 && <AuditPicker audits={toPickerAudits(completed)} current={audit.id} />}
            <RerunAuditButton url={audit.startUrl} />
            <Link href={`/audits/${audit.id}/report`} className={buttonVariants()}>
              View report
            </Link>
          </>
        }
      />
      {runningBanner}

      <section className="grid items-center gap-8 rounded-xl border bg-card p-6 md:grid-cols-[auto_1fr] md:p-8">
        <div className="flex flex-col items-center">
          <ScoreDial overall={audit.overallScore} categories={categories} />
          <p className="-mt-6 font-heading text-lg font-semibold">{scoreLabel(audit.overallScore)}</p>
          <p className="text-sm text-muted-foreground">Overall SEO health</p>
        </div>
        <div className="flex flex-col gap-5">
          {CATEGORIES.map((c) => (
            <ScoreBar key={c} label={CATEGORY_LABELS[c]} score={categories[c] ?? null} weight={CATEGORY_WEIGHTS[c]} href={categoryHref(c, audit.id)} />
          ))}
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

      <Section
        title="Fix these first"
        description="Grouped by problem and ranked by severity, confidence and effort."
        actions={
          <Link href={`/recommendations${q}`} className={buttonVariants({ variant: "link", className: "px-0" })}>
            Full action plan <ArrowUpRight />
          </Link>
        }
      >
        {plan.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-6 text-muted-foreground">No issues were found in this audit.</p>
        ) : (
          <ol className="divide-y rounded-lg border bg-card">
            {plan.map((item, i) => (
              <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                <span className="mt-0.5 w-5 text-right font-heading text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <span className="font-medium">{item.title}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.fix}</p>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {item.issues.slice(0, 3).map((x) => shortUrl(x.url)).join(", ")}
                    {item.issues.length > 3 ? ` +${item.issues.length - 3} more` : ""}
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{item.bucket}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {(unverified.length > 0 || (meta?.notes.length ?? 0) > 0) && (
        <Section title="Limits of this audit" description="What this scan could not measure, so you know what the scores do and don't cover.">
          <ul className="space-y-1.5 text-sm">
            {meta?.performanceSkippedReason && <li>• {meta.performanceSkippedReason}</li>}
            {unverified.map((c) => (
              <li key={c.checkId}>
                • <span className="font-medium">{c.title}:</span> <span className="text-muted-foreground">{c.unavailableReason}</span>
              </li>
            ))}
            {meta?.notes.map((n) => <li key={n}>• {n}</li>)}
          </ul>
        </Section>
      )}

      <Section title="Recent audits" actions={<Link href="/audits" className={buttonVariants({ variant: "link", className: "px-0" })}>Audit history</Link>}>
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {listAudits({ limit: 5 }).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <Link href={`/audits/${a.id}`} className="font-medium hover:underline">#{a.id} {a.host}</Link>
              <AuditStatusBadge status={a.status} />
              <span className="text-muted-foreground">{formatDate(a.completedAt ?? a.createdAt)}</span>
              <span className="ml-auto font-heading font-semibold tabular-nums">{a.overallScore ?? "—"}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

export default function DashboardPage(props: PageProps<"/">) {
  return (
    <Suspense fallback={<Loading />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}
