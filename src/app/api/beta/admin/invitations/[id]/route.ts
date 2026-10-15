import { InvitationError, revokeInvitation } from "@/lib/saas/invitations";
import { betaJson, withCustomer } from "@/lib/saas/server";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/.test(id)) return betaJson(404, { error: "Invitation not found." });
    try {
      await revokeInvitation(runtime.db, id, tenant.userId);
      return betaJson(200, { ok: true });
    } catch (error) {
      if (error instanceof InvitationError) return betaJson(409, { error: error.message });
      throw error;
    }
  }, { admin: true });
}
