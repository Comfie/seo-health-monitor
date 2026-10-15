import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSaasAuth } from "@/lib/saas/auth";
import { bootstrapAdministrator } from "@/lib/saas/bootstrap";
import type { BetaConfig } from "@/lib/saas/config";
import { saasSchema, type SaasDb } from "@/lib/saas/db";
import type { Mail } from "@/lib/saas/email";
import { createInvitation } from "@/lib/saas/invitations";
import { setBetaRuntimeForTests, type BetaRuntime } from "@/lib/saas/server";
import * as authRoute from "@/app/api/beta/auth/[...all]/route";
import * as registerRoute from "@/app/api/beta/register/route";
import * as websitesRoute from "@/app/api/beta/websites/route";
import * as websiteRoute from "@/app/api/beta/websites/[id]/route";
import * as invitationsRoute from "@/app/api/beta/admin/invitations/route";
import * as invitationRoute from "@/app/api/beta/admin/invitations/[id]/route";
import * as sessionRoute from "@/app/api/beta/account/sessions/[id]/route";

// Route-level tests: real route modules, real auth library, disposable PostgreSQL engine.
const client = new PGlite();
const db = drizzle(client, { schema: saasSchema }) as unknown as SaasDb;
const origin = "https://beta.example.com";
const outbox: Mail[] = [];
const password = `${randomUUID()}!Aa`;
const config: BetaConfig = {
  databaseUrl: "pglite://memory",
  origin,
  authSecret: randomUUID() + randomUUID(),
  registration: "invite-only",
  invitationsEnabled: true,
  invitationTtlHours: 72,
  email: { transport: "log", allowlist: [] }, google: { state: "unavailable", problem: "Not configured in this test.", redirectUri: "https://beta.example.com/api/beta/google/callback" },
};
const send = async (m: Mail) => { outbox.push(m); };
const runtime: BetaRuntime = {
  config,
  db,
  mail: send,
  auth: createSaasAuth({ db, origin, secret: config.authSecret, registration: "invite-only", sendMail: (m) => send({ to: m.to, url: m.url, purpose: m.purpose }) }),
};

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Options = { body?: unknown; cookie?: string; origin?: string | null; params?: Record<string, string> };

