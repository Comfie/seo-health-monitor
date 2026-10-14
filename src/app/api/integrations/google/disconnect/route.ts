import { guard } from "@/lib/security/guard";
import { NextResponse } from "next/server";
import { disconnect } from "@/lib/integrations/search-console/service";

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  await disconnect();
  return NextResponse.json({ disconnected: true });
}
