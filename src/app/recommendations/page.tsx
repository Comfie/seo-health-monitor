import { Suspense } from "react";
import Loading from "@/app/loading";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AiConsultantButton } from "@/components/app/ai-consultant";
import { CategoryHeader } from "@/components/app/category-header";
import { IssueDetail } from "@/components/app/check-list";
import { CopyButton } from "@/components/app/copy-button";
import { NoAuditYet } from "@/components/app/empty-state";
import { Markdown } from "@/components/app/markdown";
import { Section } from "@/components/app/page-header";
import { SeverityBadge } from "@/components/app/status";
import { formatDate, shortUrl } from "@/components/app/format";
import { isAiConfigured } from "@/lib/ai/consultant";
import { loadAuditView } from "@/lib/audit/views";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/audit/types";
import { buildActionPlan } from "@/lib/reports/action-plan";
import { cn } from "@/lib/utils";

export const metadata = { title: "Recommendations" };

const SEVERITIES = ["critical", "high", "medium", "low"];
const BUCKETS = ["Fix first", "Fix next", "Plan later"] as const;

async function RecommendationsContent({ searchParams }: PageProps<"/recommendations">) {
  const view = await loadAuditView(searchParams);
  if (!view.full) return <NoAuditYet />;
  const params = await searchParams;
  const { audit, issues } = view.full;
  const severity = typeof params.severity === "string" && SEVERITIES.includes(params.severity) ? params.severity : null;
  const category = typeof params.category === "string" && (CATEGORIES as string[]).includes(params.category) ? params.category : null;
  const filtered = issues.filter((i) => (!severity || i.severity === severity) && (!category || i.category === category));
  const plan = buildActionPlan(filtered);
  const filterHref = (next: Record<string, string | null>) => {
    const q = new URLSearchParams({ audit: String(audit.id) });
    const merged = { severity, category, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/recommendations?${q}`;
  };
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm", active ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted");

  return (
    <>
      <CategoryHeader view={view} title="Recommendations" description="Every measured issue, grouped into tasks and ranked by severity, confidence and effort." />

      <div className="no-print mb-6 flex flex-wrap items-center gap-2">
        <Link href={filterHref({ severity: null })} className={chip(!severity)}>All severities</Link>
        {SEVERITIES.map((s) => (
          <Link key={s} href={filterHref({ severity: s })} className={chip(severity === s)}>
            <span className="capitalize">{s}</span> <span className="text-muted-foreground tabular-nums">{issues.filter((i) => i.severity === s).length}</span>
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Link href={filterHref({ category: null })} className={chip(!category)}>All areas</Link>
        {CATEGORIES.map((c) => (
          <Link key={c} href={filterHref({ category: c })} className={chip(category === c)}>{CATEGORY_LABELS[c]}</Link>
        ))}
        <span className="ml-auto">
          <CopyButton url={`/api/audits/${audit.id}/export?format=tasks`} label="Copy tasks for Claude Code" copiedMessage="Developer task list copied" />
        </span>
      </div>

      {plan.length === 0 && <p className="rounded-lg border bg-card px-4 py-8 text-center text-muted-foreground">No issues match these filters.</p>}

      {BUCKETS.map((bucket) => {
        const items = plan.filter((p) => p.bucket === bucket);
        if (!items.length) return null;
        const offset = plan.indexOf(items[0]);
        return (
          <Section
            key={bucket}
            title={`${bucket} (${items.length})`}
            description={bucket === "Fix first" ? "High severity, high confidence, usually quick to fix." : bucket === "Fix next" ? "Worth doing once the first group is done." : "Smaller improvements and lower-confidence opportunities."}
          >
            <ol className="flex flex-col gap-3">
              {items.map((item, i) => (
                <li key={item.id}>
                  <details className="group rounded-lg border bg-card">
                    <summary className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/40">
                      <span className="mt-0.5 w-6 shrink-0 text-right font-heading font-semibold text-muted-foreground tabular-nums">{offset + i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={item.severity} />
                          <span className="font-medium">{item.title}</span>
                          <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS]}</span>
                        </div>
                        <p className="mt-1 text-sm">{item.fix}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.issues.length} affected URL{item.issues.length === 1 ? "" : "s"} · priority score {item.priorityScore} · {item.confidence} confidence · {item.effort} effort
                        </p>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                    </summary>
                    <div className="border-t px-4 py-4 sm:pl-13">
                      <dl className="grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
                        <dt className="text-muted-foreground">Why it matters</dt>
                        <dd>{item.why}</dd>
                        <dt className="text-muted-foreground">How to implement</dt>
                        <dd className="whitespace-pre-wrap">{item.implementation}</dd>
                        <dt className="text-muted-foreground">Expected benefit</dt>
                        <dd>{item.benefit}</dd>
                      </dl>
                      <h3 className="mt-4 mb-2 text-sm font-semibold">Affected URLs and evidence</h3>
                      <ul className="flex flex-col gap-2">
                        {item.issues.map((issue) => (
                          <li key={issue.issueKey}>
                            <details className="rounded-md border">
                              <summary className="cursor-pointer px-3 py-1.5 font-mono text-xs hover:bg-muted/40">{shortUrl(issue.url)}</summary>
                              <div className="border-t px-3 py-3"><IssueDetail issue={issue} showFixDetails={false} /></div>
                            </details>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </Section>
        );
      })}

      <Section
        id="ai"
        title="AI SEO consultant"
        description="An optional plain-English review written by an AI model from this audit's measured data only. It cannot see Search Console, rankings or traffic, and labels suggestions separately from verified findings."
      >
        <div className="rounded-lg border bg-card p-5">
          <AiConsultantButton auditId={audit.id} configured={isAiConfigured()} hasReport={!!audit.aiReport} />
          {audit.aiReport && (
            <div className="mt-5 border-t pt-4">
              <p className="mb-2 text-xs text-muted-foreground">Generated {formatDate(audit.aiGeneratedAt)} by {audit.aiModel}. Verify suggestions before acting on them.</p>
              <Markdown>{audit.aiReport}</Markdown>
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

export default function RecommendationsPage(props: PageProps<"/recommendations">) {
  return (
    <Suspense fallback={<Loading />}>
      <RecommendationsContent {...props} />
    </Suspense>
  );
}
