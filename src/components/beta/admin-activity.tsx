import { ArrowRight, History, Mail, Settings2, ShieldCheck } from "lucide-react";
import { formatDate } from "@/components/app/format";
import { surface } from "./workspace-ui";

const fields: Record<string, string> = { websiteLimit: "Website allowance", monthlyAuditLimit: "Monthly audits", pageLimit: "Pages per scan", concurrentAuditLimit: "Concurrent jobs", monthlyPagespeedLimit: "Monthly PageSpeed tests", monthlyAiLimit: "Monthly AI requests", status: "Account status" };
const actions: Record<string, string> = { "invitation.created": "Invitation created", "invitation.revoked": "Invitation revoked", "invitation.reissued": "Invitation reissued", "administrator.bootstrap": "Administrator access established", "admin.account.updated": "Account settings updated" };

export function AdminActivity({ events, accounts }: { events: { id: string; action: string; metadata: Record<string, string | number | boolean>; createdAt: Date }[]; accounts: { id: string; email: string }[] }) {
  const names = new Map(accounts.map(a => [a.id, a.email]));
  if (!events.length) return <div className={`${surface} p-8 text-center`}><History className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden /><p className="font-medium">No administrative activity yet</p><p className="mt-1 text-sm text-muted-foreground">Account and invitation changes will appear here.</p></div>;
  return <ol className={`${surface} divide-y overflow-hidden`}>
    {events.map(e => {
      const Icon = e.action.startsWith('invitation.') ? Mail : e.action === 'administrator.bootstrap' ? ShieldCheck : Settings2;
      const target = typeof e.metadata.targetUserId === 'string' ? names.get(e.metadata.targetUserId) : null;
      return <li key={e.id} className="flex gap-3 p-4 sm:gap-4 sm:px-5">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full border border-primary/15 bg-accent text-primary"><Icon className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col justify-between gap-1 sm:flex-row sm:gap-4"><p className="text-sm font-semibold">{actions[e.action] ?? e.action.replaceAll('.', ' ').replaceAll('_', ' ')}</p><time dateTime={e.createdAt.toISOString()} className="shrink-0 text-xs text-muted-foreground">{formatDate(e.createdAt)}</time></div>
          {target && <p className="mt-1 break-all text-sm text-muted-foreground">{target}</p>}
          {typeof e.metadata.field === 'string' && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">{fields[e.metadata.field] ?? e.metadata.field}</span><span className="rounded border bg-muted px-2 py-0.5">{String(e.metadata.before ?? 'Default')}</span><ArrowRight className="size-3 text-muted-foreground" aria-label="changed to" /><span className="rounded border border-primary/20 bg-accent px-2 py-0.5 font-medium text-accent-foreground">{String(e.metadata.after ?? 'Default')}</span></div>}
          {Object.keys(e.metadata).length > 0 && <details className="mt-2"><summary className="w-fit cursor-pointer text-xs font-medium text-primary underline-offset-4 hover:underline">View recorded details</summary><dl className="mt-2 grid gap-2 rounded-lg bg-muted/60 p-3 text-xs">{Object.entries(e.metadata).map(([key, value]) => <div key={key} className="min-w-0"><dt className="font-medium text-muted-foreground">{fields[key] ?? key.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-0.5 break-all">{String(value)}</dd></div>)}</dl></details>}
        </div>
      </li>;
    })}
  </ol>;
}
