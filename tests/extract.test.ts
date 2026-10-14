import { describe, expect, it } from "vitest";
import { extractPage, parseJsonLd, shingleSketch, sketchSimilarity } from "@/lib/crawler/extract";
import { parseSitemapXml } from "@/lib/crawler/sitemap";
import { parseRobots } from "@/lib/crawler/robots";

const HTML = `<!doctype html><html lang="en-ZA"><head>
<title>Emergency Plumbing in Leeds | Acme Plumbing</title>
<meta name="description" content="24/7 emergency plumbers in Leeds.">
<meta name="robots" content="index,follow">
<link rel="canonical" href="/">
<meta property="og:title" content="Acme"><meta property="og:site_name" content="Acme Plumbing">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Acme Plumbing","telephone":"+441130000000","areaServed":["Leeds","York"]}</script>
<script type="application/ld+json">{"@type": "Thing",}</script>
</head><body>
<h1>Emergency Plumbing</h1><h3>Skipped level</h3>
<img src="/a.jpg"><img src="/b.jpg" alt="">
<a href="/contact">Contact us</a><a href="https://other.com/">Partner</a><a href="tel:+441130000000">Call 0113 000 0000</a>
<a href="https://wa.me/441130000000">WhatsApp</a><a href="https://maps.app.goo.gl/abc">Find us</a>
<form action="/send" method="post"><input name="email" type="email"><textarea name="message"></textarea><button>Get a free quote</button></form>
<form><input name="s" type="search"></form>
<p>Serving Leeds, Bradford and Wakefield since 1999. Email info@acme.test.</p>
<img src="http://insecure.test/x.png" alt="x">
</body></html>`;

describe("extractPage", () => {
  const page = extractPage(HTML, "https://acme.test/", "acme.test");

  it("reads core metadata", () => {
    expect(page.title).toBe("Emergency Plumbing in Leeds | Acme Plumbing");
    expect(page.metaDescription).toContain("emergency plumbers");
    expect(page.canonicals).toEqual(["https://acme.test/"]);
    expect(page.lang).toBe("en-ZA");
    expect(page.h1s).toEqual(["Emergency Plumbing"]);
    expect(page.og["og:site_name"]).toBe("Acme Plumbing");
  });
  it("distinguishes missing alt from empty alt", () => {
    expect(page.images.filter((i) => i.alt === null)).toHaveLength(1);
    expect(page.images.filter((i) => i.alt === "")).toHaveLength(1);
  });
  it("classifies links and contact methods", () => {
    expect(page.links.find((l) => l.href === "https://acme.test/contact")?.internal).toBe(true);
    expect(page.links.find((l) => l.href === "https://other.com/")?.internal).toBe(false);
    expect(page.telLinks).toEqual(["+441130000000"]);
    expect(page.whatsappLinks).toHaveLength(1);
    expect(page.mapsLinks).toHaveLength(1);
    expect(page.emails).toContain("info@acme.test");
  });
  it("finds enquiry forms but ignores search forms", () => {
    expect(page.forms).toHaveLength(1);
    expect(page.forms[0]).toMatchObject({ hasEmail: true, hasMessage: true, method: "post" });
    expect(page.ctas).toEqual(expect.arrayContaining(["Contact us", "Get a free quote"]));
  });
  it("validates JSON-LD syntax", () => {
    expect(page.jsonLd[0].valid).toBe(true);
    expect(page.jsonLd[0].types).toEqual(["Plumber"]);
    expect(page.jsonLd[1].valid).toBe(false);
  });
  it("detects mixed content on https pages", () => {
    expect(page.mixedContent).toEqual(["http://insecure.test/x.png"]);
  });
  it("flags pages that need JavaScript to render", () => {
    const spa = extractPage(`<html><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script src="/a.js"></script></body></html>`, "https://x.test/", "x.test");
    expect(spa.jsRendering.suspected).toBe(true);
    expect(page.jsRendering.suspected).toBe(false);
  });
});

describe("JSON-LD", () => {
  it("flattens @graph and reports missing @context", () => {
    const block = parseJsonLd(`{"@graph":[{"@type":"Organization","name":"A"},{"@type":"WebSite"}]}`);
    expect(block.types).toEqual(["Organization", "WebSite"]);
    expect(block.error).toBe("Missing @context");
  });
});

describe("near-duplicate detection", () => {
  it("scores identical text as 1 and different text low", () => {
    const text = "We repair boilers and fix leaking pipes across the city every day of the week including weekends and holidays";
    expect(sketchSimilarity(shingleSketch(text), shingleSketch(text))).toBe(1);
    expect(sketchSimilarity(shingleSketch(text), shingleSketch("Completely different words about gardening roses tulips and soil preparation for spring planting season"))).toBeLessThan(0.2);
  });
});

describe("sitemap and robots parsing", () => {
  it("parses urlsets and indexes", () => {
    expect(parseSitemapXml(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.test/</loc></url><url><loc>https://a.test/b</loc></url></urlset>`)).toEqual({ kind: "urlset", locs: ["https://a.test/", "https://a.test/b"] });
    expect(parseSitemapXml(`<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>`).kind).toBe("index");
    expect(parseSitemapXml(`<html><body>404</body></html>`).kind).toBe("invalid");
  });
  it("detects robots.txt that blocks Google", () => {
    const rules = parseRobots("https://a.test/robots.txt", "User-agent: *\nDisallow: /\nSitemap: https://a.test/sitemap.xml", 200);
    expect(rules.info.blocksAllForGoogle).toBe(true);
    expect(rules.info.sitemaps).toEqual(["https://a.test/sitemap.xml"]);
    expect(rules.isAllowed("https://a.test/page")).toBe(false);
    const open = parseRobots("https://a.test/robots.txt", "User-agent: *\nDisallow: /private/", 200);
    expect(open.isAllowed("https://a.test/private/x")).toBe(false);
    expect(open.isAllowed("https://a.test/public")).toBe(true);
  });
});
