import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoAuditYet } from "@/components/app/empty-state";
import { PageHeader, Section } from "@/components/app/page-header";
import { SCORE_SERIES_COLORS } from "@/components/app/chart-colors";
import { TrendChart } from "@/components/app/trend-chart";
import { formatDate } from "@/components/app/format";
import { listAudits, listSites } from "@/lib/audit/repository";
import { siteProgress, type MetricChange } from "@/lib/audit/progress";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/audit/types";
import { getSiteConnection } from "@/lib/integrations/search-console/service";
import { cn } from "@/lib/utils";

export const metadata = { title: "SEO progress" };

function fmt(value: number | null, format: MetricChange["format"]): string {
  if (value === null) return "—";
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  if (format === "position") return value.toFixed(1);
  return Math.round(value).toLocaleString("en-GB");
}

function ChangeRow({ m }: { m: MetricChange }) {
  const Icon = m.trend === "improved" ? ArrowUpRight : m.trend === "regressed" ? ArrowDownRight : Minus;
  const tone = m.trend === "improved" ? "text-sev-pass" : m.trend === "regressed" ? "text-sev-critical" : "text-muted-foreground";
  const word = { improved: "Improved", regressed: "Worse", unchanged: "No change", unavailable: "Not comparable" }[m.trend];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <span className="min-w-44 font-medium">{m.label}</span>
      <span className="tabular-nums text-muted-foreground">{fmt(m.previous, m.format)}</span>
      <span aria-hidden className="text-muted-foreground">→</span>
      <span className="font-heading text-lg font-semibold tabular-nums">{fmt(m.current, m.format)}</span>
      <span className={cn("ml-auto inline-flex items-center gap-1 text-sm font-medium", tone)}>
        <Icon className="size-4" aria-hidden />
        {word}
      </span>
      {m.note && <span className="w-full text-xs text-muted-foreground">{m.note}</span>}
    </li>
  );
}

