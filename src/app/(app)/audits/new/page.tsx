import { NewAuditForm } from "@/components/app/new-audit-form";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "New audit" };

const STEPS = [
  ["Fetch & validate", "Normalises the address, blocks private networks, follows redirects safely."],
  ["Discover pages", "Reads robots.txt, XML sitemaps and internal links, then crawls up to 25 same-site pages politely."],
  ["Analyse", "Runs over 50 technical, on-page, local and conversion checks on the real HTML."],
  ["Measure speed", "Runs Google PageSpeed Insights on mobile and desktop for representative pages."],
  ["Prioritise", "Scores every check, links each issue to its URL and evidence, and ranks the fixes."],
];

export default function NewAuditPage() {
  return (
    <>
      <PageHeader title="New audit" description="Enter a public website. The audit runs on this server and is saved to your history." />
      <div className="max-w-2xl rounded-xl border bg-card p-6">
        <NewAuditForm />
      </div>
      <section className="mt-10 max-w-2xl">
        <h2 className="text-lg font-semibold">What happens during an audit</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
              <p className="text-sm">
                <span className="font-medium">{title}.</span> <span className="text-muted-foreground">{text}</span>
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
