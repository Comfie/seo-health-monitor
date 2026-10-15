import { and, eq } from "drizzle-orm";
import { session } from "@/lib/saas/auth-schema";
import { betaJson, denied, withCustomer } from "@/lib/saas/server";

type Context = { params: Promise<{ id: string }> };

/** Revokes one of the caller's own sessions by its ID (tokens never reach the browser). */
export async function DELETE(request: Request, { params }: Context) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return denied();
    const removed = await runtime.db.delete(session).where(and(eq(session.id, id), eq(session.userId, tenant.userId))).returning({ id: session.id });
    return removed.length ? betaJson(200, { ok: true }) : denied();
  });
}
