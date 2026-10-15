import { Suspense } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Section } from "@/components/app/page-header";
import { TrendChart } from "@/components/app/trend-chart";
import { formatDate, shortUrl } from "@/components/app/format";
import { ConnectGoogleForm, DisconnectGoogleButton, PropertyLinker, RefreshSearchButton, type PropertyOption } from "@/components/beta/search-console-controls";
import { explainCoverage } from "@/lib/audit/index-reasons";
import { REPORT_DAYS } from "@/lib/integrations/search-console/collect";
import { fillDailySeries, propertyMatchesSite } from "@/lib/integrations/search-console/google";
import { searchConsoleFor } from "@/lib/saas/gsc-http";
import { auditsFor } from "@/lib/saas/audit-http";
import { tenantRepository } from "@/lib/saas/repository";
import { getCustomerPage } from "@/lib/saas/page";
import { SearchConsoleError } from "@/lib/saas/search-console";
import { cn } from "@/lib/utils";

export const metadata = { title: "Search performance" };

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtPos = (n: number) => n.toFixed(1);

/** Outcome codes from the OAuth callback; only fixed messages are shown, never reflected text. */
const FLASH: Record<string, { ok?: boolean; text: string }> = {
  connected: { ok: true, text: "Google Search Console connected. Link each website to its property below." },
  state_invalid: { text: "That Google sign-in expired or was already used. Connect again." },
  session_mismatch: { text: "That Google sign-in was started in a different session or browser, so nothing was saved. Connect again from this page." },
  denied: { text: "Access was not granted on Google's consent screen." },
  no_code: { text: "Google sign-in failed. Try connecting again." },
  failed: { text: "Google sign-in failed. Try connecting again." },
  no_refresh_token: { text: "Google didn't grant long-lived access. Remove this app at myaccount.google.com/permissions and connect again." },
  scope_missing: { text: "Search Console access wasn't granted. Tick the Search Console permission on Google's consent screen." },
  scope_too_broad: { text: "Google granted more access than this app asks for, so nothing was saved. Remove the app at myaccount.google.com/permissions and connect again." },
  identity_missing: { text: "Google didn't confirm which account was used. Try again." },
  not_configured: { text: "Google Search Console isn't available for the beta yet." },
  busy: { text: "Too many connection attempts. Try again in a few minutes." },
};

function Delta({ current, previous, lowerIsBetter = false, format }: { current: number; previous: number | undefined; lowerIsBetter?: boolean; format: (n: number) => string }) {
  if (previous === undefined || (previous === 0 && current === 0)) return <span className="text-xs text-muted-foreground">No earlier data</span>;
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) return <span className="text-xs text-muted-foreground">No change vs previous {REPORT_DAYS} days</span>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={cn("text-xs font-medium", better ? "text-sev-pass" : "text-sev-critical")}>
      {diff > 0 ? "+" : "−"}{format(Math.abs(diff))} vs previous {REPORT_DAYS} days
    </span>
  );
}

type Row = { key: string; clicks: number; impressions: number; ctr: number; position: number };
function RowsTable({ rows, keyLabel, isUrl, emptyText }: { rows: Row[]; keyLabel: string; isUrl?: boolean; emptyText: string }) {
  if (!rows.length) return <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{keyLabel}</TableHead>
            <TableHead className="text-right">Clicks</TableHead>
            <TableHead className="text-right">Impressions</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">Position</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className={cn("max-w-80 truncate", isUrl && "font-mono text-xs")} title={r.key}>{isUrl ? shortUrl(r.key) : r.key}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(r.clicks)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(r.impressions)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPct(r.ctr)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPos(r.position)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const VERDICT: Record<string, { label: string; className: string }> = {
  PASS: { label: "Indexed", className: "text-sev-pass" },
  NEUTRAL: { label: "Not indexed", className: "text-sev-medium" },
  FAIL: { label: "Error", className: "text-sev-critical" },
};

