import { Suspense } from "react";
import Loading from "@/app/loading";
import Link from "next/link";
import { connection } from "next/server";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteAuditButton } from "@/components/app/delete-audit-button";
import { PageHeader, Section } from "@/components/app/page-header";
import { AuditStatusBadge } from "@/components/app/status";
import { formatDate } from "@/components/app/format";
import { listAudits, listSites } from "@/lib/audit/repository";

export const metadata = { title: "Audit history" };

async function HistoryContent({ searchParams }: PageProps<"/audits">) {
  await connection();
  const params = await searchParams;
  const sites = listSites();
  const siteId = typeof params.site === "string" ? Number.parseInt(params.site, 10) : undefined;
  const audits = listAudits({ siteId: Number.isFinite(siteId) ? siteId : undefined });
  const completedBySite = sites
    .map((s) => ({ site: s, audits: listAudits({ siteId: s.id, status: "completed" }) }))
    .filter((g) => g.audits.length >= 2);

  return (
    <>
      <PageHeader
        title="Audit history"
        description="Every scan is stored. Open one, export it, or compare two scans of the same site."
        actions={<Link href="/audits/new" className={buttonVariants()}>New audit</Link>}
      />

      {completedBySite.length > 0 && (
        <Section title="Compare two scans" description="Pick an earlier and a later completed scan of the same website.">
          <div className="flex flex-col gap-3">
            {completedBySite.map(({ site, audits: list }) => (
              <form key={site.id} action="/audits/compare" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
                <p className="w-full font-medium sm:w-auto sm:min-w-48">{site.host}</p>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Previous scan</span>
                  <select name="a" defaultValue={list[1].id} className="h-8 rounded-md border border-input bg-card px-2">
                    {list.map((a) => (
                      <option key={a.id} value={a.id}>#{a.id} · {formatDate(a.completedAt)} · {a.overallScore ?? "–"}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Current scan</span>
                  <select name="b" defaultValue={list[0].id} className="h-8 rounded-md border border-input bg-card px-2">
                    {list.map((a) => (
                      <option key={a.id} value={a.id}>#{a.id} · {formatDate(a.completedAt)} · {a.overallScore ?? "–"}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className={buttonVariants({ variant: "outline" })}>Compare</button>
              </form>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="All scans"
        actions={
          sites.length > 1 && (
            <form className="flex items-center gap-2 text-sm">
              <label htmlFor="site-filter" className="text-muted-foreground">Website</label>
              <select id="site-filter" name="site" defaultValue={siteId ?? ""} className="h-8 rounded-md border border-input bg-card px-2">
                <option value="">All websites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.host}</option>
                ))}
              </select>
              <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>Filter</button>
            </form>
          )
        }
      >
        {audits.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-8 text-center text-muted-foreground">No audits yet. <Link className="text-primary hover:underline" href="/audits/new">Run your first audit</Link>.</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Audit</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Critical</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audits.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/audits/${a.id}`} className="font-medium text-primary hover:underline">#{a.id}</Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">{a.host}</TableCell>
                    <TableCell><AuditStatusBadge status={a.status} /></TableCell>
                    <TableCell className="text-right font-heading font-semibold tabular-nums">{a.overallScore ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.counts?.critical ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.pagesScanned ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(a.completedAt ?? a.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {a.status === "completed" && (
                          <Link href={`/audits/${a.id}/report`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Report</Link>
                        )}
                        <DeleteAuditButton auditId={a.id} />
                      </div>
                    </TableCell>
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

export default function HistoryPage(props: PageProps<"/audits">) {
  return (
    <Suspense fallback={<Loading />}>
      <HistoryContent {...props} />
    </Suspense>
  );
}
