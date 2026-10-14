import { Suspense } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { buttonVariants } from "@/components/ui/button";
import { CategoryHeader } from "@/components/app/category-header";
import { CopyButton } from "@/components/app/copy-button";
import { NoAuditYet } from "@/components/app/empty-state";
import { Section } from "@/components/app/page-header";
import { loadAuditView } from "@/lib/audit/views";
import { selectFixItems } from "@/lib/reports/fix-prompt";
import { fixOptionsFrom, fixPromptForAudit } from "@/lib/reports/fix-request";
import { cn } from "@/lib/utils";

export const metadata = { title: "Fix with AI" };

async function FixContent(props: PageProps<"/fix">) {
  const view = await loadAuditView(props.searchParams);
  if (!view.full) return <NoAuditYet />;
  const params = await props.searchParams;
  const options = fixOptionsFrom(params);
  const { audit, issues, pages } = view.full;
  const prompt = fixPromptForAudit(view.full, options);
  const { items, excludedLowConfidence } = selectFixItems(issues, options);
  const platform = (pages.find((p) => p.depth === 0) ?? pages[0])?.data.extracted?.platform;

  const q = (next: Partial<{ scope: string; low: string }>) => {
    const merged = { audit: String(audit.id), scope: options.scope, low: options.includeLowConfidence ? "1" : "0", ...next };
    return `/fix?${new URLSearchParams(merged)}`;
  };
  const query = new URLSearchParams({ scope: options.scope, low: options.includeLowConfidence ? "1" : "0" });
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm", active ? "border-primary bg-accent font-medium text-accent-foreground" : "bg-card hover:bg-muted");

  return (
    <>
      <CategoryHeader view={view} title="Fix with AI" description="Implementation-ready instructions built only from this audit's verified findings. Works with any AI coding tool (Claude Code, Codex, Cursor, GitHub Copilot and others) or a developer." />

      <div className="no-print mb-6 flex flex-wrap items-center gap-2">
        <Link href={q({ scope: "first" })} className={chip(options.scope === "first")}>Fix first only</Link>
        <Link href={q({ scope: "all" })} className={chip(options.scope === "all")}>All issues</Link>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Link href={q({ low: options.includeLowConfidence ? "0" : "1" })} className={chip(options.includeLowConfidence)}>
          {options.includeLowConfidence ? "Including" : "Include"} lower-confidence findings
        </Link>
        <span className="ml-auto flex gap-2">
          <CopyButton url={`/api/audits/${audit.id}/fix?${query}`} label="Copy prompt" copiedMessage="Prompt copied. Paste it into your AI coding tool." />
          <a href={`/api/audits/${audit.id}/fix?${query}&download=1`} className={buttonVariants({ variant: "outline" })}>
            <Download /> Download .md
          </a>
        </span>
      </div>

      <dl className="grid grid-cols-2 divide-x rounded-xl border bg-card sm:grid-cols-4">
        {[
          ["Tasks", items.length],
          ["Affected URLs", items.reduce((s, i) => s + i.issues.length, 0)],
          ["Excluded (low confidence)", excludedLowConfidence],
          ["Platform", platform ? platform.name : "Not detected"],
        ].map(([label, value]) => (
          <div key={label as string} className="px-4 py-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-heading text-xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="How to use it" description="Open your AI coding tool (Claude Code, Codex, Cursor, Copilot…) in the repository that builds this website, paste the prompt, and review each change before deploying. You can also hand it to a developer as a task list. Re-run the audit afterwards to confirm the fixes.">
        <pre className="max-h-[36rem] overflow-auto rounded-lg border bg-card p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{prompt}</pre>
      </Section>
    </>
  );
}

export default function FixPage(props: PageProps<"/fix">) {
  return (
    <Suspense fallback={<Loading />}>
      <FixContent {...props} />
    </Suspense>
  );
}
