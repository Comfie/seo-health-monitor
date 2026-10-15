import { Suspense } from 'react';
import { PrivacyContact, PrivacyLinks } from '@/components/beta/privacy-links';
import { requireBetaRuntime } from '@/lib/saas/page';
export const metadata={title:'Crawling and data use'};
const h2='text-xl font-semibold';
async function Content(){await requireBetaRuntime();return <main className="mx-auto max-w-3xl space-y-5 px-4 py-10"><h1 className="text-3xl font-semibold">Crawling and data use</h1>
<p className="text-sm text-muted-foreground">Last updated 15 October 2026</p>
<h2 className={h2}>How we crawl your website</h2>
<p>When you run an audit, our crawler requests publicly accessible pages of the website you chose, a few at a time with pauses between requests, and follows the site’s robots.txt rules. It reads the HTML, links, page titles and descriptions, headings, response codes, indexing instructions and similar SEO signals. It never logs in, submits forms or changes anything on your site. Only audit sites you are allowed to assess, and avoid adding URLs that contain private information or access tokens.</p>
<h2 className={h2}>PageSpeed Insights</h2>
<p>To measure speed, we send a small number of your public page addresses to Google PageSpeed Insights for mobile and desktop tests. If Google can’t complete a test, the result is shown as unavailable and isn’t counted in your score.</p>
<h2 className={h2}>Google Search Console (optional)</h2>
<p>If you connect Search Console, we ask Google for read-only permission to list your properties, read search performance (queries, pages, clicks, impressions, positions) and check the indexing status of pages we crawled. We can’t change anything in your Google account. This data is private to your account and shown alongside your audits; it never changes the on-site health score.</p>
<p>Disconnecting removes the stored Google credential and your property links from our service; earlier snapshots stay in your account until you delete them or your account. You can also remove our access from your Google account’s security settings at any time. If the same Google account is connected to more than one SEO Health Monitor account, removing access in Google affects all of them.</p>
<h2 className={h2}>Exporting and deleting your data</h2>
<p>From Account settings you can download a JSON file with your profile, websites, audits, findings, speed results, Search Console snapshots and activity. Passwords, sessions and access tokens are never included. Deleting your account requires your password and typing DELETE MY ACCOUNT; it signs you out everywhere, stops any queued audits and erases your account data immediately. Encrypted backups may hold a copy for a short period until they expire, and deleted accounts are never restored from them.</p>
<PrivacyContact/><PrivacyLinks/></main>;}
export default function Page(){return <Suspense fallback={<p>Loading data information…</p>}><Content/></Suspense>;}
