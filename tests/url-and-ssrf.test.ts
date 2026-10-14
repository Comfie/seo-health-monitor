import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCrawlableHtmlUrl, isSameSite, normalizeInputUrl, resolveHref, UrlValidationError } from "@/lib/crawler/url";
import { assertSafeUrl, isPublicIp, safeLookup, SsrfError } from "@/lib/crawler/ssrf";
import { safeFetch } from "@/lib/crawler/http";

describe("normalizeInputUrl", () => {
  it("adds https and normalises host, port and fragment", () => {
    expect(normalizeInputUrl("Example.COM")).toBe("https://example.com/");
    expect(normalizeInputUrl("https://example.com:443/a//b#x")).toBe("https://example.com/a/b");
  });
  it.each(["", "ftp://example.com", "javascript:alert(1)", "https://user:pw@example.com", "localhost"])("rejects %s", (input) => {
    expect(() => normalizeInputUrl(input)).toThrow(UrlValidationError);
  });
});

describe("link helpers", () => {
  it("resolves relative links and ignores non-web schemes", () => {
    expect(resolveHref("/about#team", "https://example.com/x/")).toBe("https://example.com/about");
    expect(resolveHref("tel:+123", "https://example.com/")).toBeNull();
    expect(resolveHref("#top", "https://example.com/")).toBeNull();
  });
  it("treats www and bare domain as the same site", () => {
    expect(isSameSite("https://www.example.com/a", "example.com")).toBe(true);
    expect(isSameSite("https://cdn.example.com/a", "example.com")).toBe(false);
  });
  it("skips files and admin paths", () => {
    expect(isCrawlableHtmlUrl("https://example.com/brochure.pdf")).toBe(false);
    expect(isCrawlableHtmlUrl("https://example.com/wp-admin/")).toBe(false);
    expect(isCrawlableHtmlUrl("https://example.com/cdn-cgi/l/email-protection")).toBe(false);
    expect(isCrawlableHtmlUrl("https://example.com/services/")).toBe(true);
  });
});

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "198.18.0.1"])("blocks %s", (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
  it.each(["8.8.8.8", "104.21.3.4", "2606:4700::1111"])("allows %s", (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
  it("rejects unsafe URLs before connecting", () => {
    expect(() => assertSafeUrl("http://127.0.0.1/")).toThrow(SsrfError);
    expect(() => assertSafeUrl("http://[::1]/")).toThrow(SsrfError);
    expect(() => assertSafeUrl("http://metadata.internal/")).toThrow(SsrfError);
    expect(() => assertSafeUrl("http://example.com:22/")).toThrow(SsrfError);
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(SsrfError);
    expect(assertSafeUrl("https://example.com/").hostname).toBe("example.com");
  });

  afterEach(() => vi.restoreAllMocks());

  it("rejects hostnames whose DNS answers are private (DNS rebinding)", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "10.1.2.3", family: 4 }])) as unknown as typeof dns.lookup);
    const err = await new Promise<Error | null>((resolve) => safeLookup("evil.example", { all: true }, (e) => resolve(e)));
    expect(err).toBeInstanceOf(SsrfError);
  });

  it("safeFetch reports blocked addresses instead of fetching them", async () => {
    const res = await safeFetch("http://127.0.0.1:8080/");
    expect(res.status).toBeNull();
    expect(res.errorCode).toBe("SSRF_BLOCKED");
  });
});
