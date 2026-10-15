'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorText, postJson } from './forms';
import { ChevronDown, Loader2, RotateCcw, Save, ShieldCheck, SlidersHorizontal, UserRound, UserRoundCheck, UserRoundX } from 'lucide-react';
import { StatusPill, surface, UsageMeter } from './workspace-ui';

const fields = [ ['websiteLimit','Websites',0,100], ['monthlyAuditLimit','Monthly audits',0,1000], ['pageLimit','Pages per scan',1,100], ['concurrentAuditLimit','Concurrent jobs',1,10], ['monthlyPagespeedLimit','Monthly PageSpeed tests',0,10000], ['monthlyAiLimit','Monthly AI requests',0,1000] ] as const;
type Overrides = Record<(typeof fields)[number][0],number|null>;
export type AdminAccountView = {id:string; email:string; name:string; verified:boolean; status:string; createdAt:string; overrides:Overrides|null; limits:{websites:number;auditsPerMonth:number;pagesPerScan:number;concurrentScans:number;pagespeedPerMonth:number;aiPerMonth:number}|null; usage:{websites:number;auditsThisMonth:number;pagespeedThisMonth:number;aiThisMonth:number;activeJobs:number}|null};
export function AdminAccounts({accounts}:{accounts:AdminAccountView[]}) {
  return <div className="flex flex-col gap-4">{accounts.length ? accounts.map(a=><Account key={a.id} account={a}/>) : <div className={`${surface} p-8 text-center`}><UserRound className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden /><p className="font-medium">No matching accounts</p><p className="mt-1 text-sm text-muted-foreground">Try another email address or clear your search.</p></div>}</div>;
}
function Account({account:a}:{account:AdminAccountView}) {
  const router=useRouter(); const [pending,setPending]=useState(false); const [message,setMessage]=useState(''); const [success,setSuccess]=useState(false);
  async function save(body:unknown) {
    setPending(true); setMessage(''); setSuccess(false);
    try {const r=await postJson(`/api/beta/admin/accounts/${a.id}`,body,'PATCH'); if(!r.ok) setMessage(errorText(r,'Could not update this account.')); else {setSuccess(true);setMessage('Saved and recorded in the administrative log.');router.refresh();}}
    catch {setMessage('Connection lost. Check the current values before retrying.');}
    finally {setPending(false);}
  }
  return <article className={`${surface} overflow-hidden`}>
    <div className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent font-semibold text-primary" aria-hidden>{(a.name || a.email).slice(0,1).toUpperCase()}</span><div className="min-w-0"><h3 className="break-all font-semibold">{a.email}</h3><p className="mt-1 text-xs text-muted-foreground">{a.name} · Joined {a.createdAt.slice(0,10)}</p></div></div>
        <StatusPill tone={a.status==='active'?'good':a.status==='suspended'?'danger':'warning'}>{a.status==='active'?'Active':a.status==='suspended'?'Suspended':'Pending'}</StatusPill>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden />{a.verified ? 'Email verified' : 'Awaiting verification'}</span>{a.limits && <span>{a.limits.pagesPerScan} pages per scan · {a.limits.concurrentScans} concurrent jobs</span>}{a.usage && <span>{a.usage.activeJobs} active jobs</span>}</div>
      {a.usage && a.limits && <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2 xl:grid-cols-4"><UsageMeter label="Websites" used={a.usage.websites} limit={a.limits.websites}/><UsageMeter label="Monthly audits" used={a.usage.auditsThisMonth} limit={a.limits.auditsPerMonth}/><UsageMeter label="PageSpeed tests" used={a.usage.pagespeedThisMonth} limit={a.limits.pagespeedPerMonth}/><UsageMeter label="AI requests" used={a.usage.aiThisMonth} limit={a.limits.aiPerMonth}/></div>}
    </div>
    {a.overrides && <details className="group/controls border-t bg-muted/30"><summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 sm:px-5"><span className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary/30 bg-accent px-3 text-sm font-semibold text-accent-foreground shadow-xs"><SlidersHorizontal className="size-4" aria-hidden />Account controls<ChevronDown className="ml-1 size-4 group-open/controls:rotate-180" aria-hidden /></span><span className="hidden text-xs text-muted-foreground sm:inline">Limits and access</span></summary>
      <div className="border-t p-4 sm:p-5">
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">Leave a field blank to use the default allowance. Suspension signs out all sessions and cancels active work. Administrator accounts are protected from suspension.</p>
      <form key={JSON.stringify(a.overrides)} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void save(Object.fromEntries(fields.map(([key])=>[key,data.get(key)===''?null:Number(data.get(key))])));}}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key,label,min,max])=><label key={key} className="flex flex-col gap-1.5 text-sm font-medium">{label}<Input className="h-10 bg-card font-normal" type="number" name={key} min={min} max={max} step={1} placeholder="Default allowance" defaultValue={a.overrides![key]??''}/></label>)}</div>
        <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:flex-wrap"><Button className="h-10 px-4 shadow-xs" type="submit" disabled={pending}>{pending?<Loader2 className="animate-spin motion-reduce:animate-none"/>:<Save/>}{pending?'Saving…':'Save overrides'}</Button><Button className="h-10 bg-card px-4" type="button" variant="outline" disabled={pending} onClick={()=>void save(Object.fromEntries(fields.map(([k])=>[k,null])))}><RotateCcw/>Remove all overrides</Button>
        <Button className="h-10 border border-current/20 px-4 sm:ml-auto" type="button" variant={a.status==='active'?'destructive':'outline'} disabled={pending} onClick={()=>void save({status:a.status==='active'?'suspended':'active'})}>{a.status==='active'?<UserRoundX/>:<UserRoundCheck/>}{a.status==='active'?'Suspend account':'Reactivate account'}</Button></div>
      </form>
      </div>
    </details>}
    {message && <p role="status" className={`mx-4 mb-4 rounded-lg border px-3 py-2 text-sm sm:mx-5 ${success?'border-primary/20 bg-accent text-accent-foreground':'border-destructive/20 bg-destructive/10 text-destructive'}`}>{message}</p>}
  </article>;
}
