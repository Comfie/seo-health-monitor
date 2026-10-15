'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LifecycleControls({isAdmin}: {isAdmin: boolean}) {
  const router=useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function run(operation: 'export' | 'delete') {
    setPending(true); setMessage('');
    try {
      const response = await fetch(`/api/beta/account/${operation}`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({password, confirmation})});
      if (!response.ok) {const data = await response.json(); throw new Error(data.error || 'Please try again.');}
      setPassword('');
      if(operation==='delete') {router.replace('/beta/login?deleted=1'); router.refresh(); return;}
      const blob = await response.blob();
      const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='seo-health-monitor-account.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage('Your JSON export has been downloaded. Store it somewhere private.');
    } catch(e) {setMessage(e instanceof Error ? e.message : 'Connection lost. Please try again.');}
    finally {setPending(false);}
  }
  return <div className="flex max-w-2xl flex-col gap-4 rounded-lg border bg-card p-4">
    <p className="text-sm">Download your profile, websites, audit results, findings, Search Console history and activity in JSON. Confirm your current password for either action.</p>
    <label className="flex flex-col gap-2 text-sm font-medium">Current password<Input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} /></label>
    <Button disabled={pending || !password} onClick={()=>void run('export')}>{pending ? 'Working…' : 'Download account data'}</Button>
    <div className="border-t pt-4">
      <h3 className="font-semibold">Permanently delete account</h3>
      <p className="mt-2 text-sm text-muted-foreground">This signs out all devices, cancels queued and running work, and removes your profile, websites, audits, reports, Google credentials and Search Console history. Deletion cannot be undone. A minimal deletion receipt remains for recovery safeguards, and anonymous daily resource totals preserve shared cost limits; restricted backups expire under the retention policy. Download your data first.</p>
      <p className="mt-2 text-sm text-muted-foreground">Local Google access is removed. To avoid affecting another account using the same Google identity, deletion does not revoke the shared Google grant. You can also remove this app in your Google account permissions.</p>
      {isAdmin ? <p className="mt-3 text-sm">Administrator deletion requires an operator handover. Contact the beta operator.</p> : <>
      <label className="mt-4 flex flex-col gap-2 text-sm font-medium">Type DELETE MY ACCOUNT<Input value={confirmation} autoComplete="off" onChange={e=>setConfirmation(e.target.value)} /></label>
      <Button className="mt-3" variant="destructive" disabled={pending || !password || confirmation!=='DELETE MY ACCOUNT'} onClick={()=>void run('delete')}>Permanently delete my account</Button></>}
    </div>
    <p role="status" className="text-sm">{message}</p>
    <div className="flex flex-wrap gap-4 text-sm"><Link className="underline" href="/beta/privacy">Privacy Policy</Link><Link className="underline" href="/beta/terms">Terms of Use</Link><Link className="underline" href="/beta/data-use">Crawling and data use</Link></div>
  </div>;
}
