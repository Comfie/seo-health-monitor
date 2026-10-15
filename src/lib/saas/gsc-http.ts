import "server-only";
import { SearchConsoleError, customerSearchConsole } from "./search-console";
import { betaJson, type BetaRuntime } from "./server";
import type { TenantContext } from "./tenant";

export const searchConsoleFor = (runtime: BetaRuntime, tenant: TenantContext) => customerSearchConsole(runtime.db, tenant, runtime.config.google);

const STATUS: Record<SearchConsoleError["code"], number> = {
  not_configured: 503,
  not_connected: 409,
  reconnect: 409,
  property_unavailable: 403,
  property_unsuitable: 422,
  not_linked: 409,
  google_error: 502,
};

/** Maps expected Search Console errors to customer-safe responses; anything else propagates. */
export function searchConsoleError(error: unknown) {
  if (error instanceof SearchConsoleError) return betaJson(STATUS[error.code], { error: error.message, code: error.code });
  throw error;
}

/** Reads one cookie from a request without trusting any other header. */
export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
