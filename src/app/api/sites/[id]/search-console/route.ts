import { guard } from "@/lib/security/guard";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { GoogleApiError } from "@/lib/integrations/search-console/google";
import { linkProperty, unlinkProperty } from "@/lib/integrations/search-console/service";
import { applySearchConsoleToLatestAudit } from "@/lib/audit/index-status";

async function siteFrom(ctx: RouteContext<"/api/sites/[id]/search-console">) {
  const id = Number.parseInt((await ctx.params).id, 10);
  return Number.isFinite(id) ? getDb().select().from(schema.sites).where(eq(schema.sites.id, id)).get() : undefined;
}

export async function POST(request: Request, ctx: RouteContext<"/api/sites/[id]/search-console">) {
  const denied = guard(request);
  if (denied) return denied;
  const site = await siteFrom(ctx);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  const parsed = z.object({ property: z.string().min(3).max(300) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a Search Console property." }, { status: 400 });
  try {
    await linkProperty(site.id, parsed.data.property);
    return NextResponse.json({ linked: parsed.data.property });
  } catch (err) {
    const status = err instanceof GoogleApiError ? (err.needsReconnect ? 401 : err.status >= 400 && err.status < 500 ? err.status : 502) : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/sites/[id]/search-console">) {
  const denied = guard(request);
  if (denied) return denied;
  const site = await siteFrom(ctx);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  unlinkProperty(site.id);
  applySearchConsoleToLatestAudit(site.id);
  return NextResponse.json({ unlinked: true });
}
