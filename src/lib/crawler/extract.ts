import crypto from "node:crypto";
import * as cheerio from "cheerio";
import type { ExtractedPage, FormInfo, JsonLdBlock, LinkInfo } from "@/lib/audit/types";
import { isSameSite, resolveHref } from "./url";

const CTA_PATTERN =
  /\b(call(\s+(us|now|today))?|contact(\s+us)?|get\s+(a\s+|your\s+)?(free\s+)?(quote|estimate|price)|request\s+(a\s+)?(quote|call|callback|estimate)|book(\s+(now|online|a|an))?|get\s+in\s+touch|enquire|inquire|whatsapp|free\s+(quote|estimate|assessment|consultation|site\s+visit)|schedule|hire\s+us|get\s+started|order\s+now|buy\s+now|apply\s+now|chat\s+with\s+us|speak\s+to)\b/i;

const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?\(?0?\d{2,4}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const STREET_PATTERN =
  /\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][a-zA-Z']+\s){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Close|Crescent|Cres|Place|Pl|Highway|Hwy|Square|Sq|Parkway|Pkwy)\b\.?/g;
const MAPS_PATTERN = /(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page\/|business\.google\.com)/i;
const FORM_PROVIDERS: [string, RegExp][] = [
  ["Typeform", /typeform\.com/i],
  ["Jotform", /jotform\.(com|us)/i],
  ["HubSpot", /hsforms\.(com|net)|hubspot\.com\/.*forms/i],
  ["Google Forms", /docs\.google\.com\/forms|forms\.gle/i],
  ["Formstack", /formstack\.com/i],
  ["Cognito Forms", /cognitoforms\.com/i],
  ["Tally", /tally\.so/i],
  ["Calendly", /calendly\.com/i],
  ["Zoho Forms", /forms\.zohopublic|zoho\.com\/forms/i],
  ["Wufoo", /wufoo\.com/i],
];
const SPA_ROOTS = "#root, #__next, #app, #___gatsby, #__nuxt, #svelte, [data-reactroot], app-root, [ng-version]";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Bottom-k MinHash sketch of 5-word shingles. */
export function shingleSketch(text: string, k = 256): number[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const hashes = new Set<number>();
  for (let i = 0; i + 5 <= words.length; i++) hashes.add(fnv1a(words.slice(i, i + 5).join(" ")));
  return [...hashes].sort((a, b) => a - b).slice(0, k);
}

/** Estimated Jaccard similarity of two bottom-k sketches. */
export function sketchSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const k = Math.min(256, Math.max(a.length, b.length));
  const union = [...new Set([...a, ...b])].sort((x, y) => x - y).slice(0, k);
  const setA = new Set(a);
  const setB = new Set(b);
  const both = union.filter((h) => setA.has(h) && setB.has(h)).length;
  return both / union.length;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function flattenJsonLd(node: unknown, out: Record<string, unknown>[]): void {
  for (const item of toArray(node)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) flattenJsonLd(obj["@graph"], out);
    if (obj["@type"]) out.push(obj);
  }
}

export function parseJsonLd(raw: string): JsonLdBlock {
  const text = raw
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "")
    .trim();
  try {
    const parsed = JSON.parse(text);
    const items: Record<string, unknown>[] = [];
    flattenJsonLd(parsed, items);
    const types = items.flatMap((i) => toArray(i["@type"] as string | string[])).map(String);
    const missingContext = toArray(parsed).some(
      (p) => p && typeof p === "object" && !(p as Record<string, unknown>)["@context"],
    );
    return {
      valid: true,
      error: missingContext ? "Missing @context" : types.length === 0 ? "No @type found" : undefined,
      types,
      items: items.slice(0, 30),
    };
  } catch (err) {
    return { valid: false, error: (err as Error).message.slice(0, 200), types: [], items: [] };
  }
}

function extractPhones(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PHONE_PATTERN)) {
    const value = match[0].trim();
    const digits = value.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 13) continue;
    if (!/^(\+|0|\()/.test(value)) continue;
    if (/^(19|20)\d{2}/.test(digits) && !value.startsWith("+")) continue; // looks like a year/date
    found.add(value);
  }
  return [...found].slice(0, 10);
}

