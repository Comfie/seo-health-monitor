import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import { CheckList } from "@/components/app/check-list";
import { CategoryHeader } from "@/components/app/category-header";
import { NoAuditYet } from "@/components/app/empty-state";
import { Section } from "@/components/app/page-header";
import { shortUrl } from "@/components/app/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAuditView } from "@/lib/audit/views";
import { cn } from "@/lib/utils";

export const metadata = { title: "On-page SEO" };

function Len({ value, min, max }: { value: string | null; min: number; max: number }) {
  if (!value) return <span className="font-medium text-sev-critical">Missing</span>;
  const ok = value.length >= min && value.length <= max;
  return (
    <span className="block">
      <span className="line-clamp-2">{value}</span>
      <span className={cn("text-xs tabular-nums", ok ? "text-muted-foreground" : "text-sev-medium")}>{value.length} chars</span>
    </span>
  );
}

async function OnContentContent({ searchParams }: PageProps<"/on-page">) {
  const view = await loadAuditView(searchParams);
  if (!view.full) return <NoAuditYet />;
  const { checks, issues, pages } = view.full;
  const html = pages.filter((p) => p.data.extracted);

  return (
    <>
      <CategoryHeader view={view} category="onpage" title="On-Page SEO" description="Titles, descriptions, headings, images, internal links, social tags and content." />
      <CheckList checks={checks.filter((c) => c.category === "onpage")} issues={issues} />

      <Section title="Page metadata" description="What each crawled page tells search engines. Lengths outside 30–60 (titles) and 70–160 (descriptions) are highlighted.">
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead className="min-w-56">Title</TableHead>
                <TableHead className="min-w-64">Meta description</TableHead>
                <TableHead className="min-w-48">H1</TableHead>
                <TableHead className="text-right">Words</TableHead>
                <TableHead className="text-right">Img no alt</TableHead>
                <TableHead>OG</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {html.map((p) => {
                const ex = p.data.extracted!;
                const missingAlt = ex.images.filter((i) => i.alt === null).length;
                const og = ["og:title", "og:description", "og:image"].filter((k) => ex.og[k]).length;
                return (
                  <TableRow key={p.id} className="align-top">
                    <TableCell className="max-w-44 truncate font-mono text-xs" title={p.finalUrl}>{shortUrl(p.finalUrl)}</TableCell>
                    <TableCell className="whitespace-normal text-xs"><Len value={p.title} min={30} max={60} /></TableCell>
                    <TableCell className="whitespace-normal text-xs"><Len value={p.metaDescription} min={70} max={160} /></TableCell>
                    <TableCell className="whitespace-normal text-xs">
                      {ex.h1s.length === 0 ? <span className="font-medium text-sev-critical">Missing</span> : <span className="line-clamp-2">{ex.h1s[0]}</span>}
                      {ex.h1s.length > 1 && <span className="text-xs text-sev-medium">+{ex.h1s.length - 1} more H1</span>}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", (p.wordCount ?? 0) < 300 ? "text-sev-medium" : "")}>{p.wordCount}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", missingAlt ? "text-sev-medium" : "")}>{missingAlt}</TableCell>
                    <TableCell className="text-xs tabular-nums">{og}/3</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Section>
    </>
  );
}

export default function OnPagePage(props: PageProps<"/on-page">) {
  return (
    <Suspense fallback={<Loading />}>
      <OnContentContent {...props} />
    </Suspense>
  );
}
