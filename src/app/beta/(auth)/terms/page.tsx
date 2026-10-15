import { Suspense } from 'react';
import { PrivacyContact, PrivacyLinks } from '@/components/beta/privacy-links';
import { requireBetaRuntime } from '@/lib/saas/page';
export const metadata={title:'Terms of Use'};
const h2='text-xl font-semibold';
async function Content(){await requireBetaRuntime();return <main className="mx-auto max-w-3xl space-y-5 px-4 py-10"><h1 className="text-3xl font-semibold">Terms of Use</h1>
<p className="text-sm text-muted-foreground">Last updated 15 October 2026</p>
<p>SEO Health Monitor is an invitation-only beta operated by Comfort Nyatsine in South Africa. By creating an account you agree to these terms.</p>
<h2 className={h2}>The beta</h2>
<p>The service is free during the beta, with no payments or subscriptions. Features, limits and availability may change while we test and improve it, and the service may occasionally be unavailable. Your account is personal: keep your password private and don’t share your account.</p>
<h2 className={h2}>Acceptable use</h2>
<p>Only audit websites you own or have permission to assess, and respect each website’s rules. Don’t use the service to access private networks, get around logins or security, overload or disrupt websites, submit unlawful content, or try to reach another person’s account. We may suspend accounts or stop running audits that break these rules.</p>
<h2 className={h2}>What the results are, and aren’t</h2>
<p>Audits are technical observations and recommendations based on what our crawler and Google’s tools measured at the time. They are not a guarantee of search rankings, indexing, traffic, speed or business results. Check recommendations before changing your website, and keep backups. When something couldn’t be measured, it is shown as “not verified” and not counted as a pass or a fail.</p>
<h2 className={h2}>Your data</h2>
<p>You keep ownership of your account data. You can download it or permanently delete your account at any time from Account settings. How we handle personal information is described in the <a className="underline" href="/beta/privacy">Privacy Policy</a>.</p>
<h2 className={h2}>Liability</h2>
<p>The beta is provided as it is, without warranties. To the extent the law allows, we are not liable for losses arising from using the service or relying on its results. Nothing in these terms limits rights you have under South African consumer law that cannot be excluded.</p>
<h2 className={h2}>Ending or changing these terms</h2>
<p>You can stop using the service and delete your account at any time. We may end the beta or close accounts with reasonable notice, except where immediate action is needed to stop misuse. We will show the date of any change at the top of this page. These terms are governed by the laws of South Africa.</p>
<PrivacyContact/><PrivacyLinks/></main>;}
export default function Page(){return <Suspense fallback={<p>Loading terms…</p>}><Content/></Suspense>;}
