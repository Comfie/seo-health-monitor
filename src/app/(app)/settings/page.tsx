import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import { connection } from "next/server";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Section } from "@/components/app/page-header";
import { config } from "@/lib/config";
import { ALL_CHECKS } from "@/lib/audit/checks";
import { CATEGORY_WEIGHTS } from "@/lib/audit/scoring";
import { listAudits } from "@/lib/audit/repository";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/audit/types";
import { getGoogleAccount, searchConsoleSetup } from "@/lib/integrations/search-console/service";

export const metadata = { title: "Settings" };

function Integration({ name, configured, envVar, children }: { name: string; configured: boolean; envVar?: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 px-4 py-4">
      {configured ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-sev-pass" aria-hidden /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-sev-na" aria-hidden />}
      <div className="text-sm">
        <p className="font-medium">
          {name} <span className="font-normal text-muted-foreground">· {configured ? "Configured" : "Not configured"}</span>
        </p>
        <div className="mt-1 text-muted-foreground">{children}</div>
        {envVar && <p className="mt-1 font-mono text-xs">{envVar}</p>}
      </div>
    </li>
  );
}

async function SettingsContent() {
  await connection();
  const auditCount = listAudits({ limit: 100_000 }).length;
  const gsc = searchConsoleSetup();
  const account = gsc.configured ? getGoogleAccount() : null;

  return (
    <>
      <PageHeader title="Settings" description="API keys are read from environment variables (.env.local) and never shown or stored in the database. Restart the app after changing them." />

      <Section title="Integrations">
        <ul className="divide-y rounded-lg border bg-card">
          <Integration name="Google PageSpeed Insights" configured={!!config.pagespeedApiKey} envVar="PAGESPEED_API_KEY">
            Powers the performance category. Without a key Google rate-limits anonymous use heavily and performance checks show as not verified.
          </Integration>
          <Integration name="AI SEO Consultant (Anthropic)" configured={!!config.anthropicApiKey} envVar="ANTHROPIC_API_KEY">
            Optional. Writes a plain-English review from measured findings using <span className="font-mono text-xs">{config.aiModel}</span>. Every other feature works without it.
          </Integration>
          <Integration name="Google Search Console" configured={gsc.configured} envVar="GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · APP_SECRET · APP_URL">
            Read-only OAuth connection for clicks, impressions, CTR, average position, top queries and pages, and verified index status. Kept separate from audit scores.{" "}
            {gsc.configured ? (account ? <>Connected as {account.email ?? "a Google account"}. </> : "Not connected yet. ") : `Missing: ${gsc.missing.join(", ")}. `}
            <a href="/search-console" className="text-primary hover:underline">Manage</a>
            <span className="mt-1 block text-xs">OAuth redirect URI: <span className="font-mono">{gsc.redirectUri}</span></span>
          </Integration>
        </ul>
      </Section>

      <Section title="Crawl limits" description="Set via environment variables; see .env.example.">
        <dl className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card text-sm sm:grid-cols-3">
          {[
            ["Max pages per audit", config.crawl.maxPages, "CRAWL_MAX_PAGES"],
            ["Concurrent requests", config.crawl.concurrency, "CRAWL_CONCURRENCY"],
            ["Request timeout", `${config.crawl.timeoutMs / 1000}s`, "CRAWL_TIMEOUT_MS"],
            ["Max response size", `${(config.crawl.maxBytes / 1_000_000).toFixed(1)} MB`, "CRAWL_MAX_BYTES"],
            ["PageSpeed pages", `${config.pagespeed.maxPages} × 2 devices`, "PAGESPEED_MAX_PAGES"],
            ["Audit rate limit", `${config.rateLimit.max} per ${Math.round(config.rateLimit.windowMs / 60_000)} min`, "AUDIT_RATE_LIMIT_MAX"],
          ].map(([label, value, env]) => (
            <div key={label as string} className="px-4 py-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-heading text-lg font-semibold">{value}</dd>
              <dd className="font-mono text-xs text-muted-foreground">{env}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-sm text-muted-foreground">
          The crawler obeys robots.txt (user agent <span className="font-mono text-xs">SEOHealthMonitor</span>), honours crawl-delay up to 5s, and blocks private, loopback, link-local and reserved IP addresses on every request and redirect.
        </p>
      </Section>

      <Section
        id="methodology"
        title="Scoring methodology"
        description="Each check produces a score from 0 to 1 (usually the share of applicable pages without the problem). A category score is the weighted average of its measurable checks. The overall score is the weighted average of the category scores. Checks that can't be measured are excluded, not counted as passes or failures."
      >
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {CATEGORIES.map((c) => (
            <span key={c} className="rounded-md border bg-card px-3 py-1.5">
              {CATEGORY_LABELS[c]} <span className="font-semibold">{CATEGORY_WEIGHTS[c]}%</span>
            </span>
          ))}
        </div>
        {CATEGORIES.map((c) => {
          const defs = ALL_CHECKS.filter((d) => d.category === c);
          const total = defs.reduce((s, d) => s + d.weight, 0);
          return (
            <details key={c} className="mb-3 rounded-lg border bg-card">
              <summary className="cursor-pointer px-4 py-3 font-medium">
                {CATEGORY_LABELS[c]} <span className="text-sm font-normal text-muted-foreground">· {defs.length} checks</span>
              </summary>
              <div className="border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Check</TableHead>
                      <TableHead>What it measures</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {defs.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.title}</TableCell>
                        <TableCell className="max-w-xl whitespace-normal text-muted-foreground">{d.description}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.weight || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.weight ? `${Math.round((d.weight / total) * 100)}%` : "Not scored"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          );
        })}
        <p className="mt-3 text-sm text-muted-foreground">
          Issue priority = severity weight (critical 100, high 70, medium 40, low 15) × confidence (high 1, medium 0.8, low 0.55) × effort (low 1, medium 0.8, high 0.6) + 4 × impact. Scores of 70+ are “Fix first”, 40–69 “Fix next”. Issue IDs are hashes of check, URL and variant, so the same problem keeps the same ID across scans.
        </p>
      </Section>

      <Section title="Data">
        <p className="text-sm">
          {auditCount} audits stored in SQLite at <span className="font-mono text-xs">{config.databasePath}</span>. Delete individual audits from Audit History.
        </p>
      </Section>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsContent />
    </Suspense>
  );
}
