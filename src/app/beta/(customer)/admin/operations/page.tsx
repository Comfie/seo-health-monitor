import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader, Section } from '@/components/app/page-header';
import { getCustomerPage } from '@/lib/saas/page';
import { operationsSnapshot } from '@/lib/saas/monitoring';
async function Content() {
  const {runtime,tenant,isAdmin}=await getCustomerPage(); if(!isAdmin) notFound();
  const d=await operationsSnapshot(runtime.db,tenant.userId,runtime.limits);
  return <><PageHeader title="System monitoring" description={`Checked ${d.checkedAt}. Refresh this page for current status.`}/>
    <Link href="/beta/admin" className="text-sm underline">Back to administration</Link>
    <Section title="Health"><p>Web: {d.webHealthy?'Healthy':'No recent health probe'} · Worker: {d.workerHealthy?'Healthy':'Missing heartbeat'}</p></Section>
    <Section title="Alerts">{d.alerts.length ? <ul role="alert" className="space-y-2">{d.alerts.map(a=><li key={a.code} className="rounded border border-destructive p-3 text-sm">{a.message}</li>)}</ul> : <p>No current threshold alerts.</p>}</Section>
    <Section title="Queues"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Audit and Search Console queues</caption><thead><tr>{['Queue','Queued','Running','Failed','Stale leases','Retries','Oldest queued'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{Object.entries(d.queues).map(([name,q])=><tr key={name}><th className="p-2">{name}</th>{[q.queued,q.running,q.failed,q.stale,q.retries,q.oldestQueuedAt??'None'].map((v,i)=><td className="p-2" key={i}>{String(v)}</td>)}</tr>)}</tbody></table></div><p className="mt-3 text-sm">Audit completion: {d.rates.completion===null?'No completed jobs':`${Math.round(d.rates.completion*100)}%`} · Failure: {d.rates.failure===null?'No finished jobs':`${Math.round(d.rates.failure*100)}%`}</p></Section>
    <Section title="Failures in the last 24 hours"><dl className="grid gap-2 sm:grid-cols-2">{['database.failure','worker.poll_failed','pagespeed.failure','google.refresh_failure','ai.failure','auth.failure'].map(k=><div key={k}><dt className="text-sm font-medium">{k}</dt><dd>{d.failuresLast24Hours[k]??0}</dd></div>)}</dl></Section>
    <Section title="Resource usage"><div className="grid gap-4 sm:grid-cols-2">{(['daily','monthly'] as const).map(period=><div key={period} className="rounded border p-4"><h3 className="font-medium">{period==='daily'?'Today (UTC)':'This month (UTC)'}</h3>{['audit','pagespeed','ai'].map(kind=><p key={kind} className="mt-2 text-sm">{kind}: {d.usage[period].find(x=>x.kind===kind)?.units??0}</p>)}</div>)}</div><p className="mt-3 text-sm">Daily caps: {d.usage.caps.pagespeedPerDay} PageSpeed · {d.usage.caps.aiPerDay} AI · {d.usage.caps.maxRunning} running jobs · {d.usage.caps.maxQueued} queued.</p><p className="mt-3 text-sm text-muted-foreground">{d.note}</p></Section>
  </>;
}
export default function OperationsPage(){return <Suspense fallback={<p>Loading system status…</p>}><Content/></Suspense>;}
