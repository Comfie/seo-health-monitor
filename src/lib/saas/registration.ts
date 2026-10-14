import "server-only";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { user } from "./auth-schema";
import type { SaasAuth } from "./auth";
import type { SaasDb } from "./db";
import { claimInvitation, normalizeEmail, releaseInvitationClaim } from "./invitations";

export const registrationInput = z.object({
  token: z.string().min(1).max(200),
  email: z.email().max(254),
  name: z.string().trim().min(1, "Enter your name.").max(80),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});

export type RegistrationResult = { ok: true } | { ok: false; status: number; error: string };

// One response for unknown, expired, revoked, used or mismatched invitations.
const INVALID = { ok: false, status: 403, error: "This invitation is invalid, expired or has already been used." } as const;

/**
 * Claims the invitation, then asks the library to create the unverified user and send
 * the verification email. Role/verification fields in the request are never forwarded.
 */
export async function registerWithInvitation(db: SaasDb, auth: SaasAuth, body: unknown, headers: Headers, callbackURL: string): Promise<RegistrationResult> {
  const parsed = registrationInput.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { token, name, password } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const claim = await claimInvitation(db, token, email);
  if (!claim) return INVALID;
  try {
    await auth.api.signUpEmail({ body: { email, name, password, callbackURL }, headers });
    return { ok: true };
  } catch (error) {
    // Keep the claim if the user row exists (e.g. email delivery failed after creation):
    // signing in later resends verification, and the link must stay single-use.
    const [created] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (!created) await releaseInvitationClaim(db, claim.id);
    if (error instanceof APIError && error.status === "BAD_REQUEST") return { ok: false, status: 400, error: error.message || "Check the form and try again." };
    if (error instanceof APIError && error.status === "UNPROCESSABLE_ENTITY") return INVALID;
    throw error;
  }
}
