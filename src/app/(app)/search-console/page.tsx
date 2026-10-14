import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Section } from "@/components/app/page-header";
import { DisconnectGoogleButton, PropertyLinker, RefreshSnapshotButton } from "@/components/app/search-console-controls";
import { TrendChart } from "@/components/app/trend-chart";
import { formatDate, shortUrl } from "@/components/app/format";
import { listAudits, listSites } from "@/lib/audit/repository";
import { fillDailySeries, suggestProperty } from "@/lib/integrations/search-console/google";
import {
  availableProperties,
  getGoogleAccount,
  getSiteConnection,
  latestSnapshot,
  listSnapshots,
  REPORT_DAYS,
  searchConsoleSetup,
  type SnapshotRow,
} from "@/lib/integrations/search-console/service";
import { cn } from "@/lib/utils";

export const metadata = { title: "Search performance" };

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtPos = (n: number) => n.toFixed(1);

function Delta({ current, previous, lowerIsBetter = false, format }: { current: number; previous: number | undefined; lowerIsBetter?: boolean; format: (n: number) => string }) {
  if (previous === undefined || (previous === 0 && current === 0)) return <span className="text-xs text-muted-foreground">No earlier data</span>;
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) return <span className="text-xs text-muted-foreground">No change vs previous {REPORT_DAYS} days</span>;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={cn("text-xs font-medium", better ? "text-sev-pass" : "text-sev-critical")}>
      {diff > 0 ? "+" : "−"}
      {format(Math.abs(diff))} vs previous {REPORT_DAYS} days
    </span>
  );
}