async function call(handler: Handler, method: string, path: string, options: Options = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  const requestOrigin = options.origin === undefined ? origin : options.origin;
  if (requestOrigin) headers.set("origin", requestOrigin);
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await handler(
    new Request(`${origin}${path}`, { method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const data = await response.clone().json().catch(() => null);
  return { status: response.status, data, response };
}
const auth = (method: string, path: string, options: Options = {}) => call(authRoute[method as "GET" | "POST"] as Handler, method, `/api/beta/auth/${path}`, options);
const lastMail = (to: string, purpose: Mail["purpose"]) => outbox.filter((m) => m.to === to && m.purpose === purpose).at(-1);
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
const resetLimits = () => db.delete(saasSchema.rateLimit);

async function signIn(email: string, pass = password) {
  const result = await auth("POST", "sign-in/email", { body: { email, password: pass } });
  expect(result.status).toBe(200);
  return result.response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

/** Full customer journey through HTTP routes: register, verify by emailed link, sign in. */
async function onboard(email: string, token: string) {
  const registered = await call(registerRoute.POST as Handler, "POST", "/api/beta/register", { body: { token, email, name: email.split("@")[0], password } });
  expect(registered.status).toBe(200);
  const verify = lastMail(email, "verify-email")!;
  const verified = await call(authRoute.GET as Handler, "GET", new URL(verify.url).pathname + new URL(verify.url).search);
  expect(verified.status).toBe(302);
  return signIn(email);
}

let adminCookie: string;
let aliceCookie: string;
let bobCookie: string;

beforeAll(async () => {
  await migrate(drizzle(client), { migrationsFolder: "drizzle-saas" });
  setBetaRuntimeForTests(runtime);
  // Operator bootstrap: an offline invitation for the first administrator, then the offline grant.
  const first = await createInvitation(db, { email: "operator@example.com", createdBy: null, ttlHours: 24 });
  adminCookie = await onboard("operator@example.com", first.token);
  await bootstrapAdministrator(db, "operator@example.com");
}, 30_000);
beforeEach(resetLimits);
afterAll(async () => {
  setBetaRuntimeForTests(undefined);
  await client.close();
});

describe("invitation administration", () => {
  it("lets the administrator create invitations and returns the single-use link once", async () => {
    const created = await call(invitationsRoute.POST as Handler, "POST", "/api/beta/admin/invitations", { cookie: adminCookie, body: { email: "Alice@Example.com" } });
    expect(created.status).toBe(201);
    expect(created.data.invitation).toMatchObject({ email: "alice@example.com", status: "pending" });
    expect(created.data.link).toMatch(/^https:\/\/beta\.example\.com\/beta\/register\?token=[A-Za-z0-9_-]{43}$/);
    expect(lastMail("alice@example.com", "invitation")!.url).toBe(created.data.link);
    // Only a SHA-256 hash is stored, never the token itself.
    const [row] = await db.select().from(saasSchema.invitations).where(eq(saasSchema.invitations.email, "alice@example.com"));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(tokenOf(created.data.link));
    const listing = await call(invitationsRoute.GET as Handler, "GET", "/api/beta/admin/invitations", { cookie: adminCookie });
    expect(listing.status).toBe(200);
    expect(JSON.stringify(listing.data)).not.toMatch(/tokenHash|token_hash|consumedBy|createdBy/);
    expect(listing.data.invitations.map((i: { email: string }) => i.email)).toContain("alice@example.com");
  });

  it("onboards two independent customers through the HTTP routes", async () => {
    const alice = lastMail("alice@example.com", "invitation")!;
    aliceCookie = await onboard("alice@example.com", tokenOf(alice.url));
    const bob = await call(invitationsRoute.POST as Handler, "POST", "/api/beta/admin/invitations", { cookie: adminCookie, body: { email: "bob@example.com" } });
    bobCookie = await onboard("bob@example.com", tokenOf(bob.data.link));
    const tenants = await db.select().from(saasSchema.tenants);
    expect(tenants).toHaveLength(3);
    expect(new Set(tenants.map((t) => t.personalUserId)).size).toBe(3);
  });

  it("hides the admin surface from customers and unauthenticated callers", async () => {
    expect((await call(invitationsRoute.GET as Handler, "GET", "/api/beta/admin/invitations", { cookie: aliceCookie })).status).toBe(404);
    expect((await call(invitationsRoute.POST as Handler, "POST", "/api/beta/admin/invitations", { cookie: aliceCookie, body: { email: "friend@example.com" } })).status).toBe(404);
    expect((await call(invitationsRoute.GET as Handler, "GET", "/api/beta/admin/invitations")).status).toBe(401);
    const [row] = await db.select().from(saasSchema.invitations).limit(1);
    expect((await call(invitationRoute.DELETE as Handler, "DELETE", `/api/beta/admin/invitations/${row.id}`, { cookie: bobCookie, params: { id: row.id } })).status).toBe(404);
    expect(await db.select().from(saasSchema.invitations).where(eq(saasSchema.invitations.email, "friend@example.com"))).toHaveLength(0);
  });

  it("refuses to reissue an invitation for a registered address", async () => {
    const again = await call(invitationsRoute.POST as Handler, "POST", "/api/beta/admin/invitations", { cookie: adminCookie, body: { email: "alice@example.com" } });
    expect(again.status).toBe(409);
  });

  it("honours the configuration switch that disables new invitations", async () => {
    config.invitationsEnabled = false;
    try {
      const blocked = await call(invitationsRoute.POST as Handler, "POST", "/api/beta/admin/invitations", { cookie: adminCookie, body: { email: "later@example.com" } });
      expect(blocked.status).toBe(403);
      expect(await db.select().from(saasSchema.invitations).where(eq(saasSchema.invitations.email, "later@example.com"))).toHaveLength(0);
    } finally {
      config.invitationsEnabled = true;
    }
  });

  it("revokes unused invitations, which then cannot register", async () => {
    const created = await call(invitationsRoute.POST as Handler, "POST", "/api/beta/admin/invitations", { cookie: adminCookie, body: { email: "revoked@example.com" } });
    const id = created.data.invitation.id;
    expect((await call(invitationRoute.DELETE as Handler, "DELETE", `/api/beta/admin/invitations/${id}`, { cookie: adminCookie, params: { id } })).status).toBe(200);
    const register = await call(registerRoute.POST as Handler, "POST", "/api/beta/register", { body: { token: tokenOf(created.data.link), email: "revoked@example.com", name: "R", password } });
    expect(register.status).toBe(403);
    const listing = await call(invitationsRoute.GET as Handler, "GET", "/api/beta/admin/invitations", { cookie: adminCookie });
    expect(listing.data.invitations.find((i: { id: string }) => i.id === id).status).toBe("revoked");
  });
});

describe("invitation-only registration", () => {
  async function freshInvite(email: string) {
    return (await createInvitation(db, { email, createdBy: null, ttlHours: 1 })).token;
  }
  const register = (body: Record<string, unknown>, options: Options = {}) =>
    call(registerRoute.POST as Handler, "POST", "/api/beta/register", { body, ...options });

  it("rejects unknown tokens, mismatched emails and cross-origin requests without consuming the token", async () => {
    const token = await freshInvite("carol@example.com");
    expect((await register({ token: "x".repeat(43), email: "carol@example.com", name: "C", password })).status).toBe(403);
    expect((await register({ token, email: "mallory@example.com", name: "M", password })).status).toBe(403);
    expect((await register({ token, email: "carol@example.com", name: "C", password }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await register({ token, email: "carol@example.com", name: "C", password }, { origin: null })).status).toBe(403);
    expect((await register({ token, email: "carol@example.com", name: "C", password: "short" })).status).toBe(400);
    // Still usable by the invited address after all of the above.
    expect((await register({ token, email: "carol@example.com", name: "C", password })).status).toBe(200);
  });

  it("is single-use: the same link cannot create a second account", async () => {
    const token = await freshInvite("dave@example.com");
    expect((await register({ token, email: "dave@example.com", name: "D", password })).status).toBe(200);
    expect((await register({ token, email: "dave@example.com", name: "D", password })).status).toBe(403);
    expect(await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "dave@example.com"))).toHaveLength(1);
  });

  it("allows one of two simultaneous registrations with the same token", async () => {
    const token = await freshInvite("erin@example.com");
    const results = await Promise.all([1, 2].map(() => register({ token, email: "erin@example.com", name: "E", password })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
  });

  it("rejects expired invitations", async () => {
    const token = await freshInvite("frank@example.com");
    await db.update(saasSchema.invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(saasSchema.invitations.email, "frank@example.com"));
    expect((await register({ token, email: "frank@example.com", name: "F", password })).status).toBe(403);
  });

  it("cannot be bypassed through the library's own sign-up endpoint", async () => {
    await freshInvite("grace@example.com");
    expect((await auth("POST", "sign-up/email", { body: { email: "grace@example.com", name: "G", password } })).status).toBe(404);
    expect((await auth("POST", "sign-up/email", { body: { email: "grace@example.com", name: "G", password }, origin: null })).status).toBe(403);
    expect(await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "grace@example.com"))).toHaveLength(0);
  });

  it("refuses all registration when configured closed", async () => {
    const token = await freshInvite("heidi@example.com");
    config.registration = "closed";
    try {
      expect((await register({ token, email: "heidi@example.com", name: "H", password })).status).toBe(403);
    } finally {
      config.registration = "invite-only";
    }
  });

  it("ignores submitted roles and verification flags", async () => {
    const token = await freshInvite("ivan@example.com");
    expect((await register({ token, email: "ivan@example.com", name: "I", password, role: "admin", emailVerified: true, tenantId: "anything" })).status).toBe(200);
    const [user] = await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "ivan@example.com"));
    expect(user.emailVerified).toBe(false);
    expect(await db.select().from(saasSchema.administrators).where(eq(saasSchema.administrators.userId, user.id))).toHaveLength(0);
  });
});

describe("email verification and tenant creation", () => {
  it("refuses sign-in before verification and resends the verification email", async () => {
    const token = (await createInvitation(db, { email: "judy@example.com", createdBy: null, ttlHours: 1 })).token;
    await call(registerRoute.POST as Handler, "POST", "/api/beta/register", { body: { token, email: "judy@example.com", name: "Judy", password } });
    const before = outbox.filter((m) => m.to === "judy@example.com" && m.purpose === "verify-email").length;
    const attempt = await auth("POST", "sign-in/email", { body: { email: "judy@example.com", password } });
    expect(attempt.status).toBe(403);
    expect(attempt.data.code).toBe("EMAIL_NOT_VERIFIED");
    expect(outbox.filter((m) => m.to === "judy@example.com" && m.purpose === "verify-email").length).toBe(before + 1);
    const [user] = await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "judy@example.com"));
    expect(await db.select().from(saasSchema.tenants).where(eq(saasSchema.tenants.personalUserId, user.id))).toHaveLength(0);
  });

  it("creates the personal tenant, membership and consumed invitation when the email is verified", async () => {
    const link = lastMail("judy@example.com", "verify-email")!.url;
    const verified = await call(authRoute.GET as Handler, "GET", new URL(link).pathname + new URL(link).search);
    expect(verified.status).toBe(302);
    expect(verified.response.headers.get("location")).toContain("/beta/login?verified=1");
    const [user] = await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "judy@example.com"));
    const [tenant] = await db.select().from(saasSchema.tenants).where(eq(saasSchema.tenants.personalUserId, user.id));
    expect(tenant).toBeDefined();
    expect(await db.select().from(saasSchema.memberships).where(eq(saasSchema.memberships.tenantId, tenant.id))).toEqual([{ tenantId: tenant.id, userId: user.id, role: "owner" }]);
    const [invite] = await db.select().from(saasSchema.invitations).where(eq(saasSchema.invitations.email, "judy@example.com"));
    expect(invite.consumedBy).toBe(user.id);
    // Replaying the verification link does not create a second tenant.
    await call(authRoute.GET as Handler, "GET", new URL(link).pathname + new URL(link).search);
    expect(await db.select().from(saasSchema.tenants).where(eq(saasSchema.tenants.personalUserId, user.id))).toHaveLength(1);
  });

  it("creates no tenant when the invitation is revoked between registration and verification", async () => {
    const token = (await createInvitation(db, { email: "ken@example.com", createdBy: null, ttlHours: 1 })).token;
    await call(registerRoute.POST as Handler, "POST", "/api/beta/register", { body: { token, email: "ken@example.com", name: "Ken", password } });
    await db.update(saasSchema.invitations).set({ revokedAt: new Date() }).where(eq(saasSchema.invitations.email, "ken@example.com"));
    const link = lastMail("ken@example.com", "verify-email")!.url;
    await call(authRoute.GET as Handler, "GET", new URL(link).pathname + new URL(link).search);
    const cookie = await signIn("ken@example.com");
    expect((await call(websitesRoute.GET as Handler, "GET", "/api/beta/websites", { cookie })).status).toBe(401);
    const [user] = await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "ken@example.com"));
    expect(await db.select().from(saasSchema.tenants).where(eq(saasSchema.tenants.personalUserId, user.id))).toHaveLength(0);
  });
});

