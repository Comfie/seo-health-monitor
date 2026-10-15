import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readBetaConfig } from "@/lib/saas/config";
import { createMailer, renderMail } from "@/lib/saas/email";
import { proxy } from "@/proxy";
import { isAuthenticated } from "@/lib/security/auth";

const secret = "s".repeat(40);
const base = {
  NODE_ENV: "production",
  PHASE2_ENABLED: "true",
  AUTH_PASSWORD: "owner-password-123",
  APP_SECRET: secret,
  PHASE2_DATABASE_URL: "postgresql://staging.internal/seo_beta",
  PHASE2_ORIGIN: "https://beta.example.com",
  PHASE2_AUTH_SECRET: "b".repeat(40),
  PHASE2_REGISTRATION: "invite-only",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "SEO Health Monitor <beta@example.com>",
} as NodeJS.ProcessEnv;
const problem = (env: NodeJS.ProcessEnv) => {
  const result = readBetaConfig(env);
  return result.state === "misconfigured" ? result.problem : result.state;
};

describe("beta configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is disabled unless explicitly enabled", () => {
    expect(readBetaConfig({ ...base, PHASE2_ENABLED: undefined }).state).toBe("disabled");
    expect(readBetaConfig({ ...base, PHASE2_ENABLED: "1" }).state).toBe("disabled");
  });

  it("accepts a complete production configuration with invitations off by default", () => {
    vi.stubEnv("APP_SECRET", secret);
    const result = readBetaConfig(base);
    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.config.invitationsEnabled).toBe(false);
      expect(result.config.registration).toBe("invite-only");
      expect(result.config.email.transport).toBe("resend");
    }
  });

  it("refuses configurations that could expose global Phase 1 data or production resources", () => {
    vi.stubEnv("APP_SECRET", secret);
    expect(problem({ ...base, AUTH_DISABLED: "true" })).toMatch(/AUTH_DISABLED/);
    expect(problem({ ...base, AUTH_PASSWORD: undefined })).toMatch(/legacy owner area/);
    expect(problem({ ...base, DATABASE_URL: base.PHASE2_DATABASE_URL })).toMatch(/production database/);
    expect(problem({ ...base, PRODUCTION_DATABASE_URL: base.PHASE2_DATABASE_URL })).toMatch(/production database/);
    expect(problem({ ...base, PHASE2_DATABASE_URL: "pglite://./data/x" })).toMatch(/PostgreSQL/);
    expect(problem({ ...base, PHASE2_DATABASE_URL: "file:./data/seo-health.db" })).toMatch(/PostgreSQL/);
  });

  it("never supports unrestricted public registration", () => {
    vi.stubEnv("APP_SECRET", secret);
    for (const value of ["open", "public", "enabled", "true"]) expect(problem({ ...base, PHASE2_REGISTRATION: value })).toMatch(/closed or invite-only/);
    const closed = readBetaConfig({ ...base, PHASE2_REGISTRATION: undefined });
    expect(closed.state === "ready" && closed.config.registration).toBe("closed");
  });

  it("requires a distinct secret, an https origin and real email delivery in production", () => {
    vi.stubEnv("APP_SECRET", secret);
    expect(problem({ ...base, PHASE2_AUTH_SECRET: "short" })).toMatch(/32\+/);
    expect(problem({ ...base, PHASE2_AUTH_SECRET: secret })).toMatch(/differ from APP_SECRET/);
    expect(problem({ ...base, PHASE2_ORIGIN: "http://beta.example.com" })).toMatch(/https/);
    expect(problem({ ...base, PHASE2_ORIGIN: "http://localhost:3000" })).toMatch(/https/);
    expect(problem({ ...base, PHASE2_ORIGIN: "https://beta.example.com/path" })).toMatch(/canonical/);
    expect(problem({ ...base, EMAIL_TRANSPORT: "log" })).toMatch(/development only/);
    expect(problem({ ...base, RESEND_API_KEY: undefined })).toMatch(/RESEND_API_KEY/);
  });

  it("allows local development with PGlite, http://localhost and logged email", () => {
    const result = readBetaConfig({ ...base, NODE_ENV: "development", AUTH_PASSWORD: undefined, PHASE2_DATABASE_URL: "pglite://./data/phase2-dev", PHASE2_ORIGIN: "http://localhost:3000", RESEND_API_KEY: undefined });
    expect(result.state).toBe("ready");
    expect(result.state === "ready" && result.config.email.transport).toBe("log");
  });
});

