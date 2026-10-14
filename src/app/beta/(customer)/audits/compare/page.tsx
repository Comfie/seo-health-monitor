import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Loading from "@/app/(app)/loading";
import { ComparisonView } from "@/components/app/comparison-view";
import { PageHeader } from "@/components/app/page-header";
import { AuditStateError } from "@/lib/saas/audits";
import { auditsFor, parseId } from "@/lib/saas/audit-http";
import { getCustomerPage } from "@/lib/saas/page";
import { AccessDeniedError } from "@/lib/saas/tenant";

export const metadata = { title: "Compare audits" };

async function CompareContent({ searchParams }: PageProps<"/beta/audits/compare">) {
  const { runtime, tenant } = await getCustomerPage();
  const params = await searchParams;
  const a = parseId(typeof params.a === "string" ? params.a : null);
  const b = parseId(typeof params.b === "string" ? params.b : null);
  if (!a || !b) notFound();
  let comparison;
  let problem: string | null = null;
  try {
    comparison = await auditsFor(runtime, tenant).compare(a, b);
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    if (!(error instanceof AuditStateError)) throw error;
    problem = error.message;
  }
  if (!comparison) {
    return (
      <>
        <PageHeader title="Compare audits" />
        <p className="rounded-lg border bg-card px-4 py-6 text-muted-foreground">{problem} <Link href="/beta/audits" className="text-primary hover:underline">Go to audit history</Link>.</p>
      </>
    );
  }
  const { older, newer, result } = comparison;
  return <ComparisonView host={newer.site.host} previous={older.audit} current={newer.audit} result={result} actions={<Link href={`/beta/audits/${newer.audit.id}`} className="text-sm text-primary hover:underline">Open the newer audit</Link>} />;
}

export default function BetaComparePage(props: PageProps<"/beta/audits/compare">) {
  return (
    <Suspense fallback={<Loading />}>
      <CompareContent {...props} />
    </Suspense>
  );
}
