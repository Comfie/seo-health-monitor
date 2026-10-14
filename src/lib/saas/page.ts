import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { getBeta, isAdministrator, type BetaRuntime } from "./server";
import { AccessDeniedError, requireTenant } from "./tenant";

/** Public beta pages (sign-in, registration, recovery): 404 unless the beta is configured. */
export async function requireBetaRuntime(): Promise<BetaRuntime> {
  // Request time only: never build the runtime (or open the database) while prerendering.
  await connection();
  const beta = await getBeta();
  if (beta.state !== "ready") notFound();
  return beta.runtime;
}

/**
 * Data access entry for customer pages. Tenant identity is derived from the
 * library session on every request; deduplicated per render with React cache().
 */
export const getCustomerPage = cache(async () => {
  const runtime = await requireBetaRuntime();
  const requestHeaders = await headers();
  const session = await runtime.auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/beta/login");
  if (!session.user.emailVerified) redirect("/beta/login?error=unverified");
  try {
    const tenant = await requireTenant(runtime.db, runtime.auth, requestHeaders);
    return {
      runtime,
      tenant,
      sessionId: session.session.id,
      user: { name: session.user.name, email: session.user.email },
      isAdmin: await isAdministrator(runtime.db, tenant.userId),
    };
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/beta/login?error=unavailable");
    throw error;
  }
});
