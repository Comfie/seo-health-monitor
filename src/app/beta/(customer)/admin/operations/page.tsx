import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Activity, AlertCircle, ArrowLeft, CheckCircle2, Cpu, Database, Gauge, KeyRound, ListTodo, RefreshCw, Search, Server, ShieldCheck, Sparkles } from 'lucide-react';
import Loading from '@/app/(app)/loading';
import { Section } from '@/components/app/page-header';
import { buttonVariants } from '@/components/ui/button';
import { MetricCard, StatusPill, surface, UsageMeter, WorkspaceHero } from '@/components/beta/workspace-ui';
import { getCustomerPage } from '@/lib/saas/page';
import { operationsSnapshot } from '@/lib/saas/monitoring';

export const metadata = { title: 'System monitoring' };
const date = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'None waiting';
const failures = [
  ['database.failure', 'Database', Database], ['worker.poll_failed', 'Worker polling', Cpu],
  ['pagespeed.failure', 'PageSpeed requests', Gauge], ['google.refresh_failure', 'Google refreshes', Search],
  ['ai.failure', 'AI requests', Sparkles], ['auth.failure', 'Sign-in attempts', KeyRound],
] as const;

async function Content() {
  const { runtime, tenant, isAdmin } = await getCustomerPage();
  if (!isAdmin) notFound();
  const d = await operationsSnapshot(runtime.db, tenant.userId, runtime.limits);
  const queued = d.queues.audits.queued + d.queues.searchConsole.queued;
  const running = d.queues.audits.running + d.queues.searchConsole.running;
  const units = (period: 'daily' | 'monthly', kind: string) => d.usage[period].find(x => x.kind === kind)?.units ?? 0;
  return <>
    <WorkspaceHero eyebrow="Workspace operations" title="System monitoring" description="A clear view of application health, background jobs and resource use." icon={Activity}
      actions={<form action="/beta/admin/operations"><button type="submit" className={buttonVariants({ variant: 'secondary', className: 'h-10 px-4' })}><RefreshCw className="size-4" aria-hidden/>Refresh status</button></form>}>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-sidebar-foreground"><span>Snapshot taken {date(d.checkedAt)}</span><Link href="/beta/admin" className="inline-flex items-center gap-1.5 text-sidebar-primary underline-offset-4 hover:underline"><ArrowLeft className="size-3.5" aria-hidden/>Back to administration</Link></div>
    </WorkspaceHero>
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard label="Web application" value={d.webHealthy ? 'Healthy' : 'Check status'} note={d.webHealthy ? 'Recent application heartbeat' : 'No recent application heartbeat'} icon={Server} tone={d.webHealthy ? 'good' : 'warning'}/>
      <MetricCard label="Background worker" value={d.workerHealthy ? 'Healthy' : 'Check status'} note={d.workerHealthy ? 'Heartbeat received within 90 seconds' : 'Worker heartbeat needs attention'} icon={Cpu} tone={d.workerHealthy ? 'good' : 'warning'}/>
      <MetricCard label="Queued jobs" value={queued} note={`Across both queues · limit ${d.usage.caps.maxQueued}`} icon={ListTodo}/>
      <MetricCard label="Running jobs" value={running} note={`Shared concurrency limit ${d.usage.caps.maxRunning}`} icon={Activity}/>
    </dl>
    <Section title="Alerts" description="Items that need attention based on the configured thresholds.">
      {d.alerts.length ? <ul role="alert" className="space-y-3">{d.alerts.map(a => <li key={a.code} className="flex gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4"><AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden/><div><p className="text-sm font-semibold">Attention needed</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{a.message}</p></div></li>)}</ul> : <div className="flex items-center gap-3 rounded-xl border border-sev-pass/20 bg-sev-pass/5 p-4"><CheckCircle2 className="size-5 shrink-0 text-sev-pass" aria-hidden/><div><p className="text-sm font-semibold">No active threshold alerts</p><p className="mt-1 text-sm text-muted-foreground">No configured alert thresholds were triggered in this snapshot.</p></div></div>}
    </Section>
    <Section title="Job queues" description="Audit and Search Console jobs, including retained completion and retry counts.">
      <div className={`${surface} overflow-hidden`}>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Audit and Search Console queues</caption>
          <thead className="border-b bg-muted/60 text-xs text-muted-foreground"><tr>{['Queue','Queued','Running','Completed','Failed','Stale leases','Retries','Oldest queued'].map(h => <th scope="col" className="px-4 py-3 font-medium whitespace-nowrap" key={h}>{h}</th>)}</tr></thead>
          <tbody className="divide-y">{Object.entries(d.queues).map(([name,q]) => <tr key={name}><th scope="row" className="px-4 py-4 font-semibold whitespace-nowrap">{name === 'audits' ? 'SEO audits' : 'Search Console'}</th>{[q.queued,q.running,q.completed,q.failed,q.stale,q.retries].map((v,i) => <td className="px-4 py-4 tabular-nums" key={i}>{i === 3 && v > 0 ? <StatusPill tone="warning">{v} failed</StatusPill> : v}</td>)}<td className="px-4 py-4 text-xs whitespace-nowrap text-muted-foreground">{date(q.oldestQueuedAt)}</td></tr>)}</tbody>
        </table></div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground"><span>Audit completion <strong className="ml-1 text-foreground">{d.rates.completion === null ? 'No completed jobs' : `${Math.round(d.rates.completion * 100)}%`}</strong></span><span>Failure rate <strong className="ml-1 text-foreground">{d.rates.failure === null ? 'No finished jobs' : `${Math.round(d.rates.failure * 100)}%`}</strong></span></div>
      </div>
    </Section>
    <Section title="Failures in the last 24 hours" description="Recorded failures by service. Counts do not necessarily indicate a current outage.">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{failures.map(([key,label,Icon]) => <div key={key} className={`${surface} flex items-center gap-3 p-4`}><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden/></span><div className="min-w-0 flex-1"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums">{d.failuresLast24Hours[key] ?? 0}</dd></div>{(d.failuresLast24Hours[key] ?? 0) === 0 && <CheckCircle2 className="size-4 shrink-0 text-sev-pass" aria-label="No recorded failures"/>}</div>)}</dl>
    </Section>
    <Section title="Resource usage" description="Provider reservations and shared safety limits. All periods use UTC.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${surface} p-5`}><div className="mb-5 flex items-center justify-between gap-3"><h3 className="font-semibold">Today’s provider budgets</h3><ShieldCheck className="size-5 text-primary" aria-hidden/></div><div className="space-y-5"><UsageMeter label="PageSpeed measurements" used={units('daily','pagespeed')} limit={d.usage.caps.pagespeedPerDay}/><UsageMeter label="AI spend (US$)" used={d.usage.aiSpentTodayMicros} limit={d.usage.caps.aiMicrosPerDay} format={(micros) => `$${(micros / 1_000_000).toFixed(2)}`}/></div><p className="mt-5 border-t pt-3 text-xs text-muted-foreground">{units('daily','audit')} audit reservations and {units('daily','ai')} AI reports today. AI spend is calculated from the tokens each report used; a report being written counts as $0.10 until it finishes. Account allowances apply in addition to these shared limits.</p></div>
        <div className={`${surface} p-5`}><h3 className="mb-5 font-semibold">This month’s reservations</h3><dl className="divide-y">{[['audit','SEO audits'],['pagespeed','PageSpeed measurements'],['ai','AI requests']].map(([kind,label]) => <div key={kind} className="flex items-center justify-between py-3 first:pt-0 last:pb-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold tabular-nums">{units('monthly',kind).toLocaleString()}</dd></div>)}</dl></div>
      </div>
      <p className="mt-4 max-w-4xl text-xs leading-relaxed text-muted-foreground">{d.note}</p>
    </Section>
  </>;
}
export default function OperationsPage() { return <Suspense fallback={<Loading/>}><Content/></Suspense>; }
