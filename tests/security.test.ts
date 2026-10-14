import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seo-sec-"));
process.env.DATABASE_PATH = path.join(tmp, "test.db");
process.env.APP_SECRET = "security-test-secret-security-test-secret";

const auth = await import("@/lib/security/auth");
const { hitRateLimit, checkLimits, clientKey } = await import("@/lib/rate-limit");
const { NextRequest } = await import("next/server");
const { proxy } = await import("@/proxy");
const { getDb, schema } = await import("@/lib/db");
const queue = await import("@/lib/audit/queue");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ENV_KEYS = ["AUTH_PASSWORD", "AUTH_DISABLED", "NODE_ENV", "TRUST_PROXY"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = saved[k];
  }
});
const setEnv = (env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
};

describe("auth modes", () => {
  it("fails closed in production without a password", () => {
    setEnv({ NODE_ENV: "production", AUTH_PASSWORD: undefined, AUTH_DISABLED: undefined });
    expect(auth.authMode()).toBe("misconfigured");
    setEnv({ AUTH_PASSWORD: "short" });
    expect(auth.authMode()).toBe("misconfigured");
    expect(auth.authProblem()).toMatch(/12 characters/);
    setEnv({ AUTH_PASSWORD: "a-long-enough-password" });
    expect(auth.authMode()).toBe("password");
    setEnv({ AUTH_PASSWORD: undefined, AUTH_DISABLED: "true" });
    expect(auth.authMode()).toBe("disabled");
  });
  it("is open only in development with no password configured", () => {
    setEnv({ NODE_ENV: "development", AUTH_PASSWORD: undefined, AUTH_DISABLED: undefined });
    expect(auth.authMode()).toBe("open-dev");
  });
});

describe("sessions and passwords", () => {
  beforeEach(() => setEnv({ AUTH_PASSWORD: "correct horse battery staple" }));

  it("verifies the password without accepting near misses", () => {
    expect(auth.verifyPassword("correct horse battery staple")).toBe(true);
    expect(auth.verifyPassword("correct horse battery stapl")).toBe(false);
    expect(auth.verifyPassword("")).toBe(false);
  });
  it("accepts valid sessions and rejects tampered, expired or post-password-change ones", () => {
    const token = auth.createSessionToken();
    expect(auth.verifySessionToken(token)).toBe(true);
    expect(auth.verifySessionToken(token.replace(/.$/, (c) => (c === "a" ? "b" : "a")))).toBe(false);
    const [exp, sig] = token.split(".");
    expect(auth.verifySessionToken(`${Number(exp) + 1000}.${sig}`)).toBe(false);
    expect(auth.verifySessionToken(token, Number(exp) + 1)).toBe(false);
    setEnv({ AUTH_PASSWORD: "a different long password" });
    expect(auth.verifySessionToken(token)).toBe(false);
    expect(auth.verifySessionToken(undefined)).toBe(false);
  });
});

describe("same-origin check", () => {
  const req = (origin?: string) => new Request("http://localhost:3000/api/audits", { method: "POST", headers: { host: "localhost:3000", ...(origin ? { origin } : {}) } });
  it("allows the app's own origin and blocks others", () => {
    expect(auth.isSameOrigin(req("http://localhost:3000"))).toBe(true);
    expect(auth.isSameOrigin(req("https://evil.example"))).toBe(false);
    expect(auth.isSameOrigin(req())).toBe(true);
    expect(auth.isSameOrigin(req("https://seo.example.com"), "https://seo.example.com")).toBe(true);
  });
});

describe("rate limiting", () => {
  it("persists counts and resets after the window", () => {
    expect(hitRateLimit("t1", 2, 1000, 0).allowed).toBe(true);
    expect(hitRateLimit("t1", 2, 1000, 10).allowed).toBe(true);
    const blocked = hitRateLimit("t1", 2, 1000, 20);
    expect(blocked).toMatchObject({ allowed: false, retryAfterMs: 980 });
    expect(hitRateLimit("t1", 2, 1000, 1001).allowed).toBe(true);
  });
  it("enforces the global cap even when client keys rotate", () => {
    let allowed = 0;
    for (let i = 0; i < 10; i++) if (checkLimits(`client-${i}`, "glob", { max: 5, windowMs: 60_000 }, { max: 3, windowMs: 60_000 }).allowed) allowed++;
    expect(allowed).toBe(3);
  });
  it("ignores spoofable X-Forwarded-For unless proxies are trusted", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(clientKey(h, 0)).toBe("untrusted-proxy");
    expect(clientKey(h, 1)).toBe("203.0.113.9");
    expect(clientKey(h, 2)).toBe("6.6.6.6");
  });
});

