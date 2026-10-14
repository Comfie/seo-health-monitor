import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import { PageHeader, Section } from "@/components/app/page-header";
import { BetaNotice } from "@/components/beta/beta-notice";
import { AddWebsiteForm, WebsiteList } from "@/components/beta/website-manager";
import { tenantRepository, websiteView } from "@/lib/saas/repository";
import { getCustomerPage } from "@/lib/saas/page";

export const metadata = { title: "Websites" };

async function WebsitesContent() {
  const { runtime, tenant } = await getCustomerPage();
  const repo = tenantRepository(runtime.db, tenant);
  const { usage, websites: summary } = await repo.dashboard();
  const websites = (await repo.listWebsites()).map((site) => ({ ...websiteView(site), activeAuditId: summary.find((w) => w.id === site.id)?.activeAuditId ?? null }));
  const full = usage.websites >= usage.websiteLimit;
  return (
    <>
      <PageHeader
        title="Websites"
        description="Add the public websites you want to monitor, then run an audit. Adding a website stores it as an audit target for your account only; it does not claim ownership of the domain."
      />
      <BetaNotice />
      <Section title="Add a website" description={full ? `You have reached the beta limit of ${usage.websiteLimit} websites. Remove one to add another.` : `${usage.websites} of ${usage.websiteLimit} websites used.`}>
        <AddWebsiteForm disabled={full} />
      </Section>
      <Section title="Your websites">
        <WebsiteList websites={websites} />
      </Section>
    </>
  );
}

export default function WebsitesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <WebsitesContent />
    </Suspense>
  );
}
