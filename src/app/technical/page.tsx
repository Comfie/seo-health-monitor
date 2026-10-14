import { Suspense } from "react";
import Loading from "@/app/loading";
import { CheckList } from "@/components/app/check-list";
import { CategoryHeader } from "@/components/app/category-header";
import { NoAuditYet } from "@/components/app/empty-state";
import { Section } from "@/components/app/page-header";
import { formatMs, shortUrl } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAuditView } from "@/lib/audit/views";
import { cn } from "@/lib/utils";

export const metadata = { title: "Technical SEO" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

async function TechnicalContent({ searchParams }: PageProps<"/technical">) {
  const view = await loadAuditView(searchParams);
  if (!view.full) return <NoAuditYet />;
  const { checks, issues, pages, meta } = view.full;

  return (
    <>
      <CategoryHeader view={view} category="technical" title="Technical SEO" description="Crawlability, indexability signals, redirects, status codes and structured data." />
      <CheckList checks={checks.filter((c) => c.category === "technical")} issues={issues} />

      {meta && (
        <Section title="Crawl facts" description="Raw observations collected during the crawl.">
          <dl className="divide-y rounded-lg border bg-card">
            <Fact label="Audited origin">{meta.origin}</Fact>
            <Fact label="robots.txt">
              {meta.robots.found ? `Found (HTTP ${meta.robots.status})` : `Not found${meta.robots.error ? `: ${meta.robots.error}` : ` (HTTP ${meta.robots.status ?? "no response"})`}`}
              {meta.robots.crawlDelay ? ` · crawl-delay ${meta.robots.crawlDelay}s` : ""}
              {meta.robots.content && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-primary">Show file</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 font-mono text-xs">{meta.robots.content}</pre>
                </details>
              )}
            </Fact>
            <Fact label="XML sitemaps">
              {meta.sitemap.files.length === 0 ? "None found" : (
                <ul className="space-y-0.5">
                  {meta.sitemap.files.map((f) => (
                    <li key={f.url} className="break-all">
                      <span className="font-mono text-xs">{f.url}</span> · {f.kind} · {f.urlCount} entries{f.error ? ` · ${f.error}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-muted-foreground">{meta.sitemap.urlCount} same-site URLs listed.</p>
            </Fact>
            <Fact label="HTTP → HTTPS">
              {meta.httpToHttps ? (meta.httpToHttps.error ? meta.httpToHttps.error : `${meta.httpToHttps.redirectChain.map((h) => `${h.status} → ${h.location}`).join(", ") || `HTTP ${meta.httpToHttps.status}, no redirect`}`) : "Not applicable"}
            </Fact>
            <Fact label="Alternate host">
              {meta.hostVariant ? (meta.hostVariant.error ? `${meta.hostVariant.testedUrl}: ${meta.hostVariant.error}` : `${meta.hostVariant.testedUrl} → ${meta.hostVariant.finalUrl} (HTTP ${meta.hostVariant.status})${meta.hostVariant.canonical ? `, canonical ${meta.hostVariant.canonical}` : ""}`) : "Not tested"}
            </Fact>
            <Fact label="404 handling">
              {meta.notFoundProbe ? `${meta.notFoundProbe.testedUrl} → HTTP ${meta.notFoundProbe.status ?? meta.notFoundProbe.error}` : "Not tested"}
            </Fact>
            <Fact label="URLs discovered">
              {meta.discoveredUrlCount} unique same-site URLs found · {pages.length} pages crawled (limit {meta.limits.maxPages}) · {meta.linkTargetsChecked} link targets status-checked
            </Fact>
            {meta.blockedByRobots.length > 0 && (
              <Fact label="Skipped (robots.txt)">
                <ul className="font-mono text-xs">{meta.blockedByRobots.slice(0, 15).map((u) => <li key={u} className="break-all">{u}</li>)}</ul>
              </Fact>
            )}
          </dl>
        </Section>
      )}

      <Section title={`Crawled pages (${pages.length})`}>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead>Redirects</TableHead>
                <TableHead>Canonical</TableHead>
                <TableHead>Robots</TableHead>
                <TableHead className="text-right">Response</TableHead>
                <TableHead>Found via</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-64 truncate font-mono text-xs" title={p.finalUrl}>
                    <a href={p.finalUrl} target="_blank" rel="noreferrer noopener" className="hover:underline">{shortUrl(p.finalUrl)}</a>
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", (p.status ?? 0) >= 400 || p.status === null ? "font-semibold text-sev-critical" : "")}>{p.status ?? "error"}</TableCell>
                  <TableCell className="text-xs">{p.data.redirectChain.length ? `${p.data.redirectChain.length} hop(s)` : "—"}</TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs" title={p.canonical ?? ""}>
                    {p.canonical ? (p.canonical.replace(/\/$/, "") === p.finalUrl.replace(/\/$/, "") ? "Self" : shortUrl(p.canonical)) : "—"}
                  </TableCell>
                  <TableCell className="text-xs">{p.metaRobots ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMs(p.responseTimeMs)}</TableCell>
                  <TableCell className="text-xs capitalize">{p.data.source}{p.data.inSitemap && p.data.source !== "sitemap" ? " + sitemap" : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </>
  );
}

export default function TechnicalPage(props: PageProps<"/technical">) {
  return (
    <Suspense fallback={<Loading />}>
      <TechnicalContent {...props} />
    </Suspense>
  );
}
