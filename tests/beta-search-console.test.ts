import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaasAuth } from "@/lib/saas/auth";
import { readGoogleConfig, type BetaConfig, type GoogleConfig } from "@/lib/saas/config";
import { saasSchema, type SaasDb } from "@/lib/saas/db";
import type { Mail } from "@/lib/saas/email";
import { createInvitation } from "@/lib/saas/invitations";
import { readLimitSettings } from "@/lib/saas/limits";
import { claimJob } from "@/lib/saas/jobs";
import { claimRefresh, completeRefresh, recoverExpiredRefreshes } from "@/lib/saas/gsc-jobs";
import { executeJob } from "@/lib/saas/audit-runner";
import { clearSearchConsoleTokenCache, runRefreshJob } from "@/lib/saas/search-console";
import { createWorker } from "@/lib/saas/worker";
import { setBetaRuntimeForTests, type BetaRuntime } from "@/lib/saas/server";
import type { CrawlOptions } from "@/lib/crawler/crawl";
import type { PerformanceResult } from "@/lib/audit/types";
import * as authRoute from "@/app/api/beta/auth/[...all]/route";
import * as registerRoute from "@/app/api/beta/register/route";
import * as websitesRoute from "@/app/api/beta/websites/route";
import * as auditsRoute from "@/app/api/beta/audits/route";
import * as exportRoute from "@/app/api/beta/audits/[id]/export/route";
import * as fixRoute from "@/app/api/beta/audits/[id]/fix/route";
import * as findingsRoute from "@/app/api/beta/audits/[id]/findings/route";
import * as googleRoute from "@/app/api/beta/google/route";
import * as connectRoute from "@/app/api/beta/google/connect/route";
import * as callbackRoute from "@/app/api/beta/google/callback/route";
import * as propertiesRoute from "@/app/api/beta/google/properties/route";
import * as disconnectRoute from "@/app/api/beta/google/disconnect/route";
import * as siteGscRoute from "@/app/api/beta/websites/[id]/search-console/route";
import * as refreshRoute from "@/app/api/beta/websites/[id]/search-console/refresh/route";
import { context as crawlContext, htmlPage, page } from "./helpers";

// Tenant-aware Search Console: real routes, real auth library, PGlite, and a fake Google that
// enforces client credentials, PKCE, single-use codes, per-user property access and per-user
// grant revocation. Customers Alice and Bob use different Google accounts; Carol authorises
// the same Google account as Bob (a shared grant).
const client = new PGlite();
const db = drizzle(client, { schema: saasSchema }) as unknown as SaasDb;
const origin = "https://beta.example.com";
const outbox: Mail[] = [];
const password = `${randomUUID()}!Aa`;
const google: Extract<GoogleConfig, { state: "ready" }> = {
  state: "ready", clientId: "beta-client-id", clientSecret: "beta-client-secret", tokenSecret: `tok-${randomUUID()}${randomUUID()}`,
  redirectUri: `${origin}/api/beta/google/callback`, maxInspections: 10,
};
const config: BetaConfig = {
  databaseUrl: "pglite://memory", origin, authSecret: randomUUID() + randomUUID(), registration: "invite-only",
  invitationsEnabled: true, invitationTtlHours: 72, email: { transport: "log", allowlist: [] }, google,
};
const send = async (m: Mail) => { outbox.push(m); };
const limits = (() => { const s = readLimitSettings({}); return { tenant: { ...s.tenant, auditsPerMonth: 50 }, global: { ...s.global, maxRunning: 5, pagespeedPagesPerAudit: 0 } }; })();
const runtime: BetaRuntime = {
  config, db, mail: send, limits,
  auth: createSaasAuth({ db, origin, secret: config.authSecret, registration: "invite-only", sendMail: (m) => send({ to: m.to, url: m.url, purpose: m.purpose }) }),
};

// ---------------------------------------------------------------------------------------------
// Fake Google