async function ProgressContent(props: PageProps<"/progress">) {
  await connection();
  const params = await props.searchParams;
  const sites = listSites().filter((s) => listAudits({ siteId: s.id, status: "completed", limit: 1 }).length);
  if (!sites.length) return <NoAuditYet message="Progress appears once a site has at least one completed audit." />;
  const requested = typeof params.site === "string" ? Number.parseInt(params.site, 10) : NaN;
  const site = sites.find((s) => s.id === requested) ?? sites.find((s) => s.id === listAudits({ status: "completed", limit: 1 })[0]?.siteId) ?? sites[0];
  const p = siteProgress(site.id);
  const linked = !!getSiteConnection(site.id);
  const [prev, curr] = [p.audits.at(-2), p.audits.at(-1)];

  // Include the time when several audits share a day, so x-axis labels stay distinct.
  const days = p.audits.map((a) => a.completedAt.toISOString().slice(5, 10));
  const sameDay = new Set(days).size < days.length;
  const auditLabel = (d: Date) => (sameDay ? d.toISOString().slice(5, 16).replace("T", " ") : d.toISOString().slice(5, 10));
  const scoreData = p.audits.map((a) => ({ label: auditLabel(a.completedAt), overall: a.overall, ...a.categories }));
  const issueData = p.audits.map((a) => ({ label: auditLabel(a.completedAt), critical: a.counts.critical ?? 0, high: a.counts.high ?? 0, medium: a.counts.medium ?? 0, low: a.counts.low ?? 0 }));
  const searchData = p.snapshots.map((s) => ({ label: s.endDate.slice(5), clicks: s.clicks, impressions: s.impressions, position: (s.impressions ?? 0) > 0 ? s.position : null }));

  return (
    <>
      <PageHeader
        title="SEO progress"
        description="Whether the site is getting healthier and performing better in Google over time. On-site health comes from audits; search results come from Search Console snapshots."
        actions={
          sites.length > 1 && (
            <form className="flex items-center gap-2 text-sm">
              <label htmlFor="progress-site" className="text-muted-foreground">Website</label>
              <select id="progress-site" name="site" defaultValue={site.id} className="h-8 rounded-md border border-input bg-card px-2">
                {sites.map((s) => <option key={s.id} value={s.id}>{s.host}</option>)}
              </select>
              <button className={buttonVariants({ variant: "outline", size: "sm" })}>Show</button>
            </form>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold">On-site health</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {prev ? `Audit #${prev.id} (${formatDate(prev.completedAt)}) → audit #${curr!.id} (${formatDate(curr!.completedAt)})` : "Only one audit so far. Run another to see change."}
          </p>
          <ul className="divide-y rounded-lg border bg-card">{p.onSite.map((m) => <ChangeRow key={m.label} m={m} />)}</ul>
          {p.issues && (
            <p className="mt-2 text-sm">
              <span className="font-semibold text-sev-pass">{p.issues.fixed} fixed</span> · <span className={cn("font-semibold", p.issues.introduced && "text-sev-critical")}>{p.issues.introduced} new</span> · {p.issues.outstanding} outstanding{" "}
              <Link href={`/audits/compare?a=${prev!.id}&b=${curr!.id}`} className="text-primary hover:underline">See details</Link>
            </p>
          )}
        </section>
        <section>
          <h2 className="text-lg font-semibold">Google search performance</h2>
          <p className="mb-3 text-sm text-muted-foreground">{p.searchBasis ?? (linked ? "No Search Console data fetched yet." : "Search Console isn’t linked for this site, so search performance isn’t tracked.")}</p>
          {p.search.length ? (
            <ul className="divide-y rounded-lg border bg-card">{p.search.map((m) => <ChangeRow key={m.label} m={m} />)}</ul>
          ) : (
            <p className="rounded-lg border border-dashed bg-card px-4 py-4 text-sm text-muted-foreground">
              Real impressions, clicks and rankings appear here once Search Console is connected. <Link href={`/search-console?site=${site.id}`} className="text-primary hover:underline">{linked ? "Fetch data" : "Connect Search Console"}</Link>
            </p>
          )}
        </section>
      </div>

      {p.audits.length > 1 && (
        <Section title="On-site scores over time" description="Each point is a completed audit. A category that wasn’t measured in an audit has no point for it.">
          <div className="rounded-lg border bg-card p-4">
            <TrendChart
              ariaLabel="On-site SEO scores per audit"
              data={scoreData}
              yDomain={[0, 100]}
              series={[{ key: "overall", name: "Overall", color: SCORE_SERIES_COLORS.overall, strong: true }, ...CATEGORIES.map((c) => ({ key: c, name: CATEGORY_LABELS[c], color: SCORE_SERIES_COLORS[c] }))]}
            />
          </div>
        </Section>
      )}

      {p.audits.length > 1 && (
        <Section title="Detected issues over time">
          <div className="rounded-lg border bg-card p-4">
            <TrendChart
              ariaLabel="Issues by severity per audit"
              data={issueData}
              yDomain={[0, "auto"]}
              series={[
                { key: "critical", name: "Critical", color: "var(--sev-critical)" },
                { key: "high", name: "High", color: "var(--sev-high)" },
                { key: "medium", name: "Medium", color: "var(--sev-medium)" },
                { key: "low", name: "Low", color: "var(--sev-low)" },
              ]}
            />
          </div>
        </Section>
      )}

      {p.snapshots.length > 1 && (
        <Section title="Search performance over time" description="Each point is a stored 28-day Search Console window, labelled by its end date. Windows can overlap when snapshots are close together.">
          <div className="grid gap-4 lg:grid-cols-3">
            {([["clicks", "Clicks (28 days)", "#2a78d6", false], ["impressions", "Impressions (28 days)", "#11a094", false], ["position", "Average position (lower is better)", "#4a3aa7", true]] as const).map(([key, title, color, reversed]) => (
              <div key={key} className="rounded-lg border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                <TrendChart ariaLabel={title} data={searchData.map((d) => ({ label: d.label, [key]: d[key] }))} series={[{ key, name: title, color }]} height={180} reversed={reversed} valueFormat={key === "position" ? "decimal1" : "integer"} />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Audit timeline">
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Audit</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">On-site health</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
                <TableHead className="text-right">Critical</TableHead>
                <TableHead className="text-right">High</TableHead>
                <TableHead className="text-right">Medium</TableHead>
                <TableHead className="text-right">Low</TableHead>
                <TableHead className="sr-only">Compare</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...p.audits].reverse().map((a, i, list) => (
                <TableRow key={a.id}>
                  <TableCell><Link href={`/?audit=${a.id}`} className="font-medium text-primary hover:underline">#{a.id}</Link></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(a.completedAt)}</TableCell>
                  <TableCell className="text-right font-heading font-semibold tabular-nums">
                    {a.overall ?? "—"}
                    {a.provisional && <span className="ml-1 text-xs font-normal text-sev-medium">provisional</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(a.coverage * 100)}%</TableCell>
                  {(["critical", "high", "medium", "low"] as const).map((k) => <TableCell key={k} className="text-right tabular-nums">{a.counts[k] ?? 0}</TableCell>)}
                  <TableCell className="text-right">
                    {list[i + 1] && <Link href={`/audits/compare?a=${list[i + 1].id}&b=${a.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Compare with previous</Link>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </>
  );
}

export default function ProgressPage(props: PageProps<"/progress">) {
  return (
    <Suspense fallback={<Loading />}>
      <ProgressContent {...props} />
    </Suspense>
  );
}