describe("tenant-isolated website management", () => {
  let aliceSite: number;
  const websites = (method: "GET" | "POST", options: Options) => call(websitesRoute[method] as Handler, method, "/api/beta/websites", options);
  const website = (method: "GET" | "PATCH" | "DELETE", id: string, options: Options) =>
    call(websiteRoute[method] as Handler, method, `/api/beta/websites/${id}`, { ...options, params: { id } });

  it("requires a session", async () => {
    expect((await websites("GET", {})).status).toBe(401);
    expect((await websites("POST", { body: { url: "example.com", displayName: "X" } })).status).toBe(401);
    expect((await websites("GET", { cookie: "shm_session=forged; shm_beta.session_token=forged" })).status).toBe(401);
  });

  it("lets two customers add the same public website as separate private records", async () => {
    const a = await websites("POST", { cookie: aliceCookie, body: { url: "https://Example.com/", displayName: "Alice's site" } });
    expect(a.status).toBe(201);
    expect(a.data.website).toMatchObject({ host: "example.com", displayName: "Alice's site" });
    expect(JSON.stringify(a.data)).not.toMatch(/tenant/i);
    aliceSite = a.data.website.id;
    const b = await websites("POST", { cookie: bobCookie, body: { url: "example.com", displayName: "Bob's site" } });
    expect(b.status).toBe(201);
    expect(b.data.website.id).not.toBe(aliceSite);
    // Re-adding is idempotent within one account.
    const again = await websites("POST", { cookie: aliceCookie, body: { url: "www.example.com", displayName: "Dup" } });
    expect(again.status).toBe(200);
    expect(again.data.created).toBe(false);
    expect((await websites("GET", { cookie: aliceCookie })).data.websites).toHaveLength(1);
    expect((await websites("GET", { cookie: bobCookie })).data.websites.map((w: { displayName: string }) => w.displayName)).toEqual(["Bob's site"]);
  });

  it("ignores tenant identifiers supplied by the browser", async () => {
    const [bobTenant] = await db.select().from(saasSchema.tenants).innerJoin(saasSchema.user, eq(saasSchema.user.id, saasSchema.tenants.personalUserId)).where(eq(saasSchema.user.email, "bob@example.com"));
    const r = await websites("POST", { cookie: aliceCookie, body: { url: "iana.org", displayName: "IANA", tenantId: bobTenant.tenants.id } });
    expect(r.status).toBe(201);
    const [row] = await db.select().from(saasSchema.sites).where(eq(saasSchema.sites.id, r.data.website.id));
    expect(row.tenantId).not.toBe(bobTenant.tenants.id);
    expect((await websites("GET", { cookie: bobCookie })).data.websites).toHaveLength(1);
  });

  it("denies another customer's website through direct API calls and manipulated IDs", async () => {
    const id = String(aliceSite);
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const r = await website(method, id, { cookie: bobCookie, body: method === "PATCH" ? { displayName: "Stolen" } : undefined });
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.data)).not.toContain("Alice");
    }
    for (const bad of ["1 OR 1=1", "-1", "0", "1e3", "abc", "99999999999", `${id}/../1`]) {
      expect((await website("GET", bad, { cookie: bobCookie })).status).toBe(404);
    }
    const [row] = await db.select().from(saasSchema.sites).where(eq(saasSchema.sites.id, aliceSite));
    expect(row.displayName).toBe("Alice's site");
  });

  it("blocks cross-origin and origin-less mutations even with a valid session", async () => {
    expect((await websites("POST", { cookie: aliceCookie, origin: "https://evil.example", body: { url: "evil.example", displayName: "E" } })).status).toBe(403);
    expect((await website("DELETE", String(aliceSite), { cookie: aliceCookie, origin: null })).status).toBe(403);
    expect((await website("PATCH", String(aliceSite), { cookie: aliceCookie, origin: `${origin}.evil.example`, body: { displayName: "E" } })).status).toBe(403);
  });

  it("applies URL validation and SSRF protections", async () => {
    for (const url of ["javascript:alert(1)", "ftp://example.com", "http://127.0.0.1", "http://169.254.169.254/latest", "http://[::1]/", "https://user:pass@example.com", "localhost"]) {
      const r = await websites("POST", { cookie: bobCookie, body: { url, displayName: "Bad" } });
      expect(r.status, url).toBe(400);
    }
    expect((await websites("POST", { cookie: bobCookie, body: { url: "example.net", displayName: "\u0000\u0007" } })).status).toBe(400);
  });

  it("enforces the per-account website limit", async () => {
    const r = await websites("POST", { cookie: aliceCookie, body: { url: "example.org", displayName: "Third" } });
    expect(r.status).toBe(409);
  });

  it("lets the owner rename and remove their own website", async () => {
    const renamed = await website("PATCH", String(aliceSite), { cookie: aliceCookie, body: { displayName: "  Renamed  " } });
    expect(renamed.status).toBe(200);
    expect(renamed.data.website.displayName).toBe("Renamed");
    expect((await website("DELETE", String(aliceSite), { cookie: aliceCookie })).status).toBe(200);
    expect((await website("GET", String(aliceSite), { cookie: aliceCookie })).status).toBe(404);
    const actions = await db.select({ action: saasSchema.activity.action }).from(saasSchema.activity);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["website.added", "website.renamed", "website.removed"]));
  });
});

