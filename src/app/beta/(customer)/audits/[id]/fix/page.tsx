import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/app/copy-button";
import { PageHeader, Section } from "@/components/app/page-header";
import { selectFixItems } from "@/lib/reports/fix-prompt";
import { fixOptionsFrom, fixPromptForAudit } from "@/lib/reports/fix-request";
import { getCustomerAudit } from "@/lib/saas/audit-page";
import { cn } from "@/lib/utils";

export const metadata = { title: "Fix with AI" };

async function FixContent({ params, searchParams }: PageProps<"/beta/audits/[id]/fix">) {
  const { audits, status } = await getCustomerAudit((await params).id);
  if (status.status !== "completed") redirect(`/beta/audits/${status.id}`);
  const full = await audits.full(status.id);
  const options = fixOptionsFrom(await searchParams);
  const prompt = fixPromptForAudit(full, options);
  const { items, excludedLowConfidence } = selectFixItems(full.issues, options);
  const platform = (full.pages.find((p) => p.depth === 0) ?? full.pages[0])?.data.extracted?.platform;
  const id = full.audit.id;
  const query = new URLSearchParams({ scope: options.scope, low: options.includeLowConfidence ? "1" : "0" });
  const link = (next: Partial<{ scope: string; low: string }>) => `/beta/audits/${id}/fix?${new URLSearchParams({ scope: options.scope, low: options.includeLowConfidence ? "1" : "0", ...next })}`;
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm", active ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted");

  return (
    <>
      <PageHeader
        title="Fix with AI"
        description={<>Implementation-ready instructions built only from audit #{id}&apos;s verified findings. Works with Claude Code, Codex, Cursor, GitHub Copilot or a developer. <Link className="text-primary hover:underline" href={`/beta/audits/${id}`}>Back to overview</Link></>}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={link({ scope: "first" })} className={chip(options.scope === "first")}>Fix first only</Link>
        <Link href={link({ scope: "all" })} className={chip(options.scope === "all")}>All issues</Link>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Link href={link({ low: options.includeLowConfidence ? "0" : "1" })} className={chip(options.includeLowConfidence)}>{options.includeLowConfidence ? "Including" : "Include"} lower-confidence findings</Link>
        <span className="ml-auto flex gap-2">
          <CopyButton url={`/api/beta/audits/${id}/fix?${query}`} label="Copy prompt" copiedMessage="Prompt copied. Paste it into your AI coding tool." />
          <a href={`/api/beta/audits/${id}/fix?${query}&download=1`} className={buttonVariants({ variant: "outline" })}><Download /> Download .md</a>
        </span>
      </div>
      <dl className="grid grid-cols-2 divide-x rounded-xl border bg-card sm:grid-cols-4">
        {[["Tasks", items.length], ["Affected URLs", items.reduce((s, i) => s + i.issues.length, 0)], ["Excluded (low confidence)", excludedLowConfidence], ["Platform", platform ? platform.name : "Not detected"]].map(([label, value]) => (
          <div key={label as string} className="px-4 py-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-heading text-xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <Section title="How to use it" description="Open your AI coding tool in the repository that builds this website, paste the prompt and review each change before deploying. Text copied from your pages is marked as untrusted data, so instructions hidden in page content are not followed. Re-run the audit afterwards to confirm the fixes.">
        <pre className="max-h-[36rem] overflow-auto rounded-lg border bg-card p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{prompt}</pre>
      </Section>
    </>
  );
}

export default function BetaFixPage(props: PageProps<"/beta/audits/[id]/fix">) {
  return (
    <Suspense fallback={<Loading />}>
      <FixContent {...props} />
    </Suspense>
  );
}