async function SearchContent({ searchParams }: PageProps<"/beta/search-console">) {
  const params = await searchParams;
  const { runtime, tenant } = await getCustomerPage();
  const gsc = searchConsoleFor(runtime, tenant);
  const [status, websites] = await Promise.all([gsc.status(), tenantRepository(runtime.db, tenant, runtime.limits).listWebsites()]);
  const flash = typeof params.gsc === "string" ? FLASH[params.gsc] : undefined;
  const requested = typeof params.site === "string" && /^[1-9]\d{0,9}$/.test(params.site) ? Number(params.site) : NaN;
  const site = websites.find((w) => w.id === requested) ?? websites.find((w) => status.links.some((l) => l.websiteId === w.id)) ?? websites[0];
  const returnTo = `/beta/search-console${site ? `?site=${site.id}` : ""}`;

  const header = (
    <PageHeader
      title="Search performance"
      description="Real clicks, impressions, rankings and index status from your own Google Search Console. This shows how your site performs in Google; it is kept separate from the on-site SEO health score and is visible only to your account."
    />
  );
  const banner = flash && (
    <Alert variant={flash.ok ? "default" : "destructive"} className="mb-6">
      {flash.ok ? <CheckCircle2 /> : <AlertCircle />}
      <AlertTitle>{flash.ok ? "Connected" : "Search Console connection"}</AlertTitle>
      <AlertDescription>{flash.text}</AlertDescription>
    </Alert>
  );

  if (!status.configured) {
    return (
      <>
        {header}
        <p className="max-w-2xl rounded-lg border bg-card px-4 py-6 text-muted-foreground">Google Search Console isn’t available for the beta yet. Your audits still run; Google index status is shown as not verified.</p>
      </>
    );
  }

  if (!status.account) {
    return (
      <>
        {header}
        {banner}
        <section className="max-w-2xl rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold">Connect Google Search Console</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with the Google account that can see your websites in Search Console. The app asks for read-only access, never changes anything in your account and never sees your Google password.
            The connection belongs to your account only.
          </p>
          <div className="mt-5"><ConnectGoogleForm returnTo={returnTo} /></div>
        </section>
      </>
    );
  }

  const revoked = status.account.status !== "active";
  let properties: PropertyOption[] = [];
  let propertiesError: string | null = null;
  if (!revoked && site) {
    try {
      properties = (await gsc.properties()).filter((p) => p.permissionLevel !== "siteUnverifiedUser").map((p) => ({ property: p.property, type: p.type, matches: propertyMatchesSite(p.property, site.host) }));
    } catch (error) {
      if (!(error instanceof SearchConsoleError)) throw error;
      propertiesError = error.message;
    }
  }
  const overview = site ? await gsc.overview(site.id) : null;
  const latest = overview?.latest ?? null;
  const audits = site ? (await auditsFor(runtime, tenant).history({ websiteId: site.id, limit: 20 })).filter((a) => a.status === "completed") : [];
  const byAudit = new Map((overview?.history ?? []).filter((h) => h.auditId).map((h) => [h.auditId, h]));

  return (
    <>
      {header}
      {banner}
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
        {revoked ? <AlertCircle className="size-4 text-destructive" aria-hidden /> : <CheckCircle2 className="size-4 text-sev-pass" aria-hidden />}
        <span>
          {revoked ? "Google access needs reconnecting" : "Connected"} as <span className="font-medium">{status.account.email ?? "a Google account"}</span> since {formatDate(status.account.connectedAt)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {revoked && <ConnectGoogleForm returnTo={returnTo} label="Reconnect" variant="outline" />}
          <DisconnectGoogleButton />
        </span>
      </section>
      {revoked && <p className="mt-2 text-sm text-destructive">{status.account.lastError ?? "Google access was revoked or expired."} Data below is the last verified copy.</p>}

      {!site ? (
        <p className="mt-6 rounded-lg border bg-card px-4 py-6 text-muted-foreground">
          Add a website first, then link it to its Search Console property here. <Link href="/beta/websites" className="text-primary hover:underline">Websites</Link>
        </p>
      ) : (
        <>
          <Section
            title={site.displayName ?? site.host}
            description={overview?.link ? `Linked to ${overview.link.property}${overview.link.lastRefreshedAt ? ` · last fetched ${formatDate(overview.link.lastRefreshedAt)}` : ""}` : "Not linked: Google data for this website is not verified."}
            actions={websites.length > 1 && (
              <form className="flex items-center gap-2 text-sm">
                <label htmlFor="sc-site" className="text-muted-foreground">Website</label>
                <select id="sc-site" name="site" defaultValue={site.id} className="h-8 rounded-md border border-input bg-card px-2">
                  {websites.map((w) => <option key={w.id} value={w.id}>{w.displayName ?? w.host}</option>)}
                </select>
                <button className="h-8 rounded-md border px-3 text-sm">Show</button>
              </form>
            )}
          >
            <div className="rounded-lg border bg-card p-4">
              {revoked ? <p className="text-sm text-muted-foreground">Reconnect Google to change the linked property.</p>
                : propertiesError ? <p className="text-sm text-destructive">Couldn’t load your Search Console properties: {propertiesError}</p>
                : <PropertyLinker websiteId={site.id} host={site.host} properties={properties} current={overview?.link?.property ?? null} />}
            </div>
          </Section>

          {overview?.link && (
            <>
              <Section
                title={`Last ${REPORT_DAYS} days`}
                description={latest ? `${latest.startDate} to ${latest.endDate} · Google’s data lags 2–3 days · fetched ${formatDate(latest.fetchedAt)}` : "No data fetched yet."}
                actions={!revoked && <RefreshSearchButton websiteId={site.id} active={overview.refresh === "queued" || overview.refresh === "running"} />}
              >
                {overview.link.lastError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle />
                    <AlertTitle>The latest fetch didn’t complete</AlertTitle>
                    <AlertDescription>{overview.link.lastError}{latest ? " Showing the most recent verified data." : ""}</AlertDescription>
                  </Alert>
                )}
                {!latest && !overview.link.lastError && (
                  <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">
                    {overview.refresh ? "Fetching your data from Google. This usually takes under a minute." : "No data has been fetched yet. Use Refresh data."}
                  </p>
                )}
                {latest && (
                  <>
                    <dl className="grid grid-cols-2 divide-x divide-y rounded-xl border bg-card lg:grid-cols-4 lg:divide-y-0">
                      {([
                        ["Clicks", fmtInt(latest.clicks ?? 0), <Delta key="c" current={latest.clicks ?? 0} previous={latest.previous?.clicks} format={fmtInt} />],
                        ["Impressions", fmtInt(latest.impressions ?? 0), <Delta key="i" current={latest.impressions ?? 0} previous={latest.previous?.impressions} format={fmtInt} />],
                        ["Average CTR", latest.impressions ? fmtPct(latest.ctr ?? 0) : "—", <Delta key="t" current={latest.ctr ?? 0} previous={latest.previous?.impressions ? latest.previous.ctr : undefined} format={fmtPct} />],
                        ["Average position", latest.impressions ? fmtPos(latest.position ?? 0) : "—", <Delta key="p" current={latest.position ?? 0} previous={latest.previous?.impressions ? latest.previous.position : undefined} lowerIsBetter format={fmtPos} />],
                      ] as const).map(([label, value, delta]) => (
                        <div key={label} className="px-4 py-4">
                          <dt className="text-sm text-muted-foreground">{label}</dt>
                          <dd className="mt-1 font-heading text-2xl font-semibold tabular-nums">{value}</dd>
                          <dd>{delta}</dd>
                        </div>
                      ))}
                    </dl>
                    {!latest.impressions && (
                      <p className="mt-3 flex gap-2 text-sm text-muted-foreground">
                        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                        Google reported no search impressions for this property in this period. This is normal for new or low-traffic sites and is not an error; figures appear once Google shows the site in results.
                      </p>
                    )}
                  </>
                )}
              </Section>

              {latest && latest.daily.length > 0 && (
                <Section title="Daily trend" description="Clicks and impressions use different scales, so each has its own chart. Days without impressions are shown as zero.">
                  <div className="grid gap-4 lg:grid-cols-2">
                    {([["clicks", "Clicks per day", "#2a78d6"], ["impressions", "Impressions per day", "#11a094"]] as const).map(([key, title, color]) => (
                      <div key={key} className="rounded-lg border bg-card p-4">
                        <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                        <TrendChart
                          ariaLabel={`${title} from ${latest.startDate} to ${latest.endDate}`}
                          data={fillDailySeries(latest.daily, latest.startDate, latest.endDate).map((d) => ({ label: d.date.slice(5), [key]: d[key] }))}
                          series={[{ key, name: title, color }]}
                          height={200}
                          yDomain={[0, "auto"]}
                          valueFormat="integer"
                        />
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {latest && (
                <div className="grid gap-x-6 lg:grid-cols-2">
                  <Section title="Top search queries">
                    <RowsTable
                      rows={latest.topQueries}
                      keyLabel="Query"
                      emptyText={(latest.impressions ?? 0) > 0 ? "Google returned no query rows. It hides rarely searched (anonymised) queries for privacy, which is common when impressions are low; the totals above still include them." : "No search impressions in this period."}
                    />
                  </Section>
                  <Section title="Top landing pages">
                    <RowsTable rows={latest.topPages} keyLabel="Page" isUrl emptyText="No landing pages had impressions in this period." />
                  </Section>
                </div>
              )}

              {latest && (
                <Section title="Google index status" description="From Google’s URL Inspection API for the most important pages of your latest audit (homepage and best-linked pages first). This is Google’s own view of each URL.">
                  {latest.inspections.length === 0 ? (
                    <p className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">No pages inspected yet. Run an audit of this website, then refresh the data: inspections use the pages the audit crawled.</p>
                  ) : (
                    <div className="rounded-lg border bg-card">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Page</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Google’s reason and what to do</TableHead>
                            <TableHead>Last crawled</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {latest.inspections.map((i) => {
                            const v = VERDICT[i.verdict];
                            const reason = explainCoverage(i.coverageState);
                            return (
                              <TableRow key={i.url}>
                                <TableCell className="font-mono text-xs">{shortUrl(i.url)}</TableCell>
                                <TableCell className={cn("text-sm font-medium", i.error ? "text-muted-foreground" : v?.className ?? "text-muted-foreground")}>{i.error ? "Not checked" : v?.label ?? i.verdict}</TableCell>
                                <TableCell className="max-w-96 whitespace-normal text-xs text-muted-foreground">
                                  {i.error ?? (
                                    <>
                                      <span className="text-foreground">{i.coverageState ?? "—"}</span>
                                      {reason && i.verdict !== "PASS" && <><br />{reason.explanation} {reason.action}</>}
                                    </>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">{i.lastCrawlTime ? formatDate(i.lastCrawlTime) : "—"}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Section>
              )}

              {audits.length > 0 && (
                <Section title="Technical health and Google performance" description="Each completed audit’s on-site health score next to the Google data fetched with that audit. The two are measured separately.">
                  <div className="rounded-lg border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Audit</TableHead>
                          <TableHead className="text-right">On-site health</TableHead>
                          <TableHead className="text-right">Clicks ({REPORT_DAYS} days)</TableHead>
                          <TableHead className="text-right">Impressions</TableHead>
                          <TableHead className="text-right">Avg position</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {audits.map((a) => {
                          const g = byAudit.get(a.id);
                          return (
                            <TableRow key={a.id}>
                              <TableCell><Link href={`/beta/audits/${a.id}`} className="text-primary hover:underline">#{a.id}</Link> <span className="text-xs text-muted-foreground">{formatDate(a.completedAt)}</span></TableCell>
                              <TableCell className="text-right tabular-nums">{a.overallScore ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{g ? fmtInt(g.clicks) : "Not verified"}</TableCell>
                              <TableCell className="text-right tabular-nums">{g ? fmtInt(g.impressions) : "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{g && g.impressions ? fmtPos(g.position) : "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </Section>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

export default function SearchConsolePage(props: PageProps<"/beta/search-console">) {
  return (
    <Suspense fallback={<Loading />}>
      <SearchContent {...props} />
    </Suspense>
  );
}
