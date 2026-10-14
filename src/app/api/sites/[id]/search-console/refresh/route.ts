import { guard } from "@/lib/security/guard";
import { NextResponse } from "next/server";
import { checkLimits, clientKey } from "@/lib/rate-limit";
import { listAudits, getFullAudit } from "@/lib/audit/repository";
import { fetchSnapshot, getSiteConnection } from "@/lib/integrations/search-console/service";

export const maxDuration = 120;

export async function POST(request: Request, ctx: RouteContext<"/api/sites/[id]/search-console/refresh">) {
  const denied = guard(request);
  if (denied) return denied;
  const limit = checkLimits(clientKey(request.headers), "gsc", { max: 20, windowMs: 60 * 60_000 }, { max: 40, windowMs: 60 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: `Too many requests. Try again in ${Math.ceil(limit.retryAfterMs / 60_000)} minutes.` }, { status: 429 });
  const siteId = Number.parseInt((await ctx.params).id, 10);
  if (!Number.isFinite(siteId) || !getSiteConnection(siteId)) {
    return NextResponse.json({ error: "Link this site to a Search Console property first." }, { status: 400 });
  }
  // Inspect the pages from the latest completed audit so index status covers what was crawled.
  const latest = listAudits({ siteId, status: "completed", limit: 1 })[0];
  const pageUrls = latest ? (getFullAudit(latest.id)?.pages ?? []).filter((p) => p.status === 200).map((p) => p.finalUrl) : [];
  const snapshot = await fetchSnapshot(siteId, { pageUrls });
  if (!snapshot || snapshot.status === "error") {
    return NextResponse.json({ error: snapshot?.error ?? "Search Console data could not be fetched." }, { status: 502 });
  }
  return NextResponse.json({ snapshotId: snapshot.id });
}
