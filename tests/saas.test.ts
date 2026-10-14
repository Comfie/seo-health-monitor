import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSaasAuth, type AuthMail } from "@/lib/saas/auth";
import { saasSchema } from "@/lib/saas/db";
import { requireTenant, type TenantContext } from "@/lib/saas/tenant";
import { tenantRepository } from "@/lib/saas/repository";
import { createInvitation } from "@/lib/saas/invitations";
import { registerWithInvitation } from "@/lib/saas/registration";

const client = new PGlite();
const db = drizzle(client, { schema: saasSchema });
const mail: AuthMail[] = [];
const origin = "https://beta.example.com";
const auth = createSaasAuth({ db, origin, secret: randomUUID() + randomUUID(), registration: "invite-only", sendMail: async (message) => { mail.push(message); } });
const password = randomUUID() + "!";

async function request(path: string, body?: unknown, cookie?: string, requestOrigin = origin) {
  return auth.handler(new Request(`${origin}/api/beta/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: requestOrigin, ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
async function invite(email: string) {
  return (await createInvitation(db, { email, createdBy: null, ttlHours: 24 })).token;
}
async function register(email: string) {
  const token = await invite(email);
  expect(await registerWithInvitation(db, auth, { token, email, name: email.split("@")[0], password }, new Headers(), "/beta/login")).toEqual({ ok: true });
  const message = mail.find((m) => m.to === email && m.purpose === "verify-email")!;
  expect(message).toBeDefined();
  const verified = await auth.handler(new Request(message.url));
  expect([200, 302]).toContain(verified.status);
  return login(email);
}
async function login(email: string) {
  const response = await request("sign-in/email", { email, password });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  expect(cookie).toContain("shm_beta");
  return { cookie, headers: new Headers({ cookie }), response };
}

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle-saas" }); }, 30_000);
afterAll(async () => { await client.close(); });

describe("isolated PostgreSQL beta foundation", () => {
  let a: Awaited<ReturnType<typeof register>>;
  let b: Awaited<ReturnType<typeof register>>;
  let admin: Awaited<ReturnType<typeof register>>;
  let contextA: TenantContext;
  let contextB: TenantContext;
  let siteA: number;
  let auditA: number;

  it("defaults registration to closed and rejects uninvited signups", async () => {
    const closed = createSaasAuth({ db, origin, secret: randomUUID() + randomUUID(), sendMail: async () => {} });
    const response = await closed.handler(new Request(`${origin}/api/beta/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email: "closed@example.com", name: "Closed", password }) }));
    expect(response.ok).toBe(false);
    // The library sign-up endpoint is not reachable over HTTP at all.
    expect((await request("sign-up/email", { email: "uninvited@example.com", name: "Uninvited", password })).status).toBe(404);
    // Server-side calls without a claimed invitation are refused by the hook.
    await expect(auth.api.signUpEmail({ body: { email: "uninvited@example.com", name: "Uninvited", password } })).rejects.toThrow("Registration is unavailable");
  });

  it("requires email verification and does not trust submitted roles", async () => {
    const token = await invite("verify@example.com");
    expect(await registerWithInvitation(db, auth, { token, email: "verify@example.com", name: "Verify", password, role: "admin", emailVerified: true }, new Headers(), "/beta/login")).toEqual({ ok: true });
    expect((await request("sign-in/email", { email: "verify@example.com", password })).ok).toBe(false);
    const [user] = await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "verify@example.com"));
    expect(user.emailVerified).toBe(false);
    expect(await db.select().from(saasSchema.administrators)).toHaveLength(0);
    const [credential] = await db.select().from(saasSchema.account).where(eq(saasSchema.account.userId, user.id));
    expect(credential.password).not.toBe(password);
    expect(credential.password!.length).toBeGreaterThan(100);
  });

  it("creates independent verified customers and a separately granted administrator", async () => {
    // Clear shared test limiter between scenarios; production keeps durable counters.
    await db.delete(saasSchema.rateLimit);
    a = await register("alice@example.com");
    b = await register("bob@example.com");
    admin = await register("operator@example.com");
    contextA = await requireTenant(db, auth, a.headers);
    contextB = await requireTenant(db, auth, b.headers);
    const contextAdmin = await requireTenant(db, auth, admin.headers);
    await db.insert(saasSchema.administrators).values({ userId: contextAdmin.userId });
    expect(contextA.tenantId).not.toBe(contextB.tenantId);
    expect(await db.select().from(saasSchema.administrators)).toHaveLength(1);
    expect(a.response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(a.response.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(a.response.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
  });

  it("keeps duplicate public domains and private audit history separate", async () => {
    const repoA = tenantRepository(db, contextA);
    const repoB = tenantRepository(db, contextB);
    siteA = (await repoA.addWebsite("https://example.com", "Alice's reference site")).id;
    const siteB = await repoB.addWebsite("https://example.com", "Bob's reference site");
    expect(siteB.id).not.toBe(siteA);
    expect(await repoA.listWebsites()).toHaveLength(1);
    expect((await repoB.listWebsites())[0].displayName).toBe("Bob's reference site");
    auditA = (await repoA.enqueueAudit(siteA)).id;
    expect(await repoB.listAudits()).toHaveLength(0);
    await expect(repoB.getAudit(auditA)).rejects.toThrow("Resource unavailable");
    await expect(repoB.exportAudit(auditA)).rejects.toThrow("Resource unavailable");
    await expect(repoB.renameWebsite(siteA, "Stolen")).rejects.toThrow("Resource unavailable");
    await expect(repoB.removeWebsite(siteA)).rejects.toThrow("Resource unavailable");
    await expect(repoB.enqueueAudit(siteA)).rejects.toThrow("Resource unavailable");
    await expect(repoB.searchConsoleSnapshots(siteA)).rejects.toThrow("Resource unavailable");
    expect((await repoA.exportAudit(auditA)).audit.id).toBe(auditA);
  });

  it("rejects cross-tenant relationships at database level", async () => {
    await expect(db.insert(saasSchema.pages).values({ tenantId: contextB.tenantId, auditId: auditA, url: "https://example.com", finalUrl: "https://example.com", depth: 0, source: "crawl", data: {} })).rejects.toThrow();
    await expect(db.insert(saasSchema.audits).values({ tenantId: contextB.tenantId, siteId: siteA, inputUrl: "https://example.com", startUrl: "https://example.com", status: "queued" })).rejects.toThrow();
  });

  it("serializes simultaneous audit submissions without exceeding account concurrency", async () => {
    const repo = tenantRepository(db, contextB);
    const [site] = await repo.listWebsites();
    const attempts = await Promise.allSettled([repo.enqueueAudit(site.id), repo.enqueueAudit(site.id)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("enforces per-account website, active-audit and monthly quotas", async () => {
    const repo = tenantRepository(db, contextA);
    await repo.addWebsite("https://www.iana.org", "IANA");
    await expect(repo.addWebsite("https://example.org", "Third")).rejects.toThrow("Website limit");
    await expect(repo.enqueueAudit(siteA)).rejects.toThrow("already active");
    await db.update(saasSchema.audits).set({ status: "completed" }).where(eq(saasSchema.audits.id, auditA));
    // Since Stage 3 the job queue is authoritative for "active"; finish the job too.
    await db.update(saasSchema.jobs).set({ state: "completed" }).where(eq(saasSchema.jobs.auditId, auditA));
    await db.update(saasSchema.tenants).set({ monthlyAuditLimit: 1 }).where(eq(saasSchema.tenants.id, contextA.tenantId));
    await expect(repo.enqueueAudit(siteA)).rejects.toThrow("Monthly audit limit");
    await repo.removeWebsite(siteA);
    expect(await db.select().from(saasSchema.usageRecords).where(eq(saasSchema.usageRecords.tenantId, contextA.tenantId))).toHaveLength(1);
  });

  it("rechecks suspension and rejects forged tenant contexts", async () => {
    await db.update(saasSchema.tenants).set({ status: "suspended" }).where(eq(saasSchema.tenants.id, contextB.tenantId));
    await expect(tenantRepository(db, contextB).listWebsites()).rejects.toThrow("Resource unavailable");
    await expect(requireTenant(db, auth, b.headers)).rejects.toThrow("Resource unavailable");
    await expect(tenantRepository(db, { userId: contextA.userId, tenantId: contextA.tenantId } as TenantContext).listWebsites()).rejects.toThrow("Resource unavailable");
  });

  it("blocks cross-origin authentication and throttles repeated login attempts", async () => {
    await db.delete(saasSchema.rateLimit);
    expect((await request("sign-in/email", { email: "alice@example.com", password }, undefined, "https://evil.example")).status).toBe(403);
    let last: Response | undefined;
    for (let i = 0; i < 7; i++) last = await request("sign-in/email", { email: "absent@example.com", password });
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).toBeTruthy();
  });

  it("revokes sessions on logout and enforces persisted expiry", async () => {
    await db.delete(saasSchema.rateLimit);
    const fresh = await login("alice@example.com");
    expect((await request("sign-out", {}, fresh.cookie)).ok).toBe(true);
    expect(await auth.api.getSession({ headers: fresh.headers })).toBeNull();
    await db.update(saasSchema.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(saasSchema.session.userId, contextA.userId));
    expect(await auth.api.getSession({ headers: a.headers })).toBeNull();
  });

  it("recovers passwords with single-use tokens and revokes old sessions", async () => {
    await db.delete(saasSchema.rateLimit);
    const before = await login("operator@example.com");
    const existing = await request("request-password-reset", { email: "operator@example.com", redirectTo: `${origin}/beta/reset-password` });
    const absent = await request("request-password-reset", { email: "missing@example.com", redirectTo: `${origin}/beta/reset-password` });
    expect(existing.status).toBe(absent.status);
    expect(await existing.json()).toEqual(await absent.json());
    const message = mail.find((m) => m.to === "operator@example.com" && m.purpose === "reset-password")!;
    const token = new URL(message.url).pathname.split("/").at(-1)!;
    const nextPassword = randomUUID() + "!";
    expect((await request("reset-password", { token, newPassword: nextPassword })).ok).toBe(true);
    expect(await auth.api.getSession({ headers: before.headers })).toBeNull();
    expect((await request("reset-password", { token, newPassword: randomUUID() })).ok).toBe(false);
  });
});
