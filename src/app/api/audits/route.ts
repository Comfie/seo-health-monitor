import { guard } from "@/lib/security/guard";
import { NextResponse, connection } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { AuditBusyError, enqueueAudit } from "@/lib/audit/queue";
import { listAudits } from "@/lib/audit/repository";
import { UrlValidationError } from "@/lib/crawler/url";
import { SsrfError } from "@/lib/crawler/ssrf";
import { checkLimits, clientKey } from "@/lib/rate-limit";

const body = z.object({ url: z.string().min(1).max(2048) });

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  await connection();
  return NextResponse.json({ audits: listAudits({ limit: 200 }) });
}

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a JSON body like {\"url\": \"https://example.com\"}." }, { status: 400 });

  const rate = checkLimits(clientKey(request.headers), "audit", { max: config.rateLimit.max, windowMs: config.rateLimit.windowMs }, { max: config.rateLimit.globalMax, windowMs: config.rateLimit.windowMs });
  if (!rate.allowed) {
    const minutes = Math.ceil(rate.retryAfterMs / 60_000);
    return NextResponse.json(
      { error: `Audit limit reached. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429, headers: { "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  try {
    const id = enqueueAudit(parsed.data.url);
    return NextResponse.json({ id }, { status: 202 });
  } catch (err) {
    if (err instanceof UrlValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof SsrfError) return NextResponse.json({ error: `This address can't be audited: ${err.message}. Only public websites are supported.` }, { status: 400 });
    if (err instanceof AuditBusyError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error(err);
    return NextResponse.json({ error: "The audit could not be started." }, { status: 500 });
  }
}
