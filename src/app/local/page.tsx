import { Suspense } from "react";
import Loading from "@/app/loading";
import { CheckList } from "@/components/app/check-list";
import { CategoryHeader } from "@/components/app/category-header";
import { NoAuditYet } from "@/components/app/empty-state";
import { Section } from "@/components/app/page-header";
import { TONE_COLOR, scoreTone, shortUrl } from "@/components/app/format";
import { loadAuditView } from "@/lib/audit/views";

export const metadata = { title: "Local SEO" };

function Signal({ label, children, empty }: { label: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={empty ? "text-sm text-sev-medium" : "min-w-0 break-words text-sm"}>{children}</dd>
    </div>
  );
}

async function LocalContent({ searchParams }: PageProps<"/local">) {
  const view = await loadAuditView(searchParams);
  if (!view.full) return <NoAuditYet />;
  const { checks, issues, meta, audit } = view.full;
  const local = meta?.local;
  const conversionScore = (audit.categoryScores as Record<string, number | null> | null)?.conversion ?? null;

  return (
    <>
      <CategoryHeader view={view} category="local" title="Local SEO" description="Business identity, contact details, service areas, location pages and local structured data." />
      <CheckList checks={checks.filter((c) => c.category === "local")} issues={issues} />

      {local && (
        <Section title="What the website tells search engines about the business" description="Detected from page text, links and structured data. Place-name and address detection is heuristic.">
          <dl className="divide-y rounded-lg border bg-card">
            <Signal label="Business name" empty={!local.businessName}>
              {local.businessName ? `${local.businessName.value} (from ${local.businessName.source})` : "Not identified"}
            </Signal>
            <Signal label="Phone numbers" empty={!local.phones.length}>
              {local.phones.length ? `${local.phones.join(", ")} · visible on ${local.phonePages.length} page(s)` : "None found"}
            </Signal>
            <Signal label="Email addresses" empty={!local.emails.length}>{local.emails.join(", ") || "None found"}</Signal>
            <Signal label="Address" empty={!local.addresses.length}>
              {local.addresses.length ? (
                <ul>{local.addresses.slice(0, 3).map((a) => <li key={a.value}>{a.value} <span className="text-muted-foreground">({a.source})</span></li>)}</ul>
              ) : "None found"}
            </Signal>
            <Signal label="LocalBusiness schema" empty={!local.localBusinessSchema.length}>
              {local.localBusinessSchema.length ? [...new Set(local.localBusinessSchema.map((s) => `${s.types.join("/")} on ${shortUrl(s.url)}`))].slice(0, 4).join("; ") : "Not present"}
            </Signal>
            <Signal label="Areas served (schema)" empty={!local.areaServed.length}>{local.areaServed.join(", ") || "Not declared"}</Signal>
            <Signal label="Places mentioned" empty={!local.placeCandidates.length}>{local.placeCandidates.slice(0, 25).join(", ") || "None detected"}</Signal>
            <Signal label="Location pages" empty={!local.locationPages.length}>
              {local.locationPages.length ? (
                <ul>{local.locationPages.map((l) => <li key={l.url}><span className="font-mono text-xs">{shortUrl(l.url)}</span> <span className="text-muted-foreground">· {l.reason}</span></li>)}</ul>
              ) : "None detected among crawled pages"}
            </Signal>
            <Signal label="Maps / Business Profile link" empty={!local.mapsLinks.length}>
              {local.mapsLinks.length ? <span className="break-all font-mono text-xs">{local.mapsLinks[0]}</span> : "None found"}
            </Signal>
          </dl>
        </Section>
      )}

      <Section
        id="conversion"
        title="Conversion readiness"
        description="Whether visitors can easily become enquiries: forms, click-to-call, WhatsApp, calls to action and mobile setup."
        actions={
          <p className="font-heading text-xl font-semibold tabular-nums" style={{ color: TONE_COLOR[scoreTone(conversionScore)] }}>
            {conversionScore ?? "—"}<span className="text-sm font-normal text-muted-foreground"> / 100</span>
          </p>
        }
      >
        <CheckList checks={checks.filter((c) => c.category === "conversion")} issues={issues} />
      </Section>
    </>
  );
}

export default function LocalPage(props: PageProps<"/local">) {
  return (
    <Suspense fallback={<Loading />}>
      <LocalContent {...props} />
    </Suspense>
  );
}
