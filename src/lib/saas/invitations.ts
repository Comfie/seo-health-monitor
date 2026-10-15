import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { SaasDb } from "./db";
import { activity } from "./operations-schema";
import { user } from "./auth-schema";
import { invitations } from "./tenancy-schema";

export type InvitationStatus = "pending" | "registered" | "accepted" | "expired" | "revoked";
export class InvitationError extends Error {}

const email = z.email().max(254);
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const hashInvitationToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function invitationStatus(row: { expiresAt: Date; claimedAt: Date | null; revokedAt: Date | null; consumedBy: string | null }, now = new Date()): InvitationStatus {
  if (row.consumedBy) return "accepted";
  if (row.revokedAt) return "revoked";
  if (row.claimedAt) return "registered";
  return row.expiresAt <= now ? "expired" : "pending";
}

/**
 * Administrator action. Returns the raw token exactly once; only its hash is stored.
 * Reissuing to an unregistered address rotates the token and replaces the old link.
 */
export async function createInvitation(db: SaasDb, input: { email: string; createdBy: string | null; ttlHours: number; now?: Date }) {
  const parsed = email.safeParse(normalizeEmail(input.email));
  if (!parsed.success) throw new InvitationError("Enter a valid email address.");
  const now = input.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const values = { tokenHash: hashInvitationToken(token), expiresAt: new Date(now.getTime() + input.ttlHours * 3_600_000), claimedAt: null, revokedAt: null, createdBy: input.createdBy, createdAt: now };
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(invitations).where(eq(invitations.email, parsed.data)).for("update");
    // A claim whose account creation never completed (no user row) may be reissued.
    const [registered] = await tx.select({ id: user.id }).from(user).where(eq(user.email, parsed.data)).limit(1);
    if (existing?.consumedBy || registered) throw new InvitationError("This email address has already registered.");
    const [row] = existing
      ? await tx.update(invitations).set(values).where(eq(invitations.id, existing.id)).returning()
      : await tx.insert(invitations).values({ id: randomUUID(), email: parsed.data, ...values }).returning();
    await tx.insert(activity).values({ id: randomUUID(), actorId: input.createdBy, action: existing ? "invitation.reissued" : "invitation.created", metadata: { invitationId: row.id } });
    return { invitation: row, token };
  });
}

export async function revokeInvitation(db: SaasDb, id: string, actorId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(invitations).set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, id), isNull(invitations.consumedBy), isNull(invitations.revokedAt))).returning({ id: invitations.id });
    if (!row) throw new InvitationError("Only an unused invitation can be revoked.");
    await tx.insert(activity).values({ id: randomUUID(), actorId, action: "invitation.revoked", metadata: { invitationId: id } });
  });
}

/** Admin listing: no token hashes, creator IDs or consumer IDs leave the server. */
export async function listInvitations(db: SaasDb, now = new Date()) {
  const rows = await db.select().from(invitations).orderBy(desc(invitations.createdAt)).limit(200);
  return rows.map((row) => ({ id: row.id, email: row.email, status: invitationStatus(row, now), expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString() }));
}

/**
 * Atomically marks an unexpired, unrevoked, unclaimed token for this exact email.
 * A second claim with the same token fails, so a link cannot create two accounts.
 */
export async function claimInvitation(db: SaasDb, token: string, rawEmail: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db.update(invitations).set({ claimedAt: now }).where(and(
    eq(invitations.tokenHash, hashInvitationToken(token)),
    eq(invitations.email, normalizeEmail(rawEmail)),
    gt(invitations.expiresAt, now),
    isNull(invitations.claimedAt),
    isNull(invitations.revokedAt),
    isNull(invitations.consumedBy),
  )).returning({ id: invitations.id });
  return row ?? null;
}

/** Undo a claim when account creation fails before any user was written. */
export async function releaseInvitationClaim(db: SaasDb, id: string) {
  await db.update(invitations).set({ claimedAt: null }).where(and(eq(invitations.id, id), isNull(invitations.consumedBy)));
}

/** Shown on the registration form: never reveals whether an email or token exists beyond validity. */
export async function lookupInvitationToken(db: SaasDb, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db.select({ email: invitations.email }).from(invitations).where(and(
    eq(invitations.tokenHash, hashInvitationToken(token)), gt(invitations.expiresAt, now),
    isNull(invitations.claimedAt), isNull(invitations.revokedAt), isNull(invitations.consumedBy),
  )).limit(1);
  return row ?? null;
}

export async function hasClaimedInvitation(db: SaasDb, rawEmail: string) {
  const [row] = await db.select({ id: invitations.id }).from(invitations).where(and(
    eq(invitations.email, normalizeEmail(rawEmail)), sql`${invitations.claimedAt} is not null`,
    isNull(invitations.revokedAt), isNull(invitations.consumedBy),
  )).limit(1);
  return !!row;
}