const READONLY = "https://www.googleapis.com/auth/webmasters.readonly";
const FULL_SCOPE = `openid ${READONLY} https://www.googleapis.com/auth/userinfo.email`;
type GUser = { sub: string; email: string; clicks: number; properties: { siteUrl: string; permissionLevel: string }[] };
const USERS: Record<string, GUser> = {
  ga: { sub: "100001", email: "owner-a@gmail.test", clicks: 120, properties: [
    { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
    { siteUrl: "https://unrelated.test/", permissionLevel: "siteOwner" },
    { siteUrl: "https://pending.example.com/", permissionLevel: "siteUnverifiedUser" },
  ] },
  gb: { sub: "200002", email: "owner-b@gmail.test", clicks: 7, properties: [
    { siteUrl: "https://www.example.com/", permissionLevel: "siteFullUser" },
    { siteUrl: "sc-domain:b-only.test", permissionLevel: "siteOwner" },
  ] },
};
const fake = {
  n: 0,
  codes: new Map<string, { user: string; challenge: string; redirectUri: string; scope: string; used: boolean; refresh: boolean }>(),
  refresh: new Map<string, { user: string; revoked: boolean }>(),
  access: new Map<string, string>(),
  calls: [] as { kind: string; user?: string; property?: string }[],
  exchanges: 0,
  revocations: 0,
  quota: { analytics: false, inspection: false },
  issued: [] as string[],
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;

function revokeUser(user: string) {
  for (const rec of fake.refresh.values()) if (rec.user === user) rec.revoked = true;
  for (const [token, owner] of fake.access) if (owner === user) fake.access.delete(token);
}

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const bearer = new Headers(init.headers).get("authorization")?.replace(/^Bearer /, "");
  const user = bearer ? fake.access.get(bearer) : undefined;
  if (url.href === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("client_id") !== google.clientId || p.get("client_secret") !== google.clientSecret) return reply(401, { error: "invalid_client" });
    const issue = (u: string, scope: string, withRefresh: boolean) => {
      const n = ++fake.n;
      const access = `at-secret-${u}-${n}`;
      fake.access.set(access, u);
      fake.issued.push(access);
      const body: Record<string, unknown> = { access_token: access, expires_in: 3600, scope, id_token: `${b64({ alg: "none" })}.${b64({ sub: USERS[u].sub, email: USERS[u].email })}.sig` };
      if (withRefresh) {
        const refresh = `rt-secret-${u}-${n}`;
        fake.refresh.set(refresh, { user: u, revoked: false });
        fake.issued.push(refresh);
        body.refresh_token = refresh;
      }
      return reply(200, body);
    };
    if (p.get("grant_type") === "authorization_code") {
      const rec = fake.codes.get(p.get("code") ?? "");
      if (!rec || rec.used) return reply(400, { error: "invalid_grant" });
      rec.used = true;
      fake.exchanges++;
      if (createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") !== rec.challenge) return reply(400, { error: "invalid_grant" });
      if (p.get("redirect_uri") !== rec.redirectUri) return reply(400, { error: "redirect_uri_mismatch" });
      return issue(rec.user, rec.scope, rec.refresh);
    }
    const rec = fake.refresh.get(p.get("refresh_token") ?? "");
    if (!rec || rec.revoked) return reply(400, { error: "invalid_grant" });
    const n = ++fake.n;
    const access = `at-secret-${rec.user}-${n}`;
    fake.access.set(access, rec.user);
    fake.issued.push(access);
    return reply(200, { access_token: access, expires_in: 3600, scope: FULL_SCOPE });
  }
  if (url.href === "https://oauth2.googleapis.com/revoke") {
    fake.revocations++;
    const token = new URLSearchParams(String(init.body)).get("token") ?? "";
    const rec = fake.refresh.get(token);
    if (!rec) return reply(400, { error: "invalid_token" });
    revokeUser(rec.user); // Google revokes the whole grant for this user and client
    return reply(200, {});
  }
  if (url.hostname === "www.googleapis.com" || url.hostname === "searchconsole.googleapis.com") {
    if (!user) return reply(401, { error: { status: "UNAUTHENTICATED" } });
    const props = USERS[user].properties.filter((p) => p.permissionLevel !== "siteUnverifiedUser").map((p) => p.siteUrl);
    if (url.pathname === "/webmasters/v3/sites") {
      fake.calls.push({ kind: "sites", user });
      return reply(200, { siteEntry: USERS[user].properties });
    }
    const body = JSON.parse(String(init.body ?? "{}"));
    if (url.pathname.endsWith("/searchAnalytics/query")) {
      const property = decodeURIComponent(url.pathname.split("/sites/")[1].replace("/searchAnalytics/query", ""));
      fake.calls.push({ kind: "analytics", user, property });
      if (!props.includes(property)) return reply(403, { error: { status: "PERMISSION_DENIED" } });
      if (fake.quota.analytics) return reply(429, { error: { status: "RESOURCE_EXHAUSTED" } });
      const c = USERS[user].clicks;
      const dims: string[] = body.dimensions ?? [];
      if (!dims.length) return reply(200, { rows: [{ clicks: c, impressions: c * 10, ctr: 0.1, position: 4.2 }] });
      if (dims[0] === "date") return reply(200, { rows: [{ keys: [body.endDate], clicks: c, impressions: c * 10, ctr: 0.1, position: 4.2 }] });
      if (dims[0] === "query") return reply(200, { rows: [{ keys: [`${user}-private-query`], clicks: c, impressions: c * 10, ctr: 0.1, position: 3 }] });
      return reply(200, { rows: [{ keys: ["https://example.com/"], clicks: c, impressions: c * 10, ctr: 0.1, position: 3 }] });
    }
    if (url.pathname.endsWith("index:inspect")) {
      fake.calls.push({ kind: "inspect", user, property: body.siteUrl });
      if (!props.includes(body.siteUrl)) return reply(403, { error: { status: "PERMISSION_DENIED" } });
      if (fake.quota.inspection) return reply(429, { error: { status: "RESOURCE_EXHAUSTED" } });
      const notIndexed = String(body.inspectionUrl).endsWith("/p1");
      return reply(200, { inspectionResult: { indexStatusResult: notIndexed
        ? { verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", lastCrawlTime: "2026-10-01T00:00:00Z" }
        : { verdict: "PASS", coverageState: "Submitted and indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED", lastCrawlTime: "2026-10-02T00:00:00Z" } } });
    }
  }
  return realFetch(input, init);
}

/** Simulates the user approving Google's consent screen for the URL the app redirected to. */
function consent(authUrl: string, user: string, options: { scope?: string; refresh?: boolean } = {}) {
  const u = new URL(authUrl);
  const code = `code-${++fake.n}`;
  fake.codes.set(code, { user, challenge: u.searchParams.get("code_challenge")!, redirectUri: u.searchParams.get("redirect_uri")!, scope: options.scope ?? FULL_SCOPE, used: false, refresh: options.refresh ?? true });
  return { code, state: u.searchParams.get("state")! };
}

// ---------------------------------------------------------------------------------------------
// Route helpers (same shape as the other beta route suites)

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Options = { body?: unknown; cookie?: string; origin?: string | null; params?: Record<string, string> };
const responses: string[] = [];
async function call(handler: unknown, method: string, path: string, options: Options = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  const requestOrigin = options.origin === undefined ? origin : options.origin;
  if (requestOrigin) headers.set("origin", requestOrigin);
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await (handler as Handler)(new Request(`${origin}${path}`, { method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }), { params: Promise.resolve(options.params ?? {}) });
  const text = await response.clone().text();
  responses.push(text, response.headers.get("location") ?? "", ...response.headers.getSetCookie());
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, data: data as Record<string, any>, text, response }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const get = (h: unknown, path: string, cookie?: string, params: Record<string, string> = {}) => call(h, "GET", path, { cookie, params });
const post = (h: unknown, path: string, cookie?: string, params: Record<string, string> = {}, body: unknown = {}) => call(h, "POST", path, { cookie, params, body });
const del = (h: unknown, path: string, cookie?: string, params: Record<string, string> = {}) => call(h, "DELETE", path, { cookie, params });
const idParams = (id: number | string) => ({ id: String(id) });

async function signIn(email: string) {
  const r = await call(authRoute.POST, "POST", "/api/beta/auth/sign-in/email", { body: { email, password } });
  expect(r.status).toBe(200);
  return r.response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
async function onboard(email: string) {
  const { token } = await createInvitation(db, { email, createdBy: null, ttlHours: 24 });
  expect((await call(registerRoute.POST, "POST", "/api/beta/register", { body: { token, email, name: email.split("@")[0], password } })).status).toBe(200);
  const verify = outbox.filter((m) => m.to === email && m.purpose === "verify-email").at(-1)!;
  const url = new URL(verify.url);
  expect((await call(authRoute.GET, "GET", url.pathname + url.search)).status).toBe(302);
  return signIn(email);
}

/** Starts authorisation as `cookie`; returns Google's URL and the browser-binding cookie. */
async function startConnect(cookie: string) {
  const r = await call(connectRoute.POST, "POST", "/api/beta/google/connect", { cookie });
  expect(r.status).toBe(303);
  const nonce = r.response.headers.getSetCookie().find((c) => c.startsWith("shm_beta_gsc="))!;
  return { location: r.response.headers.get("location")!, nonce: nonce.split(";")[0], setCookie: nonce };
}
async function callback(cookie: string, query: Record<string, string>) {
  const r = await get(callbackRoute.GET, `/api/beta/google/callback?${new URLSearchParams(query)}`, cookie);
  expect(r.status).toBe(303);
  return new URL(r.response.headers.get("location")!).searchParams.get("gsc");
}
async function connect(cookie: string, user: string) {
  const { location, nonce } = await startConnect(cookie);
  const { code, state } = consent(location, user);
  return callback(`${cookie}; ${nonce}`, { code, state });
}

const crawl = async (_url: string, options: CrawlOptions) => {
  const list = [htmlPage("/", page(`<h1>Home</h1><a href="/p1">p1</a><a href="/p2">p2</a>`, "<title>Home</title>"))];
  for (const p of ["/p1", "/p2"].slice(0, options.maxPages - 1)) list.push(htmlPage(p, page(`<h1>${p}</h1><p>${"text ".repeat(250)}</p>`)));
  return crawlContext(list);
};
const speed = async (url: string, strategy: "mobile" | "desktop"): Promise<PerformanceResult> => ({ url, strategy, status: "ok", performanceScore: 72, opportunities: [] });
async function runAudits() {
  for (;;) {
    const lease = await claimJob(db, "test-worker", limits);
    if (!lease) return;
    const c = new AbortController();
    await executeJob({ db, settings: limits, crawl, pagespeed: speed, pagespeedApiKey: "k", google }, lease, { signal: c.signal, abort: (r) => c.abort(r) });
  }
}
async function runRefreshes() {
  const outcomes: string[] = [];
  for (;;) {
    const lease = await claimRefresh(db, "test-worker");
    if (!lease) return outcomes;
    outcomes.push(await runRefreshJob({ db, google, timing: { leaseMs: 60_000, backoffBaseMs: 0, backoffMaxMs: 0 } }, lease));
  }
}
const start = (cookie: string, websiteId: number) => post(auditsRoute.POST, "/api/beta/audits", cookie, {}, { websiteId });
const tenantOf = async (email: string) => {
  const [row] = await db.select({ tenantId: saasSchema.memberships.tenantId }).from(saasSchema.memberships)
    .innerJoin(saasSchema.user, eq(saasSchema.user.id, saasSchema.memberships.userId)).where(eq(saasSchema.user.email, email));
  return row.tenantId;
};

let alice: string, bob: string, carol: string;
let aliceSite: number, bobSite: number, carolSite: number;
let aliceTenant: string, bobTenant: string;
const logged: string[] = [];

beforeAll(async () => {
  await client.waitReady;
  await migrate(drizzle(client), { migrationsFolder: "drizzle-saas" });
  setBetaRuntimeForTests(runtime);
  vi.stubGlobal("fetch", fakeFetch);
  for (const level of ["log", "error", "warn", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
  }
  alice = await onboard("alice@example.com");
  bob = await onboard("bob@example.com");
  carol = await onboard("carol@example.com");
  aliceTenant = await tenantOf("alice@example.com");
  bobTenant = await tenantOf("bob@example.com");
  aliceSite = (await post(websitesRoute.POST, "/api/beta/websites", alice, {}, { url: "https://example.com", displayName: "Alice" })).data.website.id;
  bobSite = (await post(websitesRoute.POST, "/api/beta/websites", bob, {}, { url: "https://example.com", displayName: "Bob" })).data.website.id;
  carolSite = (await post(websitesRoute.POST, "/api/beta/websites", carol, {}, { url: "https://example.com", displayName: "Carol" })).data.website.id;
}, 60_000);
beforeEach(() => db.delete(saasSchema.rateLimit));
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setBetaRuntimeForTests(undefined);
  await client.close();
});

describe("configuration", () => {
  const env = (extra: Record<string, string>) => ({ APP_SECRET: "a".repeat(40), ...extra }) as unknown as NodeJS.ProcessEnv;
  const full = { PHASE2_GOOGLE_CLIENT_ID: "beta", PHASE2_GOOGLE_CLIENT_SECRET: "s", PHASE2_GOOGLE_TOKEN_SECRET: "t".repeat(40) };
  it("is optional, and refuses the Phase 1 client or reused secrets without disabling the beta", () => {
    expect(readGoogleConfig(env({}), origin, "x".repeat(40)).state).toBe("unavailable");
    expect(readGoogleConfig(env(full), origin, "x".repeat(40))).toMatchObject({ state: "ready", redirectUri: `${origin}/api/beta/google/callback`, maxInspections: 10 });
    expect(readGoogleConfig(env({ ...full, GOOGLE_CLIENT_ID: "beta" }), origin, "x".repeat(40))).toMatchObject({ state: "unavailable", problem: expect.stringContaining("separate OAuth client") });
    expect(readGoogleConfig(env({ ...full, PHASE2_GOOGLE_TOKEN_SECRET: "a".repeat(40) }), origin, "x".repeat(40)).state).toBe("unavailable");
    expect(readGoogleConfig(env({ ...full, PHASE2_GOOGLE_TOKEN_SECRET: "short" }), origin, "x".repeat(40)).state).toBe("unavailable");
    expect(readGoogleConfig(env({ PHASE2_GOOGLE_CLIENT_ID: "beta" }), origin, "x".repeat(40)).state).toBe("unavailable");
  });
});

describe("before connecting", () => {
  it("marks index coverage as not verified in the customer's audit", async () => {
    await start(bob, bobSite);
    await runAudits();
    const [audit] = await db.select().from(saasSchema.audits).where(eq(saasSchema.audits.tenantId, bobTenant));
    const findings = await get(findingsRoute.GET, `/api/beta/audits/${audit.id}/findings`, bob, idParams(audit.id));
    const check = findings.data.checks.find((c: { checkId: string }) => c.checkId === "tech-index-status");
    expect(check).toMatchObject({ status: "unavailable", weight: 0 });
    expect(check.unavailableReason).toMatch(/^Not verified/);
    const exported = await get(exportRoute.GET, `/api/beta/audits/${audit.id}/export?format=json`, bob, idParams(audit.id));
    expect(exported.data.searchConsole).toMatchObject({ verified: false });
  });

  it("requires a session and the canonical origin to start authorisation", async () => {
    expect((await call(connectRoute.POST, "POST", "/api/beta/google/connect", {})).status).toBe(401);
    expect((await call(connectRoute.POST, "POST", "/api/beta/google/connect", { cookie: alice, origin: "https://evil.example" })).status).toBe(403);
    expect((await get(googleRoute.GET, "/api/beta/google")).status).toBe(401);
    expect((await get(callbackRoute.GET, "/api/beta/google/callback?code=x&state=y")).response.headers.get("location")).toBe(`${origin}/beta/login`);
  });
});

describe("OAuth connection", () => {
  it("sends the customer to Google with read-only scope, PKCE and a server-side state", async () => {
    const { location, setCookie } = await startConnect(alice);
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(`openid email ${READONLY}`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/beta/google/callback`);
    expect(url.searchParams.get("include_granted_scopes")).toBeNull();
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/api\/beta\/google/);
    expect(setCookie).toMatch(/Secure/);
    // Only a hash of the state is stored; the verifier is encrypted.
    const rows = await db.select().from(saasSchema.googleOauthStates).where(eq(saasSchema.googleOauthStates.tenantId, aliceTenant));
    const state = url.searchParams.get("state")!;
    expect(rows.some((r) => r.stateHash === createHash("sha256").update(state).digest("base64url"))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(state);
  });

  it("connects Alice's Google account to Alice's tenant only, with an encrypted refresh token", async () => {
    expect(await connect(alice, "ga")).toBe("connected");
    const accounts = await db.select().from(saasSchema.googleAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ tenantId: aliceTenant, googleSubject: USERS.ga.sub, email: USERS.ga.email, status: "active" });
    expect(accounts[0].encryptedRefreshToken).not.toMatch(/rt-secret/);
    const status = await get(googleRoute.GET, "/api/beta/google", alice);
    expect(status.data).toMatchObject({ configured: true, account: { email: USERS.ga.email, status: "active" }, links: [] });
    expect((await get(googleRoute.GET, "/api/beta/google", bob)).data.account).toBeNull();
  });

  it("refuses to reuse a callback state", async () => {
    const { location, nonce } = await startConnect(alice);
    const { code, state } = consent(location, "ga");
    expect(await callback(`${alice}; ${nonce}`, { code, state })).toBe("connected");
    const exchanges = fake.exchanges;
    expect(await callback(`${alice}; ${nonce}`, { code, state })).toBe("state_invalid");
    expect(fake.exchanges).toBe(exchanges);
  });

  it("refuses a callback completed in another customer's session (tenant swap)", async () => {
    const { location, nonce } = await startConnect(alice);
    const { code, state } = consent(location, "ga");
    // Bob replays Alice's callback, with and without her browser cookie: nothing is stored for
    // either tenant, the code is never exchanged, and the state is burnt.
    const exchanges = fake.exchanges;
    expect(await callback(`${bob}; ${nonce}`, { code, state })).toBe("session_mismatch");
    expect(fake.exchanges).toBe(exchanges);
    expect(await db.select().from(saasSchema.googleAccounts).where(eq(saasSchema.googleAccounts.tenantId, bobTenant))).toHaveLength(0);
    expect(await callback(`${alice}; ${nonce}`, { code, state })).toBe("state_invalid");
  });

  it("refuses a callback without the browser binding, or one that expired", async () => {
    let flow = await startConnect(alice);
    let grant = consent(flow.location, "ga");
    expect(await callback(alice, grant)).toBe("session_mismatch");
    flow = await startConnect(alice);
    grant = consent(flow.location, "ga");
    await db.update(saasSchema.googleOauthStates).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(saasSchema.googleOauthStates.stateHash, createHash("sha256").update(grant.state).digest("base64url")));
    expect(await callback(`${alice}; ${flow.nonce}`, grant)).toBe("state_invalid");
    expect(await callback(`${alice}; ${flow.nonce}`, { state: "forged-state", code: "x" })).toBe("state_invalid");
  });

  it("stores nothing when the read-only scope is missing, wider scope is granted or Google gives no refresh token", async () => {
    const before = await db.select().from(saasSchema.googleAccounts).where(eq(saasSchema.googleAccounts.tenantId, bobTenant));
    for (const [options, expected] of [
      [{ scope: "openid email" }, "scope_missing"],
      [{ scope: `${FULL_SCOPE} https://www.googleapis.com/auth/webmasters` }, "scope_too_broad"],
      [{ refresh: false }, "no_refresh_token"],
    ] as const) {
      const { location, nonce } = await startConnect(bob);
      expect(await callback(`${bob}; ${nonce}`, consent(location, "gb", options))).toBe(expected);
    }
    const { location, nonce } = await startConnect(bob);
    expect(await callback(`${bob}; ${nonce}`, { state: new URL(location).searchParams.get("state")!, error: "access_denied" })).toBe("denied");
    expect(await db.select().from(saasSchema.googleAccounts).where(eq(saasSchema.googleAccounts.tenantId, bobTenant))).toEqual(before);
  });

  it("connects Bob's own Google account separately", async () => {
    expect(await connect(bob, "gb")).toBe("connected");
    const rows = await db.select({ tenantId: saasSchema.googleAccounts.tenantId, sub: saasSchema.googleAccounts.googleSubject }).from(saasSchema.googleAccounts);
    expect(rows).toEqual(expect.arrayContaining([{ tenantId: aliceTenant, sub: USERS.ga.sub }, { tenantId: bobTenant, sub: USERS.gb.sub }]));
  });
});

describe("property management", () => {
  it("lists only the properties of the customer's own Google authorisation", async () => {
    clearSearchConsoleTokenCache();
    const a = await get(propertiesRoute.GET, "/api/beta/google/properties", alice);
    const b = await get(propertiesRoute.GET, "/api/beta/google/properties", bob);
    expect(a.data.properties.map((p: { property: string }) => p.property)).toContain("sc-domain:example.com");
    expect(a.data.properties.find((p: { property: string }) => p.property === "sc-domain:example.com")).toMatchObject({ type: "domain", websiteIds: [aliceSite] });
    expect(b.data.properties.map((p: { property: string }) => p.property)).toEqual(["https://www.example.com/", "sc-domain:b-only.test"]);
    expect(b.text).not.toContain("sc-domain:example.com");
    expect((await get(propertiesRoute.GET, "/api/beta/google/properties", carol)).data.code).toBe("not_connected");
  });

  it("rejects properties outside the authorised account, unverified ones and unsuitable ones", async () => {
    const link = (cookie: string, site: number, property: unknown) => post(siteGscRoute.POST, `/api/beta/websites/${site}/search-console`, cookie, idParams(site), { property });
    // Alice's property is not in Bob's authorisation, even though both audit example.com.
    expect(await link(bob, bobSite, "sc-domain:example.com")).toMatchObject({ status: 403, data: { code: "property_unavailable" } });
    expect(await link(bob, bobSite, "sc-domain:b-only.test")).toMatchObject({ status: 422, data: { code: "property_unsuitable" } });
    expect(await link(alice, aliceSite, "https://pending.example.com/")).toMatchObject({ status: 403 });
    expect(await link(alice, aliceSite, "https://unrelated.test/")).toMatchObject({ status: 422 });
    expect(await link(alice, aliceSite, { property: "sc-domain:example.com" })).toMatchObject({ status: 403 });
    expect(await link(carol, carolSite, "https://www.example.com/")).toMatchObject({ status: 409, data: { code: "not_connected" } });
    expect(await db.select().from(saasSchema.searchConsoleConnections)).toHaveLength(0);
  });

  it("links each customer's website to their own property (domain and URL-prefix)", async () => {
    const a = await post(siteGscRoute.POST, `/api/beta/websites/${aliceSite}/search-console`, alice, idParams(aliceSite), { property: "sc-domain:example.com" });
    expect(a).toMatchObject({ status: 200, data: { property: "sc-domain:example.com", propertyType: "domain", refresh: "queued" } });
    const b = await post(siteGscRoute.POST, `/api/beta/websites/${bobSite}/search-console`, bob, idParams(bobSite), { property: "https://www.example.com/" });
    expect(b).toMatchObject({ status: 200, data: { propertyType: "url-prefix" } });
    const links = await db.select().from(saasSchema.searchConsoleConnections);
    expect(links.map((l) => [l.tenantId, l.siteId, l.property])).toEqual(expect.arrayContaining([[aliceTenant, aliceSite, "sc-domain:example.com"], [bobTenant, bobSite, "https://www.example.com/"]]));
  });

  it("answers manipulated or foreign website IDs exactly like missing ones", async () => {
    const missing = await get(siteGscRoute.GET, "/api/beta/websites/999999/search-console", bob, idParams(999999));
    expect(missing.status).toBe(404);
    for (const id of [String(aliceSite), "0", "-1", "1e3", "2147483648", "1 OR 1=1"]) {
      for (const r of [
        await get(siteGscRoute.GET, `/api/beta/websites/${id}/search-console`, bob, idParams(id)),
        await post(siteGscRoute.POST, `/api/beta/websites/${id}/search-console`, bob, idParams(id), { property: "https://www.example.com/" }),
        await del(siteGscRoute.DELETE, `/api/beta/websites/${id}/search-console`, bob, idParams(id)),
        await post(refreshRoute.POST, `/api/beta/websites/${id}/search-console/refresh`, bob, idParams(id)),
      ]) {
        expect(r.status).toBe(404);
        expect(r.text).toBe(missing.text);
      }
    }
    // Alice's link is untouched by Bob's attempts.
    expect(await db.select().from(saasSchema.searchConsoleConnections).where(eq(saasSchema.searchConsoleConnections.tenantId, aliceTenant))).toHaveLength(1);
  });
});

describe("background refresh and real-data views", () => {
  it("fetches each tenant's data with that tenant's own credential", async () => {
    clearSearchConsoleTokenCache();
    fake.calls.length = 0;
    expect(await runRefreshes()).toEqual(["completed", "completed"]);
    const analytics = fake.calls.filter((c) => c.kind === "analytics");
    expect(analytics.every((c) => (c.user === "ga" && c.property === "sc-domain:example.com") || (c.user === "gb" && c.property === "https://www.example.com/"))).toBe(true);
    expect(new Set(analytics.map((c) => c.user))).toEqual(new Set(["ga", "gb"]));

    const a = await get(siteGscRoute.GET, `/api/beta/websites/${aliceSite}/search-console`, alice, idParams(aliceSite));
    const b = await get(siteGscRoute.GET, `/api/beta/websites/${bobSite}/search-console`, bob, idParams(bobSite));
    expect(a.data.latest).toMatchObject({ clicks: 120, impressions: 1200, property: "sc-domain:example.com" });
    expect(a.data.latest.topQueries[0].key).toBe("ga-private-query");
    expect(b.data.latest).toMatchObject({ clicks: 7, impressions: 70 });
    expect(b.text).not.toContain("ga-private-query");
    expect(b.text).not.toMatch(/tenant/i);
    const snapshots = await db.select().from(saasSchema.searchSnapshots);
    expect(snapshots.filter((s) => s.tenantId === aliceTenant).every((s) => s.siteId === aliceSite && s.clicks === 120)).toBe(true);
    expect(snapshots.filter((s) => s.tenantId === bobTenant).every((s) => s.siteId === bobSite && s.clicks === 7)).toBe(true);
  });

  it("queues manual refreshes once per website and throttles them", async () => {
    expect((await post(refreshRoute.POST, `/api/beta/websites/${aliceSite}/search-console/refresh`, alice, idParams(aliceSite))).data).toEqual({ refresh: "queued" });
    expect((await post(refreshRoute.POST, `/api/beta/websites/${aliceSite}/search-console/refresh`, alice, idParams(aliceSite))).data).toEqual({ refresh: "already-active" });
    for (let i = 0; i < 8; i++) await post(refreshRoute.POST, `/api/beta/websites/${aliceSite}/search-console/refresh`, alice, idParams(aliceSite));
    expect((await post(refreshRoute.POST, `/api/beta/websites/${aliceSite}/search-console/refresh`, alice, idParams(aliceSite))).status).toBe(429);
    // Bob's allowance is separate.
    expect((await post(refreshRoute.POST, `/api/beta/websites/${bobSite}/search-console/refresh`, bob, idParams(bobSite))).status).toBe(202);
    expect((await post(refreshRoute.POST, `/api/beta/websites/${carolSite}/search-console/refresh`, carol, idParams(carolSite))).data.code).toBe("not_linked");
    await runRefreshes();
  });

  it("runs refreshes from the worker loop with the tenant taken from the job row", async () => {
    await post(refreshRoute.POST, `/api/beta/websites/${bobSite}/search-console/refresh`, bob, idParams(bobSite));
    const seen: { tenantId: string; siteId: number; outcome: string }[] = [];
    const worker = createWorker({ db, settings: limits, google, crawl, pagespeed: speed, pagespeedApiKey: "k", onRefreshOutcome: (l, outcome) => seen.push({ tenantId: l.tenantId, siteId: l.siteId, outcome }) });
    await worker.tick();
    await Promise.all(worker.refreshes());
    await Promise.all(worker.active());
    await worker.stop();
    expect(seen).toEqual([{ tenantId: bobTenant, siteId: bobSite, outcome: "completed" }]);
  });

  it("fences refresh leases: a superseded worker cannot write", async () => {
    await post(refreshRoute.POST, `/api/beta/websites/${aliceSite}/search-console/refresh`, alice, idParams(aliceSite));
    const stale = (await claimRefresh(db, "frozen-worker", { leaseMs: 1, backoffBaseMs: 0, backoffMaxMs: 0 }))!;
    const later = new Date(Date.now() + 1000);
    expect(await recoverExpiredRefreshes(db, { leaseMs: 1, backoffBaseMs: 0, backoffMaxMs: 0 }, later)).toBe(1);
    const fresh = (await claimRefresh(db, "rescuer", undefined, later))!;
    expect(fresh.fence).toBe(stale.fence + 1);
    await expect(completeRefresh(db, stale, async () => { throw new Error("must not run"); })).rejects.toThrow(/lease/);
    expect(await runRefreshJob({ db, google }, fresh)).toBe("completed");
  });
});

describe("audit integration", () => {
  let aliceAudit: number, bobAudit: number;
  it("adds owner-authorised index status, reasons and important pages to the customer's audit", async () => {
    clearSearchConsoleTokenCache();
    aliceAudit = (await start(alice, aliceSite)).data.audit.id;
    bobAudit = (await start(bob, bobSite)).data.audit.id;
    fake.calls.length = 0;
    await runAudits();
    const inspections = fake.calls.filter((c) => c.kind === "inspect");
    expect(inspections.filter((c) => c.user === "ga").every((c) => c.property === "sc-domain:example.com")).toBe(true);
    // Bob's URL-prefix property is on www.example.com, which doesn't cover the crawled https://example.com URLs.
    expect(inspections.filter((c) => c.user === "gb")).toHaveLength(0);

    const findings = await get(findingsRoute.GET, `/api/beta/audits/${aliceAudit}/findings?category=technical`, alice, idParams(aliceAudit));
    const check = findings.data.checks.find((c: { checkId: string }) => c.checkId === "tech-index-status");
    expect(check).toMatchObject({ status: "warning", weight: 0, score: null });
    expect(check.summary).toMatch(/2 of 3 inspected pages are indexed by Google/);
    const issue = findings.data.issues.find((i: { checkId: string }) => i.checkId === "tech-index-status");
    expect(issue).toMatchObject({ url: "https://example.com/p1", severity: "high", title: "Google crawled this page but chose not to index it (important page)" });
    expect(issue.evidence.join("\n")).toMatch(/Google coverage: Crawled - currently not indexed\nSource: Google URL Inspection \(owner-authorised/);
    expect(issue.evidence.join("\n")).toMatch(/Recommended action:/);

    const bobFindings = await get(findingsRoute.GET, `/api/beta/audits/${bobAudit}/findings?category=technical`, bob, idParams(bobAudit));
    const bobCheck = bobFindings.data.checks.find((c: { checkId: string }) => c.checkId === "tech-index-status");
    expect(bobCheck.status).toBe("unavailable");
    expect(bobFindings.text).not.toContain("Crawled - currently not indexed");

    // Index status never changes the on-site score: compare with a Search Console-free re-evaluation.
    const [auditRow] = await db.select().from(saasSchema.audits).where(eq(saasSchema.audits.id, aliceAudit));
    expect(auditRow.overallScore).toBe((await db.select().from(saasSchema.audits).where(eq(saasSchema.audits.id, bobAudit)))[0].overallScore);
  });

  it("puts indexing findings into Fix with AI and the owner's own reports only", async () => {
    const fix = await get(fixRoute.GET, `/api/beta/audits/${aliceAudit}/fix?scope=all`, alice, idParams(aliceAudit));
    expect(fix.text).toContain("https://example.com/p1");
    expect(fix.text).toMatch(/not to index it/i);
    const aJson = await get(exportRoute.GET, `/api/beta/audits/${aliceAudit}/export?format=json`, alice, idParams(aliceAudit));
    expect(aJson.data.searchConsole).toMatchObject({ verified: true, property: "sc-domain:example.com", clicks: 120, source: "Google Search Console (owner-authorised)" });
    expect(aJson.data.searchConsole.indexing.notIndexed).toEqual([{ url: "https://example.com/p1", coverage: "Crawled - currently not indexed" }]);
    const bJson = await get(exportRoute.GET, `/api/beta/audits/${bobAudit}/export?format=json`, bob, idParams(bobAudit));
    expect(bJson.data.searchConsole).toMatchObject({ verified: true, clicks: 7 });
    expect(bJson.text).not.toContain("ga-private-query");
    const pdf = await get(exportRoute.GET, `/api/beta/audits/${aliceAudit}/export?format=pdf`, alice, idParams(aliceAudit));
    expect(pdf.status).toBe(200);
    expect((await get(exportRoute.GET, `/api/beta/audits/${aliceAudit}/export?format=json`, bob, idParams(aliceAudit))).status).toBe(404);
  });

  it("handles Google quota and errors without failing the audit or inventing data", async () => {
    fake.quota.inspection = true;
    const audit = (await start(alice, aliceSite)).data.audit.id;
    await runAudits();
    const findings = await get(findingsRoute.GET, `/api/beta/audits/${audit}/findings?category=technical`, alice, idParams(audit));
    const check = findings.data.checks.find((c: { checkId: string }) => c.checkId === "tech-index-status");
    expect(check.status).toBe("unavailable");
    expect(check.unavailableReason).toMatch(/quota/i);
    fake.quota.inspection = false;

    fake.quota.analytics = true;
    try {
      await post(refreshRoute.POST, `/api/beta/websites/${aliceSite}/search-console/refresh`, alice, idParams(aliceSite));
      const outcomes = await runRefreshes();
      expect(outcomes).toEqual(["retry", "retry", "failed"]);
      const overview = await get(siteGscRoute.GET, `/api/beta/websites/${aliceSite}/search-console`, alice, idParams(aliceSite));
      expect(overview.data.link.lastError).toMatch(/quota/i);
      expect(overview.data.latest.clicks).toBe(120); // the last good data stays visible
    } finally {
      fake.quota.analytics = false;
    }
  });
});

describe("revocation, disconnection and shared Google accounts", () => {
  it("detects access revoked at Google and asks only that customer to reconnect", async () => {
    revokeUser("ga");
    clearSearchConsoleTokenCache();
    await post(refreshRoute.POST, `/api/beta/websites/${aliceSite}/search-console/refresh`, alice, idParams(aliceSite));
    await post(refreshRoute.POST, `/api/beta/websites/${bobSite}/search-console/refresh`, bob, idParams(bobSite));
    const outcomes = await runRefreshes();
    expect(outcomes.sort()).toEqual(["completed", "failed"]);
    const a = await get(googleRoute.GET, "/api/beta/google", alice);
    expect(a.data.account).toMatchObject({ status: "revoked", lastError: expect.stringMatching(/Reconnect/) });
    expect(a.data.links[0]).toMatchObject({ status: "revoked" });
    expect((await get(googleRoute.GET, "/api/beta/google", bob)).data.account.status).toBe("active");
    // A new audit reports index status as not verified, with the reason.
    const audit = (await start(alice, aliceSite)).data.audit.id;
    await runAudits();
    const findings = await get(findingsRoute.GET, `/api/beta/audits/${audit}/findings?category=technical`, alice, idParams(audit));
    expect(findings.data.checks.find((c: { checkId: string }) => c.checkId === "tech-index-status").unavailableReason).toMatch(/revoked or expired/);
    // Reconnecting with the same Google account restores the existing links.
    expect(await connect(alice, "ga")).toBe("connected");
    expect((await get(googleRoute.GET, "/api/beta/google", alice)).data.links[0]).toMatchObject({ status: "connected", property: "sc-domain:example.com" });
  });

  it("cannot be redirected to another tenant's credential by copying ciphertext", async () => {
    const [a] = await db.select().from(saasSchema.googleAccounts).where(eq(saasSchema.googleAccounts.tenantId, aliceTenant));
    const [b] = await db.select().from(saasSchema.googleAccounts).where(eq(saasSchema.googleAccounts.tenantId, bobTenant));
    await db.update(saasSchema.googleAccounts).set({ encryptedRefreshToken: a.encryptedRefreshToken, updatedAt: new Date() }).where(eq(saasSchema.googleAccounts.id, b.id));
    clearSearchConsoleTokenCache();
    fake.calls.length = 0;
    expect((await get(propertiesRoute.GET, "/api/beta/google/properties", bob)).data.code).toBe("reconnect");
    expect(fake.calls.filter((c) => c.user === "ga")).toHaveLength(0);
    // Restore Bob's real credential for the remaining tests.
    await db.update(saasSchema.googleAccounts).set({ encryptedRefreshToken: b.encryptedRefreshToken, status: "active", lastError: null, updatedAt: new Date() }).where(eq(saasSchema.googleAccounts.id, b.id));
    await db.update(saasSchema.searchConsoleConnections).set({ status: "connected", lastError: null }).where(eq(saasSchema.searchConsoleConnections.tenantId, bobTenant));
  });

  it("does not revoke a Google grant that another customer still uses", async () => {
    // Carol authorises the same Google account as Bob, then disconnects.
    expect(await connect(carol, "gb")).toBe("connected");
    const revocations = fake.revocations;
    expect((await post(disconnectRoute.POST, "/api/beta/google/disconnect", carol)).data).toEqual({ disconnected: true, revokedAtGoogle: false });
    expect(fake.revocations).toBe(revocations);
    clearSearchConsoleTokenCache();
    expect((await get(propertiesRoute.GET, "/api/beta/google/properties", bob)).status).toBe(200);
    expect((await get(googleRoute.GET, "/api/beta/google", carol)).data.account).toBeNull();
  });

  it("disconnects Alice, revokes her grant and leaves Bob untouched", async () => {
    const res = await post(disconnectRoute.POST, "/api/beta/google/disconnect", alice);
    expect(res.data).toEqual({ disconnected: true, revokedAtGoogle: true });
    expect(await db.select().from(saasSchema.googleAccounts).where(eq(saasSchema.googleAccounts.tenantId, aliceTenant))).toHaveLength(0);
    expect(await db.select().from(saasSchema.searchConsoleConnections).where(eq(saasSchema.searchConsoleConnections.tenantId, aliceTenant))).toHaveLength(0);
    // Her latest audit's index check and reports drop back to "not verified".
    const [latest] = await db.select().from(saasSchema.audits).where(and(eq(saasSchema.audits.tenantId, aliceTenant), eq(saasSchema.audits.status, "completed"))).orderBy(desc(saasSchema.audits.completedAt)).limit(1);
    const [check] = await db.select().from(saasSchema.checks).where(and(eq(saasSchema.checks.tenantId, aliceTenant), eq(saasSchema.checks.auditId, latest.id), eq(saasSchema.checks.checkId, "tech-index-status")));
    expect(check).toMatchObject({ status: "unavailable" });
    const exported = await get(exportRoute.GET, `/api/beta/audits/${latest.id}/export?format=json`, alice, idParams(latest.id));
    expect(exported.data.searchConsole).toMatchObject({ verified: false });
    clearSearchConsoleTokenCache();
    expect((await get(googleRoute.GET, "/api/beta/google", bob)).data.account.status).toBe("active");
    await post(refreshRoute.POST, `/api/beta/websites/${bobSite}/search-console/refresh`, bob, idParams(bobSite));
    expect(await runRefreshes()).toEqual(["completed"]);
    expect((await post(disconnectRoute.POST, "/api/beta/google/disconnect", alice)).data).toEqual({ disconnected: false, revokedAtGoogle: false });
  });

  it("unlinks a property without touching the Google account", async () => {
    expect((await del(siteGscRoute.DELETE, `/api/beta/websites/${bobSite}/search-console`, bob, idParams(bobSite))).data).toEqual({ unlinked: true });
    expect((await get(googleRoute.GET, "/api/beta/google", bob)).data).toMatchObject({ account: { status: "active" }, links: [] });
  });
});

describe("secrets", () => {
  it("never exposes Google tokens in responses, redirects, cookies, exports or logs", () => {
    const issued = fake.issued.filter(Boolean);
    expect(issued.length).toBeGreaterThan(5);
    const surfaces = [...responses, ...logged].join("\n");
    for (const token of issued) expect(surfaces).not.toContain(token);
    expect(surfaces).not.toContain(google.clientSecret);
    expect(surfaces).not.toMatch(/encryptedRefreshToken|encrypted_refresh_token|code_verifier/);
  });
});
