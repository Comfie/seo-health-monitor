import "server-only";
import { notFound } from "next/navigation";
import { auditsFor } from "./audit-http";
import { getCustomerPage } from "./page";
import { AccessDeniedError } from "./tenant";

/**
 * Page entry for one audit: tenant from the session, then the audit through the tenant
 * service. A foreign or missing ID renders the same not-found page.
 */
export async function getCustomerAudit(rawId: string) {
  const ctx = await getCustomerPage();
  const id = /^[1-9]\d{0,9}$/.test(rawId) ? Number(rawId) : null;
  if (!id) notFound();
  const audits = auditsFor(ctx.runtime, ctx.tenant);
  try {
    return { ...ctx, audits, status: await audits.status(id) };
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }
}
