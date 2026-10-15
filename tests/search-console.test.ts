import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seo-gsc-"));
process.env.DATABASE_PATH = path.join(tmp, "test.db");
process.env.APP_SECRET = "test-secret-test-secret-test-secret-123";
process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "client-secret";
process.env.APP_URL = "https://seo.example.test";

const { decrypt, encrypt, pkceChallenge } = await import("@/lib/security/crypto");
const { createOAuthState, readOAuthState, safeReturnTo } = await import("@/lib/integrations/search-console/oauth-state");
const google = await import("@/lib/integrations/search-console/google");
const service = await import("@/lib/integrations/search-console/service");
const { getDb, schema } = await import("@/lib/db");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("crypto", () => {
  it("round-trips and rejects tampering or the wrong purpose", () => {
    const sealed = encrypt("refresh-token", "a");
    expect(sealed).not.toContain("refresh-token");
    expect(decrypt(sealed, "a")).toBe("refresh-token");
    expect(decrypt(sealed, "b")).toBeNull();
    const tampered = sealed.slice(0, -2) + (sealed.at(-2) === "A" ? "B" : "A") + sealed.slice(-1);
    expect(decrypt(tampered, "a")).toBeNull();
    expect(decrypt("garbage", "a")).toBeNull();
  });
  it("produces RFC 7636 S256 challenges", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("OAuth state", () => {
  it("accepts only the matching, unexpired state", () => {
    const { state, verifier, cookie } = createOAuthState("/search-console?site=2");
    expect(readOAuthState(cookie, state)).toMatchObject({ verifier, returnTo: "/search-console?site=2" });
    expect(readOAuthState(cookie, "other")).toBeNull();
    expect(readOAuthState(undefined, state)).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(readOAuthState(cookie, state)).toBeNull();
    vi.useRealTimers();
  });
  it("blocks open redirects", () => {
    expect(safeReturnTo("//evil.com")).toBe("/search-console");
    expect(safeReturnTo("https://evil.com")).toBe("/search-console");
    expect(safeReturnTo("/progress?site=1")).toBe("/progress?site=1");
  });
});

describe("Google helpers", () => {
  it("builds a read-only, offline, PKCE consent URL", () => {
    const url = new URL(google.buildAuthUrl({ clientId: "id", clientSecret: "s", redirectUri: "https://a/cb" }, "st", "ch"));
    expect(url.searchParams.get("scope")).toContain("webmasters.readonly");
    expect(url.searchParams.get("scope")).not.toMatch(/webmasters(\s|$)/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
  });
  it("matches properties to sites", () => {
    expect(google.propertyCovers("sc-domain:example.com", "https://www.example.com/a")).toBe(true);
    expect(google.propertyCovers("https://example.com/", "https://www.example.com/a")).toBe(false);
    expect(google.suggestProperty("www.example.com", ["https://other.com/", "https://example.com/", "sc-domain:example.com"])).toBe("sc-domain:example.com");
    expect(google.suggestProperty("example.com", ["https://other.com/"])).toBeNull();
  });
  it("uses consecutive windows ending three days ago", () => {
    const w = google.reportingWindow(28, new Date("2026-10-14T12:00:00Z"));
    expect(w.current).toEqual({ startDate: "2026-09-14", endDate: "2026-10-11" });
    expect(w.previous).toEqual({ startDate: "2026-08-17", endDate: "2026-09-13" });
  });
});

/** Minimal fake of Google's OAuth + Search Console endpoints. */
function fakeGoogle(options: { revoked?: boolean } = {}) {
  const idPayload = Buffer.from(JSON.stringify({ email: "owner@example.test" })).toString("base64url");
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(String(init?.body));
      if (options.revoked && body.get("grant_type") === "refresh_token") return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      return json({ access_token: "access-1", expires_in: 3600, refresh_token: "refresh-secret", scope: "openid email https://www.googleapis.com/auth/webmasters.readonly", id_token: `h.${idPayload}.s` });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
    if (url.endsWith("/webmasters/v3/sites")) return json({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }, { siteUrl: "https://unverified.test/", permissionLevel: "siteUnverifiedUser" }] });
    if (url.includes("/searchAnalytics/query")) {
      const q = JSON.parse(String(init?.body)) as { dimensions?: string[]; startDate: string };
      const dim = q.dimensions?.[0];
      if (!dim) return json({ rows: [{ clicks: q.startDate < "2026-09-01" ? 80 : 120, impressions: 4000, ctr: 0.03, position: 12.5 }] });
      if (dim === "date") return json({ rows: [{ keys: ["2026-09-14"], clicks: 4, impressions: 150, ctr: 0.026, position: 13 }] });
      return json({ rows: [{ keys: [dim === "query" ? "borehole drilling" : "https://example.com/"], clicks: 50, impressions: 900, ctr: 0.055, position: 4.2 }] });
    }
    if (url.includes("urlInspection")) return json({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" } } });
    return json({ error: { message: `unexpected ${url}` } }, 500);
  });
}

describe("Search Console service", () => {
  let siteId: number;
  beforeAll(() => {
    siteId = getDb().insert(schema.sites).values({ host: "example.com", displayUrl: "https://example.com/" }).returning().get().id;
  });
  beforeEach(() => vi.unstubAllGlobals());

  it("stores the refresh token encrypted, never in plaintext", async () => {
    vi.stubGlobal("fetch", fakeGoogle());
    const account = await service.completeConnection("code", "verifier");
    expect(account.email).toBe("owner@example.test");
    expect(account.encryptedRefreshToken).not.toContain("refresh-secret");
    const raw = fs.readFileSync(process.env.DATABASE_PATH!).toString("latin1") + (fs.existsSync(`${process.env.DATABASE_PATH}-wal`) ? fs.readFileSync(`${process.env.DATABASE_PATH}-wal`).toString("latin1") : "");
    expect(raw).not.toContain("refresh-secret");
  });

  it("only links properties the account can read", async () => {
    vi.stubGlobal("fetch", fakeGoogle());
    await expect(service.linkProperty(siteId, "https://unverified.test/")).rejects.toThrow(/isn't available/);
    await service.linkProperty(siteId, "sc-domain:example.com");
    expect(service.getSiteConnection(siteId)?.property).toBe("sc-domain:example.com");
  });

  it("stores a real-shaped snapshot with totals, comparisons, rows and inspections", async () => {
    vi.stubGlobal("fetch", fakeGoogle());
    const snap = await service.fetchSnapshot(siteId, { pageUrls: ["https://example.com/", "https://elsewhere.test/"] });
    expect(snap).toMatchObject({ status: "ok", clicks: 120, impressions: 4000, position: 12.5 });
    expect(snap?.previous?.clicks).toBe(80);
    expect(snap?.topQueries?.[0].key).toBe("borehole drilling");
    expect(snap?.inspections).toHaveLength(1); // the other URL isn't covered by the property
    expect(snap?.inspections?.[0].verdict).toBe("PASS");
  });

  it("records an error snapshot and flags reconnect when access is revoked", async () => {
    (globalThis as unknown as { __gscToken: null }).__gscToken = null;
    vi.stubGlobal("fetch", fakeGoogle({ revoked: true }));
    const snap = await service.fetchSnapshot(siteId);
    expect(snap?.status).toBe("error");
    expect(snap?.error).toMatch(/revoked/);
    expect(service.getGoogleAccount()?.lastError).toMatch(/Reconnect/);
    expect(service.latestSnapshot(siteId)?.status).toBe("ok");
  });

  it("disconnect revokes and deletes tokens and links", async () => {
    const fetchMock = fakeGoogle();
    vi.stubGlobal("fetch", fetchMock);
    await service.disconnect();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/revoke"))).toBe(true);
    expect(service.getGoogleAccount()).toBeNull();
    expect(service.getSiteConnection(siteId)).toBeNull();
  });
});

describe("fillDailySeries", () => {
  it("fills days Google omitted with zeros across the whole window", () => {
    const filled = google.fillDailySeries([{ date: "2026-10-10", clicks: 1, impressions: 2, ctr: 0.5, position: 1.5 }], "2026-10-08", "2026-10-11");
    expect(filled.map((d) => d.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(filled.map((d) => d.impressions)).toEqual([0, 0, 2, 0]);
    expect(filled[0].position).toBeNull();
  });
});

describe("Google index coverage check", () => {
  it("reports Google's real index status on the audit and never changes the score", async () => {
    vi.stubGlobal("fetch", fakeGoogle());
    const { applySearchConsoleToAudit } = await import("@/lib/audit/index-status");
    const db = getDb();
    const site = db.insert(schema.sites).values({ host: "index.example.com", displayUrl: "https://index.example.com/" }).returning().get();
    const audit = db.insert(schema.audits).values({ siteId: site.id, inputUrl: "x", startUrl: "x", status: "completed", completedAt: new Date(), overallScore: 80, categoryScores: { technical: 80 }, counts: {} }).returning().get();
    for (const url of ["https://index.example.com/", "https://index.example.com/a"]) {
      db.insert(schema.pages).values({ auditId: audit.id, url, finalUrl: url, status: 200, depth: 0, source: "start", data: {} }).run();
    }
    db.insert(schema.checks).values({ auditId: audit.id, checkId: "onpage-title", category: "technical", title: "t", description: "d", status: "pass", score: 0.8, weight: 1, summary: "s" }).run();
    const check = () => db.select().from(schema.checks).all().find((c) => c.auditId === audit.id && c.checkId === "tech-index-status");

    // Linked to nothing yet: says so plainly.
    applySearchConsoleToAudit(audit.id);
    expect(check()?.status).toBe("unavailable");
    expect(check()?.summary).toMatch(/not (linked|configured|connected)/i);

    // Connected + linked + snapshot with one indexed and one unknown page.
    await service.completeConnection("code", "verifier");
    await service.linkProperty(site.id, "sc-domain:example.com");
    const inspect = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("urlInspection")) {
        const page = JSON.parse(String(init?.body)).inspectionUrl as string;
        const r = page.endsWith("/a") ? { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" } : { verdict: "PASS", coverageState: "Submitted and indexed", lastCrawlTime: "2026-10-01T00:00:00Z" };
        return new Response(JSON.stringify({ inspectionResult: { indexStatusResult: r } }), { status: 200 });
      }
      return fakeGoogle()(input, init);
    });
    vi.stubGlobal("fetch", inspect);
    await service.fetchSnapshot(site.id, { pageUrls: ["https://index.example.com/", "https://index.example.com/a"] });
    applySearchConsoleToAudit(audit.id);

    expect(check()).toMatchObject({ status: "warning", weight: 0, score: null });
    expect(check()?.summary).toMatch(/^1 of 2 inspected pages are indexed by Google/);
    const issues = db.select().from(schema.issues).all().filter((i) => i.auditId === audit.id);
    expect(issues.map((i) => i.url)).toEqual(["https://index.example.com/a"]);
    expect(issues[0].evidence[0]).toBe("Google coverage: URL is unknown to Google");
    // Weight 0: the on-site score is untouched.
    expect(db.select().from(schema.audits).all().find((a) => a.id === audit.id)?.overallScore).toBe(80);
    vi.unstubAllGlobals();
  });
});
