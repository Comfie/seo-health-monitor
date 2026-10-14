import { NextResponse, connection } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { AuditBusyError, startAudit } from "@/lib/audit/runner";
import { listAudits } from "@/lib/audit/repository";
import { UrlValidationError } from "@/lib/crawler/url";
import { SsrfError } from "@/lib/crawler/ssrf";
import { RateLimiter, clientKey } from "@/lib/rate-limit";

const limiter = ((globalThis as unknown as { __auditLimiter?: RateLimiter }).__auditLimiter ??= new RateLimiter(config.rateLimit.max, config.rateLimit.windowMs));

const body = z.object({ url: z.string().min(1).max(2048) });

export async function GET() {
  await connection();
  return NextResponse.json({ audits: listAudits({ limit: 200 }) });
}

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a JSON body like {\"url\": \"https://example.com\"}." }, { status: 400 });

  const rate = limiter.check(clientKey(request.headers));
  if (!rate.allowed) {
    const minutes = Math.ceil(rate.retryAfterMs / 60_000);
    return NextResponse.json(
      { error: `Audit limit reached (${config.rateLimit.max} per ${Math.round(config.rateLimit.windowMs / 60_000)} minutes). Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429, headers: { "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  try {
    const id = startAudit(parsed.data.url);
    return NextResponse.json({ id }, { status: 202 });
  } catch (err) {
    if (err instanceof UrlValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof SsrfError) return NextResponse.json({ error: `This address can't be audited: ${err.message}. Only public websites are supported.` }, { status: 400 });
    if (err instanceof AuditBusyError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error(err);
    return NextResponse.json({ error: "The audit could not be started." }, { status: 500 });
  }
}
