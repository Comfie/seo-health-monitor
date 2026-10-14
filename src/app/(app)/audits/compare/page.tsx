import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { connection } from "next/server";
import { ComparisonView } from "@/components/app/comparison-view";
import { PageHeader } from "@/components/app/page-header";
import { compareAudits, type CompareInput } from "@/lib/audit/compare";
import { getFullAudit, type FullAudit } from "@/lib/audit/repository";
import type { Category } from "@/lib/audit/types";

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

  return <ComparisonView host={curr.site.host} previous={prev.audit} current={curr.audit} result={result} />;
}

export default function ComparePage(props: PageProps<"/audits/compare">) {
  return (
    <Suspense fallback={<Loading />}>
      <CompareContent {...props} />
    </Suspense>
  );
}