describe("transactional email", () => {
  const url = "https://beta.example.com/api/beta/auth/verify-email?token=abc&callbackURL=%2Fbeta";

  it("sends through Resend with the configured sender and both text and HTML bodies", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await createMailer({ transport: "resend", apiKey: "re_key", from: "Beta <beta@example.com>", allowlist: [] }, fetchMock as unknown as typeof fetch)({ to: "a@example.com", purpose: "verify-email", url });
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Beta <beta@example.com>", to: ["a@example.com"], subject: "Verify your SEO Health Monitor email" });
    expect(body.text).toContain(url);
    expect(body.html).toContain(url.replace(/&/g, "&#38;"));
  });

  it("reports provider failures without leaking addresses or tokens", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 422 }));
    const send = createMailer({ transport: "resend", apiKey: "re_key", from: "beta@example.com", allowlist: [] }, fetchMock as unknown as typeof fetch);
    const error = await send({ to: "a@example.com", purpose: "reset-password", url }).catch((e: Error) => e);
    expect(String(error)).toBe("Error: Email delivery failed (422).");
  });

  it("suppresses recipients outside the staging allowlist", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = createMailer({ transport: "resend", apiKey: "k", from: "f@example.com", allowlist: ["@test.example.com", "owner@example.com"] }, fetchMock as unknown as typeof fetch);
    await send({ to: "real.person@gmail.com", purpose: "invitation", url });
    await send({ to: "tester1@test.example.com", purpose: "invitation", url });
    await send({ to: "OWNER@example.com", purpose: "invitation", url });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0])).not.toContain("real.person");
    warn.mockRestore();
  });

  it("escapes HTML in rendered messages", () => {
    expect(renderMail({ to: "a@example.com", purpose: "invitation", url: 'https://x.example/"><script>' }).html).not.toContain("<script>");
  });
});

describe("legacy Phase 1 isolation", () => {
  afterEach(() => vi.unstubAllEnvs());
  const betaCookie = "shm_beta.session_token=valid-looking-token";

  it("never accepts a customer session for owner-only global routes", () => {
    vi.stubEnv("AUTH_PASSWORD", "owner-password-123");
    vi.stubEnv("APP_SECRET", secret);
    for (const path of ["/", "/audits", "/reports?audit=1", "/settings"]) {
      const response = proxy(new NextRequest(`https://app.example.com${path}`, { headers: { cookie: betaCookie } }));
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location")).toContain("/login");
    }
    for (const path of ["/api/audits", "/api/audits/1/export?format=json", "/api/sites/1/search-console", "/api/integrations/google/connect"]) {
      expect(proxy(new NextRequest(`https://app.example.com${path}`, { headers: { cookie: betaCookie } })).status, path).toBe(401);
    }
    expect(isAuthenticated(new Request("https://app.example.com/api/audits", { headers: { cookie: betaCookie } }))).toBe(false);
  });

  it("routes beta paths past the owner check only when the beta is enabled", () => {
    vi.stubEnv("AUTH_PASSWORD", "owner-password-123");
    vi.stubEnv("APP_SECRET", secret);
    vi.stubEnv("PHASE2_ENABLED", "");
    expect(proxy(new NextRequest("https://app.example.com/beta")).status).toBe(404);
    expect(proxy(new NextRequest("https://app.example.com/api/beta/websites")).status).toBe(404);
    vi.stubEnv("PHASE2_ENABLED", "true");
    expect(proxy(new NextRequest("https://app.example.com/beta/login")).headers.get("x-middleware-next")).toBe("1");
    // Customer pages without a beta cookie go to the beta sign-in, never the owner login.
    expect(proxy(new NextRequest("https://app.example.com/beta/websites")).headers.get("location")).toBe("https://app.example.com/beta/login");
    expect(proxy(new NextRequest("https://app.example.com/beta", { headers: { cookie: "shm_beta.session_token=x" } })).headers.get("x-middleware-next")).toBe("1");
    // A prefix lookalike is not a beta path and still needs the owner session.
    expect(proxy(new NextRequest("https://app.example.com/betaadmin")).status).toBe(307);
  });

  it("still blocks cross-origin mutations to beta APIs at the proxy", () => {
    vi.stubEnv("PHASE2_ENABLED", "true");
    const response = proxy(new NextRequest("https://app.example.com/api/beta/websites", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
  });
});

describe("beta code never reaches global Phase 1 data", () => {
  it("imports no global SQLite repository, queue, Google service or limiter", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
    const files = ["src/app/beta", "src/app/api/beta", "src/components/beta", "src/lib/saas"].flatMap(walk);
    expect(files.length).toBeGreaterThan(20);
    // Type-only imports are erased at compile time and cannot reach data. The AI consultant is
    // stateless (it receives an audit and returns text), so it is allowed; its budget is tenant-scoped.
    // The Google HTTP client and the snapshot collector are stateless (no storage, no process-wide
    // token); the Phase 1 Search Console service and its cookie state stay forbidden.
    const forbidden = /from ["']@\/lib\/(db|audit\/(repository|views|queue|runner|performance-rerun|index-status|progress)|integrations\/(?!search-console\/(google|collect)["'])|rate-limit|ai\/(?!consultant["']))/;
    const runtimeImports = (file: string) => readFileSync(file, "utf8").split("\n").filter((line) => !/^\s*import type /.test(line)).join("\n");
    expect(files.filter((file) => forbidden.test(runtimeImports(file)))).toEqual([]);
    // Shared modules that beta code does import must not reach global data themselves.
    const shared = ["src/lib/ai/consultant.ts", "src/lib/audit/pipeline.ts", "src/lib/reports/export.ts", "src/lib/reports/pdf.ts", "src/lib/reports/fix-request.ts", "src/lib/performance/run.ts", "src/lib/crawler/crawl.ts", "src/lib/integrations/search-console/google.ts", "src/lib/integrations/search-console/collect.ts", "src/lib/audit/index-reasons.ts"];
    expect(shared.filter((file) => forbidden.test(runtimeImports(file)))).toEqual([]);
  });
});
