import { z } from "zod";
import { SsrfError } from "@/lib/crawler/ssrf";
import { UrlValidationError } from "@/lib/crawler/url";
import { OperationalLimitError, tenantRepository, ValidationError, websiteView } from "@/lib/saas/repository";
import { betaJson, withCustomer } from "@/lib/saas/server";

// Any tenantId/siteId/ownerId in the body is ignored: ownership comes from the session.
const input = z.object({ url: z.string().max(2048), displayName: z.string().max(200) });

export async function GET(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const sites = await tenantRepository(runtime.db, tenant).listWebsites();
    return betaJson(200, { websites: sites.map(websiteView) });
  });
}

export async function POST(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return betaJson(400, { error: "Enter a website URL and display name." });
    try {
      const site = await tenantRepository(runtime.db, tenant).addWebsite(parsed.data.url, parsed.data.displayName);
      return betaJson(site.created ? 201 : 200, { website: websiteView(site), created: site.created });
    } catch (error) {
      if (error instanceof UrlValidationError || error instanceof SsrfError || error instanceof ValidationError) return betaJson(400, { error: error.message });
      if (error instanceof OperationalLimitError) return betaJson(409, { error: error.message });
      throw error;
    }
  });
}
