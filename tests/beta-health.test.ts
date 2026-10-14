import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSaasAuth } from "@/lib/saas/auth";
import type { BetaConfig } from "@/lib/saas/config";
import { saasSchema, type SaasDb } from "@/lib/saas/db";
import { setBetaRuntimeForTests, type BetaRuntime } from "@/lib/saas/server";
import * as healthRoute from "@/app/api/beta/health/route";

// connection() only marks the handler as request-time; outside Next there is no request scope.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

// Readiness probe for the hosted beta (Railway health check): PostgreSQL reachable, nothing revealed.
const client = new PGlite();
const origin = "https://beta.example.com";
function runtimeFor(db: SaasDb): BetaRuntime {
  const config: BetaConfig = {
    databaseUrl: "pglite://memory", origin, authSecret: randomUUID() + randomUUID(), registration: "invite-only",
    invitationsEnabled: false, invitationTtlHours: 72, email: { transport: "log", allowlist: [] },
  };
  return { config, db, mail: async () => {}, auth: createSaasAuth({ db, origin, secret: config.authSecret, registration: "invite-only", sendMail: async () => {} }) };
}

// Start the WASM engine outside the test body; a cold start under full-suite load can exceed 5 s.
beforeAll(async () => { await client.waitReady; }, 30_000);
afterEach(() => setBetaRuntimeForTests(undefined));
afterAll(async () => { await client.close(); });

describe("GET /api/beta/health", () => {
  it("is not found while the beta is disabled", async () => {
    setBetaRuntimeForTests(null);
    const response = await healthRoute.GET();
    expect(response.status).toBe(404);
  });

  it("reports ready when PostgreSQL answers", async () => {
    setBetaRuntimeForTests(runtimeFor(drizzle(client, { schema: saasSchema }) as unknown as SaasDb));
    const response = await healthRoute.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports unavailable without details when the database fails", async () => {
    const broken = { execute: async () => { throw new Error("connect ECONNREFUSED postgresql://user:secret@db.internal/x"); } } as unknown as SaasDb;
    setBetaRuntimeForTests(runtimeFor(broken));
    const response = await healthRoute.GET();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ok: false });
    expect(text).not.toMatch(/secret|ECONNREFUSED|internal/);
  });
});
