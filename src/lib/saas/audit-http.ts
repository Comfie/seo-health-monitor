import "server-only";
import { customerAudits, AuditStateError } from "./audits";
import { OperationalLimitError } from "./repository";
import { betaJson, denied, hitBetaLimit, type BetaRuntime } from "./server";
import type { TenantContext } from "./tenant";

export type IdContext = { params: Promise<{ id: string }> };

/** Strict positive integer; "1 OR 1=1", "1e3", "-1", "0x10" and overflow are a plain 404. */
export const parseId = (raw: string | null | undefined) => (raw && /^[1-9]\d{0,9}$/.test(raw) && Number(raw) <= 2_147_483_647 ? Number(raw) : null);

export const auditsFor = (runtime: BetaRuntime, tenant: TenantContext) => customerAudits(runtime.db, tenant, runtime.limits);

/** Maps expected service errors to responses; anything else propagates (access denial is mapped by withCustomer). */
export function auditError(error: unknown) {
  if (error instanceof AuditStateError || error instanceof OperationalLimitError) return betaJson(409, { error: error.message });
  throw error;
}

/** Per-account request throttle for expensive endpoints (report rendering, starts, reruns). */
export async function throttle(runtime: BetaRuntime, tenant: TenantContext, scope: string, max: number, windowMs: number) {
  const limit = await hitBetaLimit(runtime.db, `${scope}:${tenant.tenantId}`, max, windowMs);
  return limit.allowed ? null : betaJson(429, { error: "Too many requests. Try again shortly." }, { "retry-after": String(limit.retryAfterSeconds) });
}

/** Resolves the route ID or returns the same 404 as a foreign or missing audit. */
export async function auditId(context: IdContext) {
  return parseId((await context.params).id);
}

export { denied };

/** Download headers: private, never cached by shared caches, filename from the customer's own data only. */
export function download(type: string, filename?: string) {
  const headers: Record<string, string> = { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (filename) headers["content-disposition"] = `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, "_").slice(0, 120)}"`;
  return headers;
}
