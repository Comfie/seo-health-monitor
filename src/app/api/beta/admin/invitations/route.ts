import { z } from "zod";
import { createInvitation, InvitationError, listInvitations } from "@/lib/saas/invitations";
import { betaJson, withCustomer } from "@/lib/saas/server";

const input = z.object({ email: z.string().max(254) });

export async function GET(request: Request) {
  return withCustomer(request, async ({ runtime }) => betaJson(200, {
    invitations: await listInvitations(runtime.db),
    invitationsEnabled: runtime.config.invitationsEnabled,
  }), { admin: true });
}

export async function POST(request: Request) {
  return withCustomer(request, async ({ runtime, tenant }) => {
    // Operator kill switch: PHASE2_INVITATIONS_ENABLED=false stops new invitations immediately.
    if (!runtime.config.invitationsEnabled || runtime.config.registration !== "invite-only") return betaJson(403, { error: "New invitations are disabled by configuration." });
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return betaJson(400, { error: "Enter a valid email address." });
    try {
      const { invitation, token } = await createInvitation(runtime.db, { email: parsed.data.email, createdBy: tenant.userId, ttlHours: runtime.config.invitationTtlHours });
      const url = `${runtime.config.origin}/beta/register?token=${token}`;
      let emailed = true;
      try {
        await runtime.mail({ to: invitation.email, purpose: "invitation", url, expiresAt: invitation.expiresAt });
      } catch {
        emailed = false;
      }
      // The link is returned to the administrator once (for manual delivery); it is never stored.
      return betaJson(201, { invitation: { id: invitation.id, email: invitation.email, status: "pending", expiresAt: invitation.expiresAt.toISOString() }, link: url, emailed });
    } catch (error) {
      if (error instanceof InvitationError) return betaJson(409, { error: error.message });
      throw error;
    }
  }, { admin: true });
}
