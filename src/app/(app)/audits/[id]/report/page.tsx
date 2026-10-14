import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ExportToolbar } from "@/components/app/export-toolbar";
import { Markdown } from "@/components/app/markdown";
import { PageHeader, Section } from "@/components/app/page-header";
import { ScoreBar, ScoreDial } from "@/components/app/score-dial";
import { SeverityBadge, StatusIcon } from "@/components/app/status";
import { formatDate, formatMs, shortUrl } from "@/components/app/format";
import { getFullAudit } from "@/lib/audit/repository";
import { CATEGORY_WEIGHTS, assessScore, scoreLabel } from "@/lib/audit/scoring";
import { ScoreCoverage } from "@/components/app/score-coverage";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/audit/types";
import { buildActionPlan } from "@/lib/reports/action-plan";

export const metadata = { title: "Audit report" };

async function ReportContent({ params }: PageProps<"/audits/[id]/report">) {
  await connection();
  const id = Number.parseInt((await params).id, 10);
  const full = Number.isFinite(id) ? getFullAudit(id) : null;
  if (!full) notFound();
  if (full.audit.status !== "completed") redirect(`/audits/${id}`);
  const { audit, meta, checks, issues, performance } = full;
  const categories = (audit.categoryScores ?? {}) as Partial<Record<Category, number | null>>;
  const counts = audit.counts ?? {};
  const plan = buildActionPlan(issues);

  return (
    <article>
      <PageHeader
        title={`SEO report: ${meta?.siteHost ?? full.site.host}`}
        description={`Audit #${audit.id} · completed ${formatDate(audit.completedAt)} · ${audit.pagesScanned} pages scanned`}
        actions={<ExportToolbar auditId={audit.id} showPrint />}
      />

      <section className="grid items-center gap-8 rounded-xl border bg-card p-6 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center">
          <ScoreDial overall={audit.overallScore} categories={categories} size={200} />
          <p className="-mt-4 font-heading font-semibold">{scoreLabel(audit.overallScore)}</p>
          <p className="text-sm text-muted-foreground">On-site SEO health</p>
          <div className="mt-2 max-w-64"><ScoreCoverage assessment={assessScore(checks, CATEGORY_LABELS)} /></div>
        </div>
        <div className="flex flex-col gap-4">
          {CATEGORIES.map((c) => <ScoreBar key={c} label={CATEGORY_LABELS[c]} score={categories[c] ?? null} weight={CATEGORY_WEIGHTS[c]} />)}
          <p className="text-sm text-muted-foreground">
            {counts.critical ?? 0} critical · {counts.high ?? 0} high · {counts.medium ?? 0} medium · {counts.low ?? 0} low issues. {counts.passing ?? 0} checks passed; {counts.unavailable ?? 0} could not be verified from a public crawl and are excluded from the scores.
          </p>
        </div>
      </section>

      <Section title="Prioritised action plan">
        <ol className="flex flex-col gap-4">
          {plan.map((item, i) => (
            <li key={item.id} className="break-inside-avoid rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading font-semibold tabular-nums">{i + 1}.</span>
                <SeverityBadge severity={item.severity} />
                <h3 className="font-semibold">{item.title}</h3>
                <span className="text-xs text-muted-foreground">{item.bucket} · {CATEGORY_LABELS[item.category as Category]}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
                <dt className="text-muted-foreground">Why it matters</dt>
                <dd>{item.why}</dd>
                <dt className="text-muted-foreground">Recommended fix</dt>
                <dd>{item.fix}</dd>
                <dt className="text-muted-foreground">Expected benefit</dt>
                <dd>{item.benefit}</dd>
                <dt className="text-muted-foreground">Affected</dt>
                <dd>
                  <ul className="space-y-1">
                    {item.issues.slice(0, 12).map((x) => (
                      <li key={x.issueKey}>
                        <span className="font-mono text-xs">{x.url}</span>
                        {x.evidence[0] && <span className="block text-xs text-muted-foreground">{x.evidence.slice(0, 2).join(" · ")}</span>}
                      </li>
                    ))}
                    {item.issues.length > 12 && <li className="text-xs text-muted-foreground">…and {item.issues.length - 12} more (see CSV/JSON export)</li>}
                  </ul>
                </dd>
              </dl>
            </li>
          ))}
          {plan.length === 0 && <li className="text-muted-foreground">No issues were found.</li>}
        </ol>
      </Section>

      <Section id="developer" title="Developer Fix Instructions" description="Implementation guidance per task, in the same priority order. Re-run the audit after each batch of fixes to confirm.">
        <ol className="flex flex-col gap-3">
          {plan.map((item, i) => (
            <li key={item.id} className="break-inside-avoid rounded-lg border bg-card p-4 text-sm">
              <h3 className="font-semibold">{i + 1}. {item.title}</h3>
              <p className="mt-2 whitespace-pre-wrap">{item.implementation}</p>
              <p className="mt-2 text-xs text-muted-foreground">Files/pages to change: {item.issues.slice(0, 15).map((x) => shortUrl(x.url)).join(", ")}{item.issues.length > 15 ? ", …" : ""}</p>
              <p className="mt-1 text-xs text-muted-foreground">Done when: the audit no longer reports “{item.title}” for these URLs.</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="All checks">
        <div className="grid gap-6 lg:grid-cols-2">
          {CATEGORIES.map((c) => (
            <div key={c} className="break-inside-avoid">
              <h3 className="mb-2 font-semibold">{CATEGORY_LABELS[c]}</h3>
              <ul className="divide-y rounded-lg border bg-card text-sm">
                {checks.filter((x) => x.category === c).map((x) => (
                  <li key={x.checkId} className="flex gap-2 px-3 py-2">
                    <StatusIcon status={x.status} className="mt-0.5 size-4" />
                    <div>
                      <p className="font-medium">{x.title}</p>
                      <p className="text-xs text-muted-foreground">{x.summary}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Performance">
        {performance.length === 0 || performance.every((p) => p.status !== "ok") ? (
          <p className="text-sm text-muted-foreground">{meta?.performanceSkippedReason ?? performance[0]?.error ?? "No PageSpeed data."}</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {performance.map((p) => (
              <li key={p.id} className="px-3 py-2">
                <span className="font-mono text-xs">{shortUrl(p.url)}</span> · <span className="capitalize">{p.strategy}</span>:{" "}
                {p.status === "ok" ? `score ${p.performanceScore}, LCP ${formatMs(p.lcpMs)}, CLS ${p.cls?.toFixed(3)}, TBT ${formatMs(p.tbtMs)}${p.fieldInpMs ? `, field INP ${formatMs(p.fieldInpMs)}` : ""}` : `not measured (${p.error})`}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {audit.aiReport && (
        <Section title="AI consultant notes" description={`Generated by ${audit.aiModel} from the measured data above.`}>
          <div className="rounded-lg border bg-card p-5"><Markdown>{audit.aiReport}</Markdown></div>
        </Section>
      )}

      <p className="mt-10 text-xs text-muted-foreground">
        Scores are weighted averages of explicit checks; see Settings → Scoring methodology. Google Search Console data (indexing, clicks, rankings) is not part of this report.
      </p>
    </article>
  );
}

export default function ReportPage(props: PageProps<"/audits/[id]/report">) {
  return (
    <Suspense fallback={<Loading />}>
      <ReportContent {...props} />
    </Suspense>
  );
}
