import "server-only";
import { and, desc, inArray, isNull } from "drizzle-orm";
import type { SaasDb } from "./db";
import { activity } from "./operations-schema";

/**
 * Administrator kill switch for the AI consultant. Each change is an append-only system
 * activity row (no tenant), so the latest row decides the state and the log records who
 * paused or resumed AI and when. Takes effect immediately, with no redeploy.
 */
export const AI_SWITCH_ACTIONS = ["ai.paused", "ai.resumed"] as const;

type Reader = Pick<SaasDb, "select">;

export type AiSwitchState = { paused: boolean; changedBy: string | null; changedAt: Date | null };

export async function aiSwitch(db: Reader): Promise<AiSwitchState> {
  const [latest] = await db.select({ action: activity.action, actorId: activity.actorId, createdAt: activity.createdAt }).from(activity)
    .where(and(isNull(activity.tenantId), inArray(activity.action, [...AI_SWITCH_ACTIONS])))
    .orderBy(desc(activity.createdAt)).limit(1);
  return { paused: latest?.action === "ai.paused", changedBy: latest?.actorId ?? null, changedAt: latest?.createdAt ?? null };
}
