import { Suspense } from "react";
import Loading from "@/app/loading";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Section } from "@/components/app/page-header";
import { SeverityBadge } from "@/components/app/status";
import { formatDate, formatMs, shortUrl } from "@/components/app/format";
import { compareAudits, type CompareInput, type Trend } from "@/lib/audit/compare";
import { getFullAudit, type FullAudit } from "@/lib/audit/repository";
import { CATEGORY_LABELS, type Category } from "@/lib/audit/types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Compare audits" };

function toInput(full: FullAudit): CompareInput {
  return {
    overallScore: full.audit.overallScore,
    categoryScores: full.audit.categoryScores as Partial<Record<Category, number | null>> | null,
    counts: full.audit.counts ?? null,
    issues: full.issues,
    pages: full.pages,
    performance: full.performance,
  };
}

function TrendMark({ trend }: { trend: Trend }) {
  if (trend === "improved") return <span className="inline-flex items-center gap-0.5 text-sev-pass"><ArrowUpRight className="size-4" aria-hidden />Improved</span>;
  if (trend === "regressed") return <span className="inline-flex items-center gap-0.5 text-sev-critical"><ArrowDownRight className="size-4" aria-hidden />Regressed</span>;
  if (trend === "unchanged") return <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Minus className="size-4" aria-hidden />Unchanged</span>;
  return <span className="text-muted-foreground">Not comparable</span>;
}

const METRIC_LABEL: Record<string, string> = { performanceScore: "Performance score", lcpMs: "LCP", cls: "CLS", tbtMs: "TBT", fieldInpMs: "INP (field)" };
const FIELD_LABEL: Record<string, string> = { status: "HTTP status", title: "Title", metaDescription: "Meta description", h1: "H1", canonical: "Canonical", metaRobots: "Robots directives", wordCount: "Word count" };

function metricValue(metric: string, v: number | null) {
  if (v == null) return "—";
  if (metric === "cls") return v.toFixed(3);
  if (metric === "performanceScore") return String(Math.round(v));
  return formatMs(v);
}

function IssueTable({ issues, empty }: { issues: { issueKey: string; severity: string; title: string; url: string }[]; empty: string }) {
  if (!issues.length) return <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y rounded-lg border bg-card text-sm">
      {issues.map((i) => (
        <li key={i.issueKey} className="flex flex-wrap items-center gap-2 px-4 py-2">
          <SeverityBadge severity={i.severity} />
          <span className="font-medium">{i.title}</span>
          <span className="font-mono text-xs text-muted-foreground">{shortUrl(i.url)}</span>
        </li>
      ))}
    </ul>
  );
}

