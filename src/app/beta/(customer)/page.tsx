import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, CircleAlert, FileText, Globe, History, LayoutDashboard, Plus, Search, TrendingUp } from "lucide-react";
import Loading from "@/app/(app)/loading";
import { buttonVariants } from "@/components/ui/button";
import { Section } from "@/components/app/page-header";
import { AuditStatusBadge } from "@/components/app/status";
import { formatDate, scoreTone, TONE_COLOR } from "@/components/app/format";
import { BetaNotice } from "@/components/beta/beta-notice";
import { RunAuditButton } from "@/components/beta/audit-actions";
import { MetricCard, surface, WorkspaceHero } from "@/components/beta/workspace-ui";
import { tenantRepository } from "@/lib/saas/repository";
import { getCustomerPage } from "@/lib/saas/page";

export const metadata = { title: "Dashboard" };

function describe(action: string, metadata: Record<string, string | number | boolean>) {
  const host = typeof metadata.host === "string" ? metadata.host : "a website";
  switch (action) {
    case "account.created": return "Account created";
    case "website.added": return `Added ${host}`;
    case "website.removed": return `Removed ${host}`;
    case "website.renamed": return "Renamed a website";
    case "audit.started": return `Started an audit of ${host}`;
    case "audit.completed": return `Audit of ${host} completed`;
    case "audit.failed": return "An audit failed";
    case "audit.cancelled": return "Cancelled an audit";
    case "pagespeed.requested": return "Requested a PageSpeed re-test";
    case "pagespeed.completed": return "PageSpeed re-test completed";
    case "pagespeed.failed": return "A PageSpeed re-test failed";
    default: return action.replaceAll('.', ' ').replaceAll('_', ' ');
  }
}

function Score({ value, ring = false }: { value: number | null | undefined; ring?: boolean }) {
  const score = value == null ? null : Math.round(value);
  const color = TONE_COLOR[scoreTone(value)];
  if (!ring) return <span className="font-heading text-lg font-semibold tabular-nums" style={{ color }}>{score ?? "—"}</span>;
  return <div className="relative grid size-14 shrink-0 place-items-center" aria-label={`Latest health score: ${score ?? 'not measured'}`}>
    <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 36 36" aria-hidden><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--muted)" strokeWidth="2.5"/>{score !== null && <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={`${Math.min(100, Math.max(0, score))} 100`} strokeLinecap="round"/>}</svg>
    <span className="font-heading text-lg font-semibold tabular-nums" style={{ color }}>{score ?? '—'}</span>
  </div>;
}