describe("proxy", () => {
  const call = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(new URL(url, "http://localhost:3000"), { method: init.method ?? "GET", headers: { host: "localhost:3000", ...init.headers } }));

  it("requires a session for pages and APIs when a password is set", () => {
    setEnv({ NODE_ENV: "production", AUTH_PASSWORD: "correct horse battery staple" });
    const page = call("/technical?audit=2");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/login?next=%2Ftechnical%3Faudit%3D2");
    expect(call("/api/audits").status).toBe(401);
    expect(call("/login").status).toBe(200);
    expect(call("/api/health").status).toBe(200);
    const cookie = `${auth.SESSION_COOKIE}=${auth.createSessionToken()}`;
    expect(call("/technical", { headers: { cookie } }).status).toBe(200);
  });
  it("blocks cross-origin writes even on public paths", () => {
    setEnv({ NODE_ENV: "production", AUTH_PASSWORD: "correct horse battery staple" });
    expect(call("/api/auth/login", { method: "POST", headers: { origin: "https://evil.example" } }).status).toBe(403);
  });
  it("returns 503 instead of serving data when production auth is misconfigured", () => {
    setEnv({ NODE_ENV: "production", AUTH_PASSWORD: undefined, AUTH_DISABLED: undefined });
    expect(call("/").status).toBe(503);
  });
});

describe("route guards (defence in depth)", () => {
  it("rejects unauthenticated API calls even if the proxy is bypassed", async () => {
    setEnv({ NODE_ENV: "production", AUTH_PASSWORD: "correct horse battery staple" });
    const { POST } = await import("@/app/api/audits/route");
    const res = await POST(new Request("http://localhost:3000/api/audits", { method: "POST", body: JSON.stringify({ url: "https://example.com" }) }));
    expect(res.status).toBe(401);
    const { GET } = await import("@/app/api/audits/[id]/export/route");
    const exp = await GET(new Request("http://localhost:3000/api/audits/1/export"), { params: Promise.resolve({ id: "1" }) } as never);
    expect(exp.status).toBe(401);
  });
});

describe("audit queue", () => {
  const db = getDb();
  const site = db.insert(schema.sites).values({ host: "queue.test", displayUrl: "https://queue.test/" }).returning().get();
  const insert = (over: Partial<typeof schema.audits.$inferInsert>) => db.insert(schema.audits).values({ siteId: site.id, inputUrl: "https://queue.test/", startUrl: "https://queue.test/", status: "queued", ...over }).returning().get();

  it("claims each queued audit exactly once, oldest first", () => {
    const a = insert({});
    const b = insert({});
    expect(queue.claimNextAudit()?.id).toBe(a.id);
    expect(queue.claimNextAudit()?.id).toBe(b.id);
    expect(queue.claimNextAudit()).toBeNull();
    const row = db.select().from(schema.audits).all().find((r) => r.id === a.id)!;
    expect(row).toMatchObject({ status: "running", attempts: 1 });
  });

  it("re-queues interrupted audits once, then fails them", () => {
    const now = Date.now();
    const stale = insert({ status: "running", attempts: 1, heartbeatAt: new Date(now - 5 * 60_000) });
    const exhausted = insert({ status: "running", attempts: 2, heartbeatAt: new Date(now - 5 * 60_000) });
    const healthy = insert({ status: "running", attempts: 1, heartbeatAt: new Date(now) });
    queue.recoverStaleAudits(now);
    const byId = (id: number) => db.select().from(schema.audits).all().find((r) => r.id === id)!;
    expect(byId(stale.id).status).toBe("queued");
    expect(byId(exhausted.id).status).toBe("failed");
    expect(byId(healthy.id).status).toBe("running");
  });

  it("rejects unsafe URLs before queueing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => queue.enqueueAudit("http://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => queue.enqueueAudit("file:///etc/passwd")).toThrow();
  });
});