export function extractPage(html: string, pageUrl: string, siteHost: string): ExtractedPage {
  const $ = cheerio.load(html);
  const head = $("head");

  const titles = $("title");
  const title = titles.length ? clean(titles.first().text()) || null : null;
  const metaDescriptions = $('meta[name="description" i]');
  const metaDescription = metaDescriptions.length ? clean(metaDescriptions.first().attr("content") ?? "") : null;
  const robotsMeta = $('meta[name="robots" i], meta[name="googlebot" i]')
    .map((_, el) => clean($(el).attr("content") ?? ""))
    .get()
    .filter(Boolean);

  const canonicals = $('link[rel~="canonical" i]')
    .map((_, el) => {
      const href = $(el).attr("href");
      if (!href) return null;
      try {
        return new URL(href, pageUrl).toString();
      } catch {
        return null;
      }
    })
    .get()
    .filter((v): v is string => Boolean(v));

  const headings = $("h1, h2, h3, h4, h5, h6")
    .map((_, el) => ({ level: Number(el.tagName.slice(1)), text: clean($(el).text()).slice(0, 200) }))
    .get();

  const images = $("img")
    .map((_, el) => {
      const $el = $(el);
      const src = $el.attr("src") ?? $el.attr("data-src") ?? $el.attr("data-lazy-src") ?? "";
      const alt = $el.attr("alt");
      return { src: src.slice(0, 500), alt: alt === undefined ? null : clean(alt) };
    })
    .get()
    .filter((img) => img.src && !img.src.startsWith("data:image/gif"));

  const links: LinkInfo[] = [];
  const telLinks = new Set<string>();
  const whatsappLinks = new Set<string>();
  const mailtoLinks = new Set<string>();
  const mapsLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = ($el.attr("href") ?? "").trim();
    if (/^tel:/i.test(href)) telLinks.add(href.slice(4).trim());
    else if (/^mailto:/i.test(href)) mailtoLinks.add(href.slice(7).split("?")[0].trim());
    else if (/^whatsapp:|wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com/i.test(href)) whatsappLinks.add(href);
    if (MAPS_PATTERN.test(href)) mapsLinks.add(href);
    const resolved = resolveHref(href, pageUrl);
    if (!resolved) return;
    const text = clean($el.text()) || clean($el.find("img").attr("alt") ?? "") || clean($el.attr("aria-label") ?? "");
    links.push({
      href: resolved,
      text: text.slice(0, 120),
      internal: isSameSite(resolved, siteHost),
      nofollow: /\bnofollow\b/i.test($el.attr("rel") ?? ""),
    });
  });
  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (MAPS_PATTERN.test(src)) mapsLinks.add(src);
  });

  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  $("meta[property], meta[name]").each((_, el) => {
    const key = ($(el).attr("property") ?? $(el).attr("name") ?? "").toLowerCase();
    const content = clean($(el).attr("content") ?? "");
    if (key.startsWith("og:") && !(key in og)) og[key] = content.slice(0, 500);
    if (key.startsWith("twitter:") && !(key in twitter)) twitter[key] = content.slice(0, 500);
  });

  const jsonLd = $('script[type="application/ld+json" i]')
    .map((_, el) => parseJsonLd($(el).text()))
    .get();
  const microdataTypes = [
    ...new Set(
      $("[itemtype]")
        .map((_, el) => ($(el).attr("itemtype") ?? "").split("/").pop() ?? "")
        .get()
        .filter(Boolean),
    ),
  ];

  const forms: FormInfo[] = [];
  $("form").each((_, el) => {
    const $form = $(el);
    const fields = $form.find("input, textarea, select");
    const fieldTypes: string[] = [];
    let hasEmail = false;
    let hasPhone = false;
    let hasMessage = false;
    let searchOnly = true;
    fields.each((__, f) => {
      const $f = $(f);
      const tag = f.tagName.toLowerCase();
      const type = tag === "input" ? ($f.attr("type") ?? "text").toLowerCase() : tag;
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;
      const name = `${$f.attr("name") ?? ""} ${$f.attr("id") ?? ""} ${$f.attr("placeholder") ?? ""}`.toLowerCase();
      fieldTypes.push(type);
      if (type === "email" || /e-?mail/.test(name)) hasEmail = true;
      if (type === "tel" || /phone|tel|mobile|cell|contact.?number/.test(name)) hasPhone = true;
      if (type === "textarea" || /message|enquiry|inquiry|comment/.test(name)) hasMessage = true;
      if (!(type === "search" || /^(s|q|search|query)\b/.test(($f.attr("name") ?? "").toLowerCase()))) searchOnly = false;
    });
    if (fieldTypes.length === 0 || searchOnly) return;
    const submit = $form.find('button, input[type="submit"]').first();
    forms.push({
      action: $form.attr("action") ?? null,
      method: ($form.attr("method") ?? "get").toLowerCase(),
      fieldTypes,
      hasEmail,
      hasPhone,
      hasMessage,
      submitText: clean(submit.text() || submit.attr("value") || "") || null,
    });
  });

  const embeddedFormProviders = new Set<string>();
  $("iframe[src], script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    for (const [name, pattern] of FORM_PROVIDERS) if (pattern.test(src)) embeddedFormProviders.add(name);
  });

  const ctas = new Set<string>();
  $('a, button, input[type="submit"], input[type="button"]').each((_, el) => {
    const $el = $(el);
    const text = clean($el.text() || $el.attr("value") || $el.attr("aria-label") || "");
    if (text && text.length <= 60 && CTA_PATTERN.test(text)) ctas.add(text);
  });

  const isHttps = pageUrl.startsWith("https:");
  const mixedContent = isHttps
    ? $("img[src], script[src], iframe[src], source[src], video[src], audio[src], link[rel~='stylesheet'][href]")
        .map((_, el) => $(el).attr("src") ?? $(el).attr("href") ?? "")
        .get()
        .filter((src) => /^http:\/\//i.test(src))
        .slice(0, 20)
    : [];

  const hreflang = $('link[rel="alternate" i][hreflang]')
    .map((_, el) => ({ lang: $(el).attr("hreflang") ?? "", href: $(el).attr("href") ?? "" }))
    .get();

  const scriptCount = $("script[src]").length + $("script:not([src])").length;
  const noscriptText = clean($("noscript").text());
  const spaRoot = $(SPA_ROOTS).first();
  const spaRootEmpty = spaRoot.length > 0 && clean(spaRoot.text()).length < 50;

  const addressSnippets = new Set<string>();
  $("address").each((_, el) => {
    const text = clean($(el).text());
    if (text) addressSnippets.add(text.slice(0, 200));
  });

  // Visible text: drop non-content elements before reading the body text.
  const body = $("body").clone();
  body.find("script, style, noscript, template, svg, iframe, canvas").remove();
  const bodyText = clean(body.text());
  const words = bodyText.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const wordCount = words.length;

  for (const match of bodyText.matchAll(STREET_PATTERN)) addressSnippets.add(match[0]);

  const reasons: string[] = [];
  if (wordCount < 80 && spaRootEmpty) reasons.push("An empty JavaScript app container was found and the page has very little server-rendered text.");
  if (wordCount < 80 && /javascript/i.test(noscriptText) && /enable|requires|turn on|need/i.test(noscriptText)) {
    reasons.push("The page shows a <noscript> notice that JavaScript is required.");
  }
  if (wordCount < 30 && scriptCount >= 5) reasons.push(`Only ${wordCount} words of server-rendered text alongside ${scriptCount} scripts.`);

  const emails = new Set<string>(mailtoLinks);
  for (const match of bodyText.matchAll(EMAIL_PATTERN)) {
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(match[0])) emails.add(match[0].toLowerCase());
  }

  return {
    title,
    titleCount: titles.length,
    metaDescription,
    metaDescriptionCount: metaDescriptions.length,
    metaRobots: robotsMeta.length ? robotsMeta.join(", ") : null,
    canonicals,
    lang: $("html").attr("lang")?.trim() || null,
    viewport: head.find('meta[name="viewport" i]').attr("content") ?? $('meta[name="viewport" i]').attr("content") ?? null,
    headings,
    h1s: headings.filter((h) => h.level === 1).map((h) => h.text),
    images: images.slice(0, 200),
    links: links.slice(0, 500),
    og,
    twitter,
    jsonLd,
    microdataTypes,
    wordCount,
    contentHash: crypto.createHash("sha1").update(bodyText.toLowerCase()).digest("hex"),
    shingles: shingleSketch(bodyText),
    bodyText: bodyText.slice(0, 8000),
    telLinks: [...telLinks].slice(0, 10),
    whatsappLinks: [...whatsappLinks].slice(0, 10),
    mailtoLinks: [...mailtoLinks].slice(0, 10),
    phoneNumbers: extractPhones(bodyText),
    emails: [...emails].slice(0, 10),
    forms,
    embeddedFormProviders: [...embeddedFormProviders],
    ctas: [...ctas].slice(0, 20),
    mixedContent,
    mapsLinks: [...mapsLinks].slice(0, 5),
    addressSnippets: [...addressSnippets].slice(0, 5),
    hreflang,
    jsRendering: { suspected: reasons.length > 0, reasons },
    scriptCount,
  };
}