async function DashboardContent() {
  const { runtime, tenant, user } = await getCustomerPage();
  const data = await tenantRepository(runtime.db, tenant).dashboard();
  const addWebsite = <Link href="/beta/websites" className={buttonVariants({ variant: 'secondary', className: 'h-10 px-4 shadow-xs' })}><Plus/>Add website</Link>;
  return <>
    <WorkspaceHero eyebrow="Your private workspace" title={`Welcome back, ${user.name.split(' ')[0] || user.name}`} description="Track your website health, understand your search performance and turn findings into your next improvements." icon={LayoutDashboard} actions={addWebsite}/>
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard label="Websites" value={data.usage.websites} note={`Of ${data.usage.websiteLimit} available in your account`} icon={Globe}/>
      <MetricCard label="Average health" value={<span style={{ color: TONE_COLOR[scoreTone(data.overview.averageScore)] }}>{data.overview.averageScore == null ? '—' : Math.round(data.overview.averageScore)}</span>} note={data.overview.averageScore == null ? 'Run an audit to see your score' : 'From your latest completed audits'} icon={TrendingUp} tone="good"/>
      <MetricCard label="Critical issues" value={data.overview.criticalIssues} note="Found in your latest completed audits" icon={CircleAlert} tone={data.overview.criticalIssues > 0 ? 'warning' : 'primary'}/>
      <MetricCard label="Audits this month" value={data.usage.auditsThisMonth} note={`Of ${data.usage.monthlyAuditLimit} in your monthly allowance`} icon={History}/>
    </dl>
    {data.websites.length === 0 ? <div className={`${surface} mt-6 flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:p-8`}>
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><Globe className="size-7" aria-hidden/></span><div className="flex-1"><h2 className="text-xl font-semibold">Start with your first website</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Add a website you’re authorized to assess, run its first audit and get a prioritized view of what to improve.</p></div><Link href="/beta/websites" className={buttonVariants({className:'h-10 px-4'})}><Plus/>Add your first website</Link>
    </div> : <Section title="Your websites" description="Your latest results and the next step for each site." actions={<Link href="/beta/websites" className={buttonVariants({variant:'outline',className:'bg-card'})}>Manage websites<ArrowUpRight/></Link>}>
      <ul className="grid gap-4 xl:grid-cols-2">{data.websites.map(w => <li key={w.id} className={`${surface} flex min-w-0 flex-col p-5`}>
        <div className="flex items-center gap-3"><Score value={w.latest?.overallScore} ring/><div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{w.displayName ?? w.host}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{w.displayUrl}</p></div><Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden/></div>
        <p className="mt-4 text-xs text-muted-foreground">{w.latest ? `Last completed audit ${formatDate(w.latest.completedAt)}` : 'No completed audits yet. Run a scan to establish your baseline.'}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">{w.latest ? <Link href={`/beta/audits/${w.latest.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">View findings<ArrowRight className="size-3.5" aria-hidden/></Link> : <span className="text-xs text-muted-foreground">Ready for your first scan</span>}{w.activeAuditId ? <Link href={`/beta/audits/${w.activeAuditId}`} className={buttonVariants({variant:'outline'})}>View audit progress<ArrowRight/></Link> : <RunAuditButton websiteId={w.id} variant={w.latest ? 'outline' : 'default'} label={w.latest ? 'Re-run audit' : 'Run audit'}/>}</div>
      </li>)}</ul>
    </Section>}
    <div className="mt-6 grid gap-3 sm:grid-cols-3">{[
      {href:'/beta/search-console',title:'Search performance',description:'Explore your Google Search Console insights.',icon:Search},
      {href:'/beta/progress',title:'SEO progress',description:'See how your scores and findings change.',icon:TrendingUp},
      {href:'/beta/audits',title:'Audits and reports',description:'Compare scans and download your reports.',icon:FileText},
    ].map(({href,title,description,icon:Icon}) => <Link key={href} href={href} className={`${surface} group flex gap-3 p-4 hover:border-primary/40`}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary"><Icon className="size-4" aria-hidden/></span><div className="min-w-0 flex-1"><h2 className="flex items-center justify-between gap-2 text-sm font-semibold">{title}<ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden/></h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div></Link>)}</div>
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <div><Section title="Latest audits" actions={<Link href="/beta/audits" className="text-sm font-medium text-primary hover:underline">View all</Link>}>
        {data.latestAudits.length === 0 ? <div className={`${surface} p-6`}><History className="mb-3 size-5 text-muted-foreground" aria-hidden/><p className="text-sm font-medium">Your audit history starts here</p><p className="mt-1 text-sm text-muted-foreground">Run a website audit to see results, compare scans and create reports.</p></div> : <ul className={`${surface} divide-y`}>{data.latestAudits.map(a => <li key={a.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1"><Link href={`/beta/audits/${a.id}`} className="block truncate text-sm font-semibold hover:underline">{a.site?.displayName ?? a.site?.host ?? 'Removed website'}</Link><p className="mt-1 text-xs text-muted-foreground">{formatDate(a.completedAt ?? a.createdAt)}</p></div><AuditStatusBadge status={a.status}/><Score value={a.overallScore}/></li>)}</ul>}
      </Section></div>
      <div><Section title="Recent activity" description="The latest updates from your workspace.">
        <ul className={`${surface} divide-y`}>{data.activity.length ? data.activity.map(e => <li key={e.id} className="flex gap-3 p-4"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${e.action.endsWith('failed')?'bg-destructive/10 text-destructive':'bg-accent text-primary'}`}>{e.action.endsWith('failed')?<CircleAlert className="size-3.5" aria-hidden/>:e.action.endsWith('completed')?<CheckCircle2 className="size-3.5" aria-hidden/>:<History className="size-3.5" aria-hidden/>}</span><div className="min-w-0"><p className="text-sm leading-relaxed break-words">{describe(e.action,e.metadata)}</p><time dateTime={new Date(e.createdAt).toISOString()} className="mt-1 block text-xs text-muted-foreground">{formatDate(e.createdAt)}</time></div></li>) : <li className="p-6 text-sm text-muted-foreground">Your website and audit activity will appear here.</li>}</ul>
      </Section></div>
    </div>
    <div className="mt-8"><BetaNotice/></div>
  </>;
}

export default function BetaDashboardPage() { return <Suspense fallback={<Loading/>}><DashboardContent/></Suspense>; }
