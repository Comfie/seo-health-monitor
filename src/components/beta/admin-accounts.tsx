'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorText, postJson } from './forms';

const fields = [ ['websiteLimit','Websites',0,100], ['monthlyAuditLimit','Monthly audits',0,1000], ['pageLimit','Pages per scan',1,100], ['concurrentAuditLimit','Concurrent jobs',1,10], ['monthlyPagespeedLimit','Monthly PageSpeed tests',0,10000], ['monthlyAiLimit','Monthly AI requests',0,1000] ] as const;
type Overrides = Record<(typeof fields)[number][0],number|null>;
export type AdminAccountView = {id:string; email:string; name:string; verified:boolean; status:string; createdAt:string; overrides:Overrides|null; limits:{websites:number;auditsPerMonth:number;pagesPerScan:number;concurrentScans:number;pagespeedPerMonth:number;aiPerMonth:number}|null; usage:{websites:number;auditsThisMonth:number;pagespeedThisMonth:number;aiThisMonth:number;activeJobs:number}|null};
export function AdminAccounts({accounts}:{accounts:AdminAccountView[]}) {
  return <div className="flex flex-col gap-4">{accounts.length ? accounts.map(a=><Account key={a.id} account={a}/>) : <p className="text-sm text-muted-foreground">No accounts match that email.</p>}</div>;
}
function Account({account:a}:{account:AdminAccountView}) {
  const router=useRouter(); const [pending,setPending]=useState(false); const [message,setMessage]=useState('');
  async function save(body:unknown) {
    setPending(true); setMessage('');
    try {const r=await postJson(`/api/beta/admin/accounts/${a.id}`,body,'PATCH'); if(!r.ok) setMessage(errorText(r,'Could not update this account.')); else {setMessage('Saved and recorded in the administrative log.');router.refresh();}}
    catch {setMessage('Connection lost. Check the current values before retrying.');}
    finally {setPending(false);}
  }
  return <article className="rounded-lg border bg-card p-4">
    <h3 className="break-all font-semibold">{a.email}</h3><p className="mt-1 text-sm text-muted-foreground">{a.status} · {a.verified ? 'Email verified' : 'Awaiting verification'} · Created {a.createdAt.slice(0,10)}</p>
    {a.usage && a.limits && <p className="mt-3 text-sm">Websites: {a.usage.websites}/{a.limits.websites}. This month: {a.usage.auditsThisMonth}/{a.limits.auditsPerMonth} audits · {a.usage.pagespeedThisMonth}/{a.limits.pagespeedPerMonth} PageSpeed · {a.usage.aiThisMonth}/{a.limits.aiPerMonth} AI · {a.usage.activeJobs} active jobs. Limits: {a.limits.websites} websites, {a.limits.pagesPerScan} pages/scan, {a.limits.concurrentScans} concurrent jobs.</p>}
    {a.overrides && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Account controls</summary>
      <p className="my-3 text-sm text-muted-foreground">Leave a field blank to remove its override and follow the beta defaults. Suspension signs out all sessions and cancels active work. The administrator cannot suspend an administrator.</p>
      <form key={JSON.stringify(a.overrides)} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void save(Object.fromEntries(fields.map(([key])=>[key,data.get(key)===''?null:Number(data.get(key))])));}}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key,label,min,max])=><label key={key} className="flex flex-col gap-1 text-sm">{label}<Input type="number" name={key} min={min} max={max} step={1} placeholder="Beta default" defaultValue={a.overrides![key]??''}/></label>)}</div>
        <div className="mt-4 flex flex-wrap gap-3"><Button type="submit" disabled={pending}>Save overrides</Button><Button type="button" variant="outline" disabled={pending} onClick={()=>void save(Object.fromEntries(fields.map(([k])=>[k,null])))}>Remove all overrides</Button>
        <Button type="button" variant={a.status==='active'?'destructive':'outline'} disabled={pending} onClick={()=>void save({status:a.status==='active'?'suspended':'active'})}>{a.status==='active'?'Suspend account':'Reactivate account'}</Button></div>
      </form>
    </details>}
    <p role="status" className="mt-2 text-sm">{message}</p>
  </article>;
}
