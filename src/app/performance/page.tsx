import { Suspense } from "react";
import Loading from "@/app/loading";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckList } from "@/components/app/check-list";
import { CategoryHeader } from "@/components/app/category-header";
import { NoAuditYet } from "@/components/app/empty-state";
import { Section } from "@/components/app/page-header";
import { TONE_COLOR, formatMs, scoreTone, shortUrl } from "@/components/app/format";
import { loadAuditView } from "@/lib/audit/views";
import type { PerfRow } from "@/lib/audit/repository";

export const metadata = { title: "Performance" };

/** Google's published thresholds: [good, poor]. */
const THRESHOLDS = { lcp: [2500, 4000], cls: [0.1, 0.25], tbt: [200, 600], inp: [200, 500], ttfb: [600, 1800] } as const;

function Metric({ value, kind, format }: { value: number | null; kind: keyof typeof THRESHOLDS; format: (v: number) => string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const [good, poor] = THRESHOLDS[kind];
  const color = value <= good ? "var(--sev-pass)" : value <= poor ? "var(--sev-medium)" : "var(--sev-critical)";
  return <span className="font-medium tabular-nums" style={{ color }}>{format(value)}</span>;
}

function Score({ value }: { value: number | null }) {
  return (
    <span className="font-heading text-lg font-semibold tabular-nums" style={{ color: TONE_COLOR[scoreTone(value)] }}>
      {value ?? "—"}
    </span>
  );
}

async function PerformanceContent({ searchParams }: PageProps<"/performance">) {
  const view = await loadAuditView(searchParams);
  if (!view.full) return <NoAuditYet />;
  const { checks, issues, performance, meta } = view.full;
  const ok = performance.filter((p) => p.status === "ok");
  const urls = [...new Set(performance.map((p) => p.url))];
  const errors = [...new Set(performance.filter((p) => p.status !== "ok").map((p) => p.error))];

  return (
    <>
      <CategoryHeader view={view} category="performance" title="Performance" description="Google PageSpeed Insights (Lighthouse lab data plus Chrome UX Report field data where Google has it)." />

      {ok.length === 0 && (
        <Alert className="mb-6">
          <Info />
          <AlertTitle>No PageSpeed data for this audit</AlertTitle>
          <AlertDescription>
            <p>{meta?.performanceSkippedReason ?? errors[0] ?? "PageSpeed Insights did not return results."}</p>
            {!meta?.pagespeedKeyConfigured && (
              <p className="mt-1">
                Without an API key Google allows very few anonymous requests. Create a free key in Google Cloud (enable the PageSpeed Insights API), add it as <code className="font-mono text-xs">PAGESPEED_API_KEY</code> in <code className="font-mono text-xs">.env.local</code>, restart, and re-run the audit. Performance checks are shown as not verified, not as failures.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <CheckList checks={checks.filter((c) => c.category === "performance")} issues={issues} />

      {urls.length > 0 && (
        <Section title="Mobile vs desktop" description="Lab metrics come from a single Lighthouse run and vary between runs. Field metrics (real Chrome users, 75th percentile) are more reliable when available.">
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
                  <TableHead className="text-right">FCP</TableHead>
                  <TableHead className="text-right">Server</TableHead>
                  <TableHead className="text-right">Field INP</TableHead>
                  <TableHead className="text-right">Field LCP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {urls.flatMap((url) =>
                  (["mobile", "desktop"] as const).map((strategy, i) => {
                    const r = performance.find((p) => p.url === url && p.strategy === strategy) as PerfRow | undefined;
                    return (
                      <TableRow key={`${url}-${strategy}`}>
                        <TableCell className="font-mono text-xs">{i === 0 ? shortUrl(url) : ""}</TableCell>
                        <TableCell className="capitalize">{strategy}</TableCell>
                        {!r || r.status !== "ok" ? (
                          <TableCell colSpan={8} className="whitespace-normal text-xs text-muted-foreground">Not measured: {r?.error ?? "not run"}</TableCell>
                        ) : (
                          <>
                            <TableCell className="text-right"><Score value={r.performanceScore} /></TableCell>
                            <TableCell className="text-right"><Metric value={r.lcpMs} kind="lcp" format={formatMs} /></TableCell>
                            <TableCell className="text-right"><Metric value={r.cls} kind="cls" format={(v) => v.toFixed(3)} /></TableCell>
                            <TableCell className="text-right"><Metric value={r.tbtMs} kind="tbt" format={formatMs} /></TableCell>
                            <TableCell className="text-right tabular-nums">{formatMs(r.fcpMs)}</TableCell>
                            <TableCell className="text-right"><Metric value={r.ttfbMs} kind="ttfb" format={formatMs} /></TableCell>
                            <TableCell className="text-right"><Metric value={r.fieldInpMs} kind="inp" format={formatMs} /></TableCell>
                            <TableCell className="text-right"><Metric value={r.fieldLcpMs} kind="lcp" format={formatMs} /></TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  }),
                )}
              </TableBody>
            </Table>
          </div>
          {ok.some((r) => r.fieldSource === "origin") && <p className="mt-2 text-xs text-muted-foreground">Some field data is origin-level (whole site), because Google lacked enough data for the individual URL.</p>}
        </Section>
      )}

      {ok.some((r) => r.opportunities.length) && (
        <Section title="Lighthouse diagnostics" description="Audits Lighthouse scored below 90%, largest estimated savings first.">
          <div className="grid gap-4 lg:grid-cols-2">
            {ok.filter((r) => r.opportunities.length).map((r) => (
              <div key={r.id} className="rounded-lg border bg-card p-4">
                <h3 className="text-sm font-semibold">
                  <span className="font-mono text-xs font-normal">{shortUrl(r.url)}</span> · <span className="capitalize">{r.strategy}</span>
                </h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {r.opportunities.map((o) => (
                    <li key={o.id} className="flex justify-between gap-3">
                      <span>{o.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{o.displayValue ?? (o.savingsMs ? `~${formatMs(o.savingsMs)}` : "")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

export default function PerformancePage(props: PageProps<"/performance">) {
  return (
    <Suspense fallback={<Loading />}>
      <PerformanceContent {...props} />
    </Suspense>
  );
}