async function CompareContent({ searchParams }: PageProps<"/audits/compare">) {
  await connection();
  const params = await searchParams;
  const ids = [params.a, params.b].map((v) => Number.parseInt(String(v ?? ""), 10));
  const audits = ids.map((id) => (Number.isFinite(id) ? getFullAudit(id) : null));

  const problem = !audits[0] || !audits[1]
    ? "Choose two completed audits to compare."
    : audits[0].audit.status !== "completed" || audits[1].audit.status !== "completed"
      ? "Both audits must be completed."
      : audits[0].site.id !== audits[1].site.id
        ? "These audits are for different websites. Compare scans of the same site."
        : audits[0].audit.id === audits[1].audit.id
          ? "Pick two different scans."
          : null;
  if (problem) {
    return (
      <>
        <PageHeader title="Compare audits" />
        <p className="rounded-lg border bg-card px-4 py-6 text-muted-foreground">
          {problem} <Link href="/audits" className="text-primary hover:underline">Go to audit history</Link>.
        </p>
      </>
    );
  }

  // Always compare older -> newer regardless of selection order.
  const [prev, curr] = [audits[0]!, audits[1]!].sort((x, y) => (x.audit.completedAt?.getTime() ?? 0) - (y.audit.completedAt?.getTime() ?? 0));
  const result = compareAudits(toInput(prev), toInput(curr));
  const scoreLabel = (key: string) => (key === "overall" ? "Overall score" : CATEGORY_LABELS[key as Category] ?? key.replace(/^\w/, (c) => c.toUpperCase()));

  return (
    <>
      <PageHeader
        title={`${curr.site.host}: scan comparison`}
        description={
          <>
            Audit #{prev.audit.id} ({formatDate(prev.audit.completedAt)}) compared with audit #{curr.audit.id} ({formatDate(curr.audit.completedAt)}). Issues are matched by stable IDs, so a reworded finding is still the same issue.
          </>
        }
      />

      <dl className="grid grid-cols-2 divide-x rounded-xl border bg-card sm:grid-cols-4">
        {[
          ["Fixed", result.fixed.length, "text-sev-pass"],
          ["New", result.introduced.length, result.introduced.length ? "text-sev-critical" : ""],
          ["Outstanding", result.outstanding.length, ""],
          ["Pages added / removed", `${result.pagesAdded.length} / ${result.pagesRemoved.length}`, ""],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="px-4 py-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className={cn("mt-1 font-heading text-2xl font-semibold tabular-nums", tone as string)}>{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Scores">
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Measure</TableHead>
                <TableHead className="text-right">Previous</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead>Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.scores.map((s) => (
                <TableRow key={s.key}>
                  <TableCell className="font-medium">{scoreLabel(s.key)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.previous ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.current ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.delta == null ? "—" : `${s.delta > 0 ? "+" : ""}${s.delta}`}</TableCell>
                  <TableCell><TrendMark trend={s.trend} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title={`Fixed issues (${result.fixed.length})`} description="Present in the previous scan, gone in the current one.">
        <IssueTable issues={result.fixed} empty="No issues were fixed between these scans." />
      </Section>
      <Section title={`New issues (${result.introduced.length})`} description="Not present in the previous scan.">
        <IssueTable issues={result.introduced} empty="No new issues were introduced." />
      </Section>
      <Section title={`Outstanding issues (${result.outstanding.length})`}>
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm text-primary">Show outstanding issues</summary>
          <ul className="divide-y border-t text-sm">
            {result.outstanding.map(({ current, previous, severityChanged }) => (
              <li key={current.issueKey} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <SeverityBadge severity={current.severity} />
                <span className="font-medium">{current.title}</span>
                <span className="font-mono text-xs text-muted-foreground">{shortUrl(current.url)}</span>
                {severityChanged && <span className="text-xs text-muted-foreground">(was {previous.severity})</span>}
              </li>
            ))}
          </ul>
        </details>
      </Section>

      <Section title="Pages added and removed" description="Based on the pages each crawl reached; a page can drop out because of the 25-page crawl limit, not only because it was deleted.">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["Added", result.pagesAdded],
            ["Removed", result.pagesRemoved],
          ].map(([label, list]) => (
            <div key={label as string} className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold">{label as string} ({(list as string[]).length})</h3>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {(list as string[]).length ? (list as string[]).map((u) => <li key={u} className="break-all">{u}</li>) : <li className="font-sans text-sm text-muted-foreground">None</li>}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Metadata changes (${result.metadataChanges.length})`}>
        {result.metadataChanges.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">No titles, descriptions, H1s, canonicals, robots directives or statuses changed on pages present in both scans.</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Previous</TableHead>
                  <TableHead>Current</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.metadataChanges.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{shortUrl(m.url)}</TableCell>
                    <TableCell>{FIELD_LABEL[m.field]}</TableCell>
                    <TableCell className="max-w-72 whitespace-normal text-muted-foreground">{m.previous ?? "(none)"}</TableCell>
                    <TableCell className="max-w-72 whitespace-normal">{m.current ?? "(none)"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Performance differences" description="PageSpeed lab results for pages tested in both scans. Lab results vary by a few points between runs.">
        {result.performance.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">No pages had PageSpeed results in both scans.</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Previous</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead>Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.performance.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{shortUrl(p.url)}</TableCell>
                    <TableCell className="capitalize">{p.strategy}</TableCell>
                    <TableCell>{METRIC_LABEL[p.metric]}</TableCell>
                    <TableCell className="text-right tabular-nums">{metricValue(p.metric, p.previous)}</TableCell>
                    <TableCell className="text-right tabular-nums">{metricValue(p.metric, p.current)}</TableCell>
                    <TableCell><TrendMark trend={p.trend} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </>
  );
}

export default function ComparePage(props: PageProps<"/audits/compare">) {
  return (
    <Suspense fallback={<Loading />}>
      <CompareContent {...props} />
    </Suspense>
  );
}