describe("sessions, account settings and recovery", () => {
  it("does not expose session tokens or unsupported library endpoints over HTTP", async () => {
    for (const path of ["get-session", "list-sessions"]) expect((await auth("GET", path, { cookie: aliceCookie })).status).toBe(404);
    for (const path of ["revoke-session", "delete-user", "change-email", "sign-in/social", "sign-up/email"]) {
      expect((await auth("POST", path, { cookie: aliceCookie, body: {} })).status, path).toBe(404);
    }
  });

  it("updates the profile name but never the email or verification state", async () => {
    expect((await auth("POST", "update-user", { cookie: aliceCookie, body: { name: "Alice A", email: "evil@example.com" } })).status).toBe(400);
    expect((await auth("POST", "update-user", { cookie: aliceCookie, body: { name: "Alice A", emailVerified: false } })).status).toBe(200);
    const [user] = await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "alice@example.com"));
    expect(user).toMatchObject({ name: "Alice A", emailVerified: true });
    expect((await auth("POST", "update-user", { body: { name: "Anonymous" } })).status).toBe(401);
  });

  it("lets a customer revoke only their own sessions", async () => {
    const second = await signIn("alice@example.com");
    const [alice] = await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "alice@example.com"));
    const sessions = await db.select().from(saasSchema.session).where(eq(saasSchema.session.userId, alice.id));
    const target = sessions.find((s) => second.includes(s.token))!;
    expect(target).toBeDefined();
    const del = (cookie: string) => call(sessionRoute.DELETE as Handler, "DELETE", `/api/beta/account/sessions/${target.id}`, { cookie, params: { id: target.id } });
    expect((await del(bobCookie)).status).toBe(404);
    expect((await call(websitesRoute.GET as Handler, "GET", "/api/beta/websites", { cookie: second })).status).toBe(200);
    expect((await del(aliceCookie)).status).toBe(200);
    expect((await call(websitesRoute.GET as Handler, "GET", "/api/beta/websites", { cookie: second })).status).toBe(401);
  });

  it("invalidates the session on sign-out", async () => {
    const cookie = await signIn("bob@example.com");
    expect((await auth("POST", "sign-out", { cookie, body: {} })).status).toBe(200);
    expect((await call(websitesRoute.GET as Handler, "GET", "/api/beta/websites", { cookie })).status).toBe(401);
  });

  it("rejects cross-origin sign-in and throttles repeated failures", async () => {
    expect((await auth("POST", "sign-in/email", { body: { email: "alice@example.com", password }, origin: "https://evil.example" })).status).toBe(403);
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await auth("POST", "sign-in/email", { body: { email: "alice@example.com", password: "wrong-password-123" } })).status;
    expect(last).toBe(429);
  });

  it("recovers a password with a single-use emailed token and revokes existing sessions", async () => {
    const before = await signIn("bob@example.com");
    const known = await auth("POST", "request-password-reset", { body: { email: "bob@example.com", redirectTo: `${origin}/beta/reset-password` } });
    const unknown = await auth("POST", "request-password-reset", { body: { email: "nobody@example.com", redirectTo: `${origin}/beta/reset-password` } });
    expect(known.status).toBe(unknown.status);
    expect(known.data).toEqual(unknown.data);
    const link = lastMail("bob@example.com", "reset-password")!.url;
    const callback = await call(authRoute.GET as Handler, "GET", new URL(link).pathname + new URL(link).search);
    expect(callback.status).toBe(302);
    const token = new URL(callback.response.headers.get("location")!, origin).searchParams.get("token")!;
    const next = `${randomUUID()}!Bb`;
    expect((await auth("POST", "reset-password", { body: { token, newPassword: next } })).status).toBe(200);
    expect((await call(websitesRoute.GET as Handler, "GET", "/api/beta/websites", { cookie: before })).status).toBe(401);
    expect((await auth("POST", "reset-password", { body: { token, newPassword: `${randomUUID()}!Cc` } })).status).toBe(400);
    expect((await auth("POST", "sign-in/email", { body: { email: "bob@example.com", password } })).status).toBe(401);
    bobCookie = await signIn("bob@example.com", next);
  });

  it("changes the password only with the current password and signs out other sessions", async () => {
    const other = await signIn("alice@example.com");
    const wrong = await auth("POST", "change-password", { cookie: aliceCookie, body: { currentPassword: "not-the-password-1", newPassword: `${randomUUID()}!Dd`, revokeOtherSessions: true } });
    expect(wrong.status).toBe(400);
    const next = `${randomUUID()}!Ee`;
    const changed = await auth("POST", "change-password", { cookie: aliceCookie, body: { currentPassword: password, newPassword: next, revokeOtherSessions: true } });
    expect(changed.status).toBe(200);
    expect((await call(websitesRoute.GET as Handler, "GET", "/api/beta/websites", { cookie: other })).status).toBe(401);
  });

  it("denies suspended accounts on every route", async () => {
    const [bob] = await db.select().from(saasSchema.user).where(eq(saasSchema.user.email, "bob@example.com"));
    await db.update(saasSchema.tenants).set({ status: "suspended" }).where(eq(saasSchema.tenants.personalUserId, bob.id));
    expect((await call(websitesRoute.GET as Handler, "GET", "/api/beta/websites", { cookie: bobCookie })).status).toBe(401);
    await db.update(saasSchema.tenants).set({ status: "active" }).where(eq(saasSchema.tenants.personalUserId, bob.id));
  });
});

describe("feature gate", () => {
  it("returns 404 from every beta route when the beta is disabled", async () => {
    setBetaRuntimeForTests(null);
    try {
      expect((await call(websitesRoute.GET as Handler, "GET", "/api/beta/websites", { cookie: aliceCookie })).status).toBe(404);
      expect((await call(registerRoute.POST as Handler, "POST", "/api/beta/register", { body: {} })).status).toBe(404);
      expect((await auth("POST", "sign-in/email", { body: { email: "alice@example.com", password } })).status).toBe(404);
    } finally {
      setBetaRuntimeForTests(runtime);
    }
  });
});
