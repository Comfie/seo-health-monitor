import { guard } from "@/lib/security/guard";
import { NextResponse } from "next/server";
import { disconnect, listSiteConnections } from "@/lib/integrations/search-console/service";
import { applySearchConsoleToLatestAudit } from "@/lib/audit/index-status";

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const linkedSites = listSiteConnections().map((c) => c.siteId);
  await disconnect();
  for (const siteId of linkedSites) applySearchConsoleToLatestAudit(siteId);
  return NextResponse.json({ disconnected: true });
}
