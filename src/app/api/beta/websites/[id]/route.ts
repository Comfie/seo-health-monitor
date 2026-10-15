import { z } from "zod";
import { OperationalLimitError, tenantRepository, ValidationError, websiteView } from "@/lib/saas/repository";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

type Context = { params: Promise<{ id: string }> };

// Strict positive integer; "1 OR 1=1", "1e3", "-1" and other forms are a plain 404.
const parseId = (raw: string) => (/^[1-9]\d{0,9}$/.test(raw) && Number(raw) <= 2_147_483_647 ? Number(raw) : null);
const rename = z.object({ displayName: z.string().max(200) });

export async function GET(request: Request, { params }: Context) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = parseId((await params).id);
    if (!id) return denied();
    return betaJson(200, { website: websiteView(await tenantRepository(runtime.db, tenant).getWebsite(id)) });
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = parseId((await params).id);
    if (!id) return denied();
    const parsed = rename.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return betaJson(400, { error: "Enter a display name." });
    try {
      return betaJson(200, { website: websiteView(await tenantRepository(runtime.db, tenant).renameWebsite(id, parsed.data.displayName)) });
    } catch (error) {
      if (error instanceof ValidationError) return betaJson(400, { error: error.message });
      throw error;
    }
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const id = parseId((await params).id);
    if (!id) return denied();
    try {
      await tenantRepository(runtime.db, tenant).removeWebsite(id);
      return betaJson(200, { ok: true });
    } catch (error) {
      if (error instanceof OperationalLimitError) return betaJson(409, { error: error.message });
      throw error;
    }
  });
}
