import { Suspense } from 'react';
import { PrivacyContact, PrivacyLinks } from '@/components/beta/privacy-links';
import { requireBetaRuntime } from '@/lib/saas/page';
import { readRetentionPolicy } from '@/lib/saas/retention';
export const metadata={title:'Privacy Policy'};
const h2='text-xl font-semibold';
async function Content(){await requireBetaRuntime(); const {days}=readRetentionPolicy();
const periods:[string,number][]=[['Audit results, crawled page data and generated reports',days.audits],['Search Console snapshots',days.searchSnapshots],['Account activity and sign-in events',Math.max(days.activity,days.authEvents)],['Invitation records',days.invitations],['Audit logs and finished background jobs',Math.max(days.scanLogs,days.failedJobs)],['Encrypted backups',days.backups]];
return <main className="mx-auto max-w-3xl space-y-5 px-4 py-10"><h1 className="text-3xl font-semibold">Privacy Policy</h1>
<p className="text-sm text-muted-foreground">Last updated 15 October 2026</p>
<p>SEO Health Monitor is an invitation-only beta service for auditing websites, operated by Comfort Nyatsine in South Africa. This policy explains what personal information we collect, why, and the choices you have. It is written with South Africa’s Protection of Personal Information Act (POPIA) in mind.</p>
<h2 className={h2}>What we collect and why</h2>
<ul className="list-disc space-y-1 pl-5"><li><b>Account details:</b> your name, email address and a hashed password (we never store or see your password itself), to create and secure your account.</li><li><b>Sign-in and device information:</b> sessions, browser and device names and security events, to keep your account safe and let you sign out other devices.</li><li><b>Websites and audit results:</b> the websites you add and what our crawler finds on their public pages, to produce your audits, reports and progress history.</li><li><b>Google Search Console data (optional):</b> if you connect it, the search performance and indexing information for the properties you link, to show it next to your audits.</li><li><b>Usage counts:</b> how many audits and speed tests you have used, to apply fair-use limits.</li></ul>
<p>We do not sell personal information, use it for advertising, or share it with anyone except the service providers below.</p>
<h2 className={h2}>Service providers and where data is processed</h2>
<ul className="list-disc space-y-1 pl-5"><li><b>Railway</b> hosts the application and its database in the EU West region (the Netherlands).</li><li><b>Google</b> receives the public page addresses we test with PageSpeed Insights and handles Search Console requests if you connect it.</li><li><b>Resend</b> delivers account emails such as invitations, verification and password resets.</li><li><b>Anthropic</b> would process audit results only if you request an AI consultant report. This feature is currently switched off.</li></ul>
<p>These providers may process information outside South Africa. We use them only to run the service and rely on their published security and data-protection commitments. Please don’t add websites or URLs that contain confidential information.</p>
<h2 className={h2}>How long we keep information</h2>
<p>We keep your information while your account is active. You can delete your account at any time (see below), which removes your active data immediately. We plan to delete older records automatically after the periods below; this has not been switched on yet, and we will update this page before it is.</p>
<dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[1fr_auto]">{periods.map(([label,d])=><div key={label} className="contents"><dt>{label}</dt><dd className="tabular-nums text-muted-foreground">{d} days</dd></div>)}</dl>
<p>After an account is deleted we keep only a minimal deletion receipt (containing no name or email) and anonymous daily usage totals, so deleted accounts are never restored from a backup and shared limits keep working.</p>
<h2 className={h2}>Your rights and choices</h2>
<p>In <b>Account settings</b> you can update your name and password, sign out other sessions, download all your data as a JSON file, and permanently delete your account. You can also ask us to access, correct or delete your information, or object to how it is processed. We will confirm your identity before acting on a request. If you are unhappy with how we handle your information, you can complain to South Africa’s <a className="underline" href="https://inforegulator.org.za/" target="_blank" rel="noreferrer">Information Regulator</a>.</p>
<PrivacyContact/>
<h2 className={h2}>How we protect information</h2>
<p>All traffic is encrypted, passwords are hashed, Google credentials are encrypted at rest, and every account’s data is kept separate with access checks on every request. Database access is restricted to what the application needs. No online service can guarantee perfect security; if a security compromise affects your personal information, we will investigate and notify you and the Information Regulator as POPIA requires.</p>
<h2 className={h2}>Changes</h2>
<p>We will update this page when our practices change and show the date of the latest version at the top. For significant changes we will also email account holders.</p>
<PrivacyLinks/></main>;}
export default function Page(){return <Suspense fallback={<p>Loading privacy policy…</p>}><Content/></Suspense>;}
