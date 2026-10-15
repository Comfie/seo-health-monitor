import { NextResponse, connection } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { GET as tenantHealth } from "@/app/api/beta/health/route";

/** Liveness/readiness probe for container platforms. Reveals no data. */
export async function GET() {
  if (process.env.PHASE2_UNIFIED === "true") return tenantHealth();
  await connection();
  try {
    getDb().get(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