function RowsTable({ rows, keyLabel, isUrl, emptyText = "Google reported no data for this period." }: { rows: NonNullable<SnapshotRow["topQueries"]>; keyLabel: string; isUrl?: boolean; emptyText?: string }) {
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

function SetupInstructions({ missing, redirectUri }: { missing: string[]; redirectUri: string }) {
  return (
    <section className="max-w-3xl rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Set up Google Search Console</h2>
      <p className="mt-1 text-sm text-muted-foreground">Missing configuration: <span className="font-mono text-xs">{missing.join(", ")}</span></p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
        <li>In Google Cloud Console, create (or choose) a project and enable the <strong>Google Search Console API</strong>.</li>
        <li>Configure the OAuth consent screen (External; add yourself as a test user while the app is in testing).</li>
        <li>
          Create an <strong>OAuth client ID</strong> of type <em>Web application</em> with this authorised redirect URI:
          <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-xs">{redirectUri}</code>
        </li>
        <li>
          Add to <span className="font-mono text-xs">.env.local</span>: <span className="font-mono text-xs">GOOGLE_CLIENT_ID</span>, <span className="font-mono text-xs">GOOGLE_CLIENT_SECRET</span>, and <span className="font-mono text-xs">APP_SECRET</span> (generate with <span className="font-mono text-xs">openssl rand -base64 32</span>). Set <span className="font-mono text-xs">APP_URL</span> if the app isn’t at http://localhost:3000.
        </li>
        <li>Restart the app and return here to connect.</li>
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">The app requests read-only Search Console access. The refresh token is encrypted at rest and can be revoked here or at myaccount.google.com/permissions.</p>
    </section>
  );
}

async function SearchConsoleContent({ searchParams }: PageProps<"/search-console">) {
  await connection();
  const params = await searchParams;
  const setup = searchConsoleSetup();
  const flashError = typeof params.error === "string" ? params.error : null;
  const justConnected = params.connected === "1";

  const header = (
    <PageHeader
      title="Search performance"
      description={<>Real impressions, clicks and rankings from Google Search Console. This is how the site performs in Google; it is kept separate from the on-site SEO health score.</>}
    />
  );
  if (!setup.configured) return <>{header}<SetupInstructions missing={setup.missing} redirectUri={setup.redirectUri} /></>;

  const account = getGoogleAccount();
  const sites = listSites().filter((s) => listAudits({ siteId: s.id, limit: 1 }).length);
  const requested = typeof params.site === "string" ? Number.parseInt(params.site, 10) : NaN;
  const defaultSiteId = listAudits({ status: "completed", limit: 1 })[0]?.siteId;
  const site = sites.find((s) => s.id === requested) ?? sites.find((s) => s.id === defaultSiteId) ?? sites[0];

  const banners = (
    <>
      {flashError && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle />
          <AlertTitle>Search Console connection failed</AlertTitle>
          <AlertDescription>{flashError}</AlertDescription>
        </Alert>
      )}
      {justConnected && !flashError && (
        <Alert className="mb-6">
          <CheckCircle2 />
          <AlertTitle>Google Search Console connected</AlertTitle>
          <AlertDescription>Now link each website to its Search Console property.</AlertDescription>
        </Alert>
      )}
    </>
  );

  if (!account) {
    return (
      <>
        {header}
        {banners}
        <section className="max-w-2xl rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold">Connect Google Search Console</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with the Google account that has access to your websites in Search Console. The app only asks for read-only access and never changes anything in your account.
          </p>
          <a href={`/api/integrations/google/connect?returnTo=${encodeURIComponent(`/search-console${site ? `?site=${site.id}` : ""}`)}`} className={buttonVariants({ className: "mt-5" })}>
            Connect with Google
          </a>
        </section>
      </>
    );
  }

  let properties: string[] = [];
  let propertiesError: string | null = null;
  try {
    properties = await availableProperties();
  } catch (err) {
    propertiesError = (err as Error).message;
  }

  const link = site ? getSiteConnection(site.id) : null;
  const snapshot = site && link ? latestSnapshot(site.id) : null;
  const lastAttempt = site && link ? listSnapshots(site.id, 1)[0] : undefined;
  const history = site && link ? listSnapshots(site.id, 60).filter((s) => s.status === "ok" && s.property === link.property).reverse() : [];

  return (
    <>
      {header}
      {banners}

      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
        <CheckCircle2 className="size-4 text-sev-pass" aria-hidden />
        <span>
          Connected as <span className="font-medium">{account.email ?? "a Google account"}</span> since {formatDate(account.connectedAt)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {account.lastError && <span className="text-destructive">{account.lastError}</span>}
          {account.lastError && <a href="/api/integrations/google/connect" className={buttonVariants({ size: "sm" })}>Reconnect</a>}
          <DisconnectGoogleButton />
        </span>
      </section>

      {!site ? (
        <p className="mt-6 rounded-lg border bg-card px-4 py-6 text-muted-foreground">
          Run an audit first, then link the website to its Search Console property here. <Link href="/audits/new" className="text-primary hover:underline">New audit</Link>
        </p>
      ) : (
        <>
          <Section
            title={site.host}
            actions={
              sites.length > 1 && (
                <form className="flex items-center gap-2 text-sm">
                  <label htmlFor="sc-site" className="text-muted-foreground">Website</label>
                  <select id="sc-site" name="site" defaultValue={site.id} className="h-8 rounded-md border border-input bg-card px-2">
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.host}</option>)}
                  </select>
                  <button className={buttonVariants({ variant: "outline", size: "sm" })}>Show</button>
                </form>
              )
            }
          >
            <div className="rounded-lg border bg-card p-4">
              {propertiesError ? (
                <p className="text-sm text-destructive">Couldn’t load your Search Console properties: {propertiesError}</p>
              ) : (
                <PropertyLinker siteId={site.id} properties={properties} current={link?.property ?? null} suggested={suggestProperty(site.host, properties)} />
              )}
            </div>
          </Section>

          {link && (
            <>
              <Section
                title={`Last ${REPORT_DAYS} days`}
                description={snapshot ? `${snapshot.startDate} to ${snapshot.endDate} (Search Console data lags 2–3 days) · fetched ${formatDate(snapshot.fetchedAt)} · ${link.property}` : "No data fetched yet."}
                actions={<RefreshSnapshotButton siteId={site.id} />}
              >
                {lastAttempt?.status === "error" && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle />
                    <AlertTitle>The latest fetch failed</AlertTitle>
                    <AlertDescription>{lastAttempt.error}{snapshot ? " Showing the most recent successful data." : ""}</AlertDescription>
                  </Alert>
                )}
                {snapshot && (
                  <dl className="grid grid-cols-2 divide-x divide-y rounded-xl border bg-card lg:grid-cols-4 lg:divide-y-0">
                    {[
                      ["Clicks", fmtInt(snapshot.clicks ?? 0), <Delta key="c" current={snapshot.clicks ?? 0} previous={snapshot.previous?.clicks} format={fmtInt} />],
                      ["Impressions", fmtInt(snapshot.impressions ?? 0), <Delta key="i" current={snapshot.impressions ?? 0} previous={snapshot.previous?.impressions} format={fmtInt} />],
                      ["Average CTR", fmtPct(snapshot.ctr ?? 0), <Delta key="t" current={snapshot.ctr ?? 0} previous={snapshot.previous?.ctr} format={fmtPct} />],
                      ["Average position", snapshot.impressions ? fmtPos(snapshot.position ?? 0) : "—", <Delta key="p" current={snapshot.position ?? 0} previous={snapshot.previous?.impressions ? snapshot.previous.position : undefined} lowerIsBetter format={fmtPos} />],
                    ].map(([label, value, delta]) => (
                      <div key={label as string} className="px-4 py-4">
                        <dt className="text-sm text-muted-foreground">{label}</dt>
                        <dd className="mt-1 font-heading text-2xl font-semibold tabular-nums">{value}</dd>
                        <dd>{delta}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Section>

              {snapshot?.daily && snapshot.daily.length > 0 && (
                <Section title="Daily trend" description="Clicks and impressions use different scales, so each has its own chart.">
                  <div className="grid gap-4 lg:grid-cols-2">
                    {([["clicks", "Clicks per day", "#2a78d6"], ["impressions", "Impressions per day", "#11a094"]] as const).map(([key, title, color]) => (
                      <div key={key} className="rounded-lg border bg-card p-4">
                        <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                        <TrendChart
                          ariaLabel={`${title} from ${snapshot.startDate} to ${snapshot.endDate}`}
                          data={fillDailySeries(snapshot.daily!, snapshot.startDate, snapshot.endDate).map((d) => ({ label: d.date.slice(5), [key]: d[key] }))}
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

              {snapshot && (
                <div className="grid gap-x-6 lg:grid-cols-2">
                  <Section title="Top search queries">
                    <RowsTable
                      rows={snapshot.topQueries ?? []}
                      keyLabel="Query"
                      emptyText={(snapshot.impressions ?? 0) > 0 ? "Google returned no query rows. It hides rarely searched (anonymised) queries for privacy, which is common when impressions are low; the totals above still include them." : "No search impressions in this period."}
                    />
                  </Section>
                  <Section title="Top landing pages">
                    <RowsTable rows={snapshot.topPages ?? []} keyLabel="Page" isUrl />
                  </Section>
                </div>
              )}

              {snapshot?.inspections && snapshot.inspections.length > 0 && (
                <Section title="Google index status" description="Verified with the URL Inspection API for pages from the latest audit. This is Google’s own view of each URL.">
                  <div className="rounded-lg border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Page</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Coverage</TableHead>
                          <TableHead>Last crawled</TableHead>
                          <TableHead>Google-selected canonical</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {snapshot.inspections.map((i) => {
                          const v = VERDICT[i.verdict];
                          return (
                            <TableRow key={i.url}>
                              <TableCell className="font-mono text-xs">{shortUrl(i.url)}</TableCell>
                              <TableCell className={cn("text-sm font-medium", v?.className ?? "text-muted-foreground")}>{i.error ? "Not checked" : v?.label ?? i.verdict}</TableCell>
                              <TableCell className="max-w-72 whitespace-normal text-xs text-muted-foreground">{i.error ?? i.coverageState ?? "—"}</TableCell>
                              <TableCell className="text-xs">{i.lastCrawlTime ? formatDate(i.lastCrawlTime) : "—"}</TableCell>
                              <TableCell className="max-w-56 truncate font-mono text-xs" title={i.googleCanonical ?? ""}>
                                {i.googleCanonical ? (i.googleCanonical === i.userCanonical || i.googleCanonical === i.url ? "Same as page" : shortUrl(i.googleCanonical)) : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </Section>
              )}

              {history.length > 1 && (
                <p className="mt-6 text-sm text-muted-foreground">
                  {history.length} snapshots stored. See <Link href={`/progress?site=${site.id}`} className="text-primary hover:underline">Progress</Link> for changes over time.
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

export default function SearchConsolePage(props: PageProps<"/search-console">) {
  return (
    <Suspense fallback={<Loading />}>
      <SearchConsoleContent {...props} />
    </Suspense>
  );
}
