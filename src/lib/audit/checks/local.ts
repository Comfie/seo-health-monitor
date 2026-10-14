import { collectLocalSignals, type LocalSignals } from "../local-signals";
import type { AuditContext, CheckStatus, IssueDraft } from "../types";
import { htmlPages, pass, plural, unavailable, type CheckDefinition, type CheckOutcome } from "./helpers";

const cache = new WeakMap<AuditContext, LocalSignals>();
export function localSignals(ctx: AuditContext): LocalSignals {
  if (!cache.has(ctx)) cache.set(ctx, collectLocalSignals(ctx));
  return cache.get(ctx)!;
}

const homeUrl = (ctx: AuditContext) => ctx.homepage?.finalUrl ?? `${ctx.origin}/`;

function externalOnly(reason: string): CheckOutcome {
  return unavailable(reason);
}

const EXTERNAL_TEMPLATE = { title: "", severity: "low" as const, why: "", fix: "", implementation: "", benefit: "", impact: 1, effort: "low" as const, confidence: "low" as const };

export const localChecks: CheckDefinition[] = [
  {
    id: "local-business-name",
    category: "local",
    title: "Business name identifiable",
    description: "A consistent business name is declared (structured data, og:site_name or titles) and visible on the homepage.",
    weight: 3,
    template: {
      title: "Business name not clearly identified",
      severity: "medium",
      why: "Search engines match your website to your Google Business Profile and directory listings partly by business name. A clear, consistent name strengthens that connection.",
      fix: "Show the exact registered business name on the homepage and declare it in Organization/LocalBusiness structured data and og:site_name.",
      implementation: "Add the name in the header/logo alt text and footer, set og:site_name (SEO plugin > Social), and include \"name\" in LocalBusiness JSON-LD.",
      benefit: "Stronger entity match between the website and the business's local listings.",
      impact: 3,
      effort: "low",
      confidence: "medium",
    },
    run(ctx) {
      const s = localSignals(ctx);
      if (!s.businessName) {
        return { status: "fail", score: 0, summary: "No business name could be determined from structured data, og:site_name or page titles.", drafts: [{ checkId: "local-business-name", url: homeUrl(ctx), evidence: ["No Organization/LocalBusiness name, og:site_name, or consistent title brand segment found."] }] };
      }
      if (!s.businessNameVisible) {
        return { status: "warning", score: 0.6, summary: `Business name "${s.businessName.value}" (from ${s.businessName.source}) is not visible in the homepage text.`, drafts: [{ checkId: "local-business-name", url: homeUrl(ctx), discriminator: "not-visible", title: "Business name not visible in homepage text", severity: "low", evidence: [`Detected name: "${s.businessName.value}" (${s.businessName.source})`, "The name was not found in the homepage's visible text (it may only appear inside a logo image)."] }] };
      }
      return pass(`Business name "${s.businessName.value}" found (${s.businessName.source}) and visible on the homepage.`);
    },
  },
  {
    id: "local-phone",
    category: "local",
    title: "Phone number visible",
    description: "A phone number is visible on the homepage and ideally on every page (header/footer).",
    weight: 6,
    template: {
      title: "Phone number not visible",
      severity: "high",
      why: "A visible phone number is a core local trust signal (part of Name-Address-Phone consistency) and the main way service customers make contact.",
      fix: "Display the business phone number in the site header or footer so it appears on every page, matching the number on your Google Business Profile.",
      implementation: "Add the number to the header/footer template as a click-to-call link: <a href=\"tel:+[country code][number]\">[phone number]</a>. Use the same format everywhere.",
      benefit: "More calls and stronger local relevance signals.",
      impact: 4,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const s = localSignals(ctx);
      const pages = htmlPages(ctx);
      if (!pages.length) return unavailable("No pages were fetched successfully.");
      if (!s.phones.length) {
        return { status: "fail", score: 0, summary: `No phone number found on any of ${plural(pages.length, "page")}.`, drafts: [{ checkId: "local-phone", url: homeUrl(ctx), evidence: ["No tel: links or phone-number patterns found in the page text."] }] };
      }
      const homeHas = s.phonePages.includes(homeUrl(ctx));
      const share = s.phonePages.length / pages.length;
      const drafts: IssueDraft[] = [];
      if (!homeHas) drafts.push({ checkId: "local-phone", url: homeUrl(ctx), title: "Phone number not shown on the homepage", evidence: [`Phone found on: ${s.phonePages.slice(0, 3).join(", ")}`] });
      else if (share < 0.8) drafts.push({ checkId: "local-phone", url: homeUrl(ctx), discriminator: "sitewide", title: "Phone number missing from many pages", severity: "low", evidence: [`Phone visible on ${s.phonePages.length} of ${pages.length} pages.`] });
      const score = homeHas ? 0.5 + share / 2 : share / 2;
      const status: CheckStatus = !drafts.length ? "pass" : homeHas ? "warning" : "fail";
      return { status, score, summary: `Phone number(s) ${s.phones.slice(0, 3).join(", ")} visible on ${s.phonePages.length} of ${plural(pages.length, "page")}.`, drafts };
    },
  },
  {
    id: "local-address",
    category: "local",
    title: "Address or service area stated",
    description: "A physical address is published (text or structured data). Service-area businesses that hide their address get a warning, not a failure.",
    weight: 3,
    template: {
      title: "No business address found",
      severity: "low",
      why: "A published address supports local relevance and lets search engines match the site to the Google Business Profile. Service-area businesses may legitimately omit it, but should then clearly state the areas they serve.",
      fix: "If you have a public premises, show the full address in the footer or contact page and in LocalBusiness structured data. If not, list your service areas clearly instead.",
      implementation: "Add an <address> block to the contact page/footer and an \"address\": {\"@type\": \"PostalAddress\", ...} property in LocalBusiness JSON-LD.",
      benefit: "Clearer location signals for local search.",
      impact: 2,
      effort: "low",
      confidence: "medium",
    },
    run(ctx) {
      const s = localSignals(ctx);
      if (s.addresses.length) return pass(`Address found: ${s.addresses[0].value} (${s.addresses[0].source}).`);
      return { status: "warning", score: 0.5, summary: "No street address detected in page text or structured data. Fine for service-area businesses, provided service areas are stated.", drafts: [{ checkId: "local-address", url: homeUrl(ctx), evidence: ["No <address> element, street-address pattern, or PostalAddress structured data found.", "Detection is pattern-based; addresses in images or unusual formats are not detected."] }] };
    },
  },
  {
    id: "local-schema",
    category: "local",
    title: "LocalBusiness structured data",
    description: "LocalBusiness (or a subtype) JSON-LD is present with name, telephone and address/areaServed, plus recommended properties.",
    weight: 6,
    template: {
      title: "LocalBusiness structured data missing",
      severity: "medium",
      why: "LocalBusiness markup states your business name, contact details, location and service area in a machine-readable way that search engines use to understand local businesses.",
      fix: "Add LocalBusiness JSON-LD (using the most specific subtype, e.g. Plumber or HomeAndConstructionBusiness) to the homepage or contact page.",
      implementation:
        'Example:\n<script type="application/ld+json">{"@context":"https://schema.org","@type":"HomeAndConstructionBusiness","name":"Business Name","url":"https://YOUR-DOMAIN/","telephone":"+[country code][number]","address":{"@type":"PostalAddress","addressLocality":"Town","addressRegion":"Province","addressCountry":"[2-letter country code]"},"areaServed":["Town A","Town B"],"openingHours":"Mo-Fr 08:00-17:00","image":"https://YOUR-DOMAIN/logo.png"}</script>\nRank Math/Yoast Local SEO can generate this. Validate with the Rich Results Test.',
      benefit: "Clearer business information for search engines; may support richer local presentation.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const s = localSignals(ctx);
      if (!s.localBusinessSchema.length) {
        return { status: "fail", score: 0, summary: `No LocalBusiness structured data found${s.organizationSchema ? " (Organization markup exists, but it does not describe a local business)" : ""}.`, drafts: [{ checkId: "local-schema", url: homeUrl(ctx), evidence: [s.organizationSchema ? "Organization schema found, but no LocalBusiness type." : "No LocalBusiness or Organization JSON-LD on crawled pages."] }] };
      }
      const best = s.localBusinessSchema[0];
      const required = ["name", "telephone"].filter((k) => !best.item[k]);
      if (!best.item.address && !best.item.areaServed) required.push("address or areaServed");
      const recommended = ["url", "image", "openingHours|openingHoursSpecification", "geo", "areaServed", "priceRange"].filter((k) => !k.split("|").some((kk) => best.item[kk]));
      if (required.length) {
        return { status: "warning", score: 0.5, summary: `${best.types.join("/")} markup found on ${best.url} but missing required properties: ${required.join(", ")}.`, drafts: [{ checkId: "local-schema", url: best.url, discriminator: "incomplete", title: "LocalBusiness structured data is incomplete", evidence: [`Type: ${best.types.join(", ")}`, `Missing required: ${required.join(", ")}`, `Missing recommended: ${recommended.join(", ") || "none"}`] }] };
      }
      if (recommended.length >= 3) {
        return { status: "warning", score: 0.8, summary: `${best.types.join("/")} markup is valid but missing recommended properties: ${recommended.join(", ")}.`, drafts: [{ checkId: "local-schema", url: best.url, discriminator: "recommended", title: "LocalBusiness structured data lacks recommended properties", severity: "low", evidence: [`Missing recommended: ${recommended.join(", ")}`] }] };
      }
      return pass(`${best.types.join("/")} markup found on ${best.url} with core properties.`);
    },
  },
  {
    id: "local-service-areas",
    category: "local",
    title: "Service areas mentioned",
    description: "Heuristic: the site names the towns/regions it serves (text phrases such as \"serving X, Y\" or schema areaServed).",
    weight: 3,
    template: {
      title: "Service areas are not clearly stated",
      severity: "medium",
      why: "Local searchers look for \"[service] near me\" or \"[service] in [town]\". Naming the areas you serve helps search engines and visitors confirm you cover their location.",
      fix: "Add a clear \"Areas we serve\" section listing towns/suburbs, link each to a location page where it makes sense, and add areaServed to LocalBusiness markup.",
      implementation: "Add a footer or homepage section: \"Areas we serve: Town A, Town B, Town C\" with links to dedicated pages for the most important ones.",
      benefit: "Better relevance for location-specific searches.",
      impact: 3,
      effort: "low",
      confidence: "low",
    },
    run(ctx) {
      const s = localSignals(ctx);
      if (s.placeCandidates.length || s.areaServed.length) {
        return pass(`Service-area mentions found${s.areaServed.length ? ` (schema areaServed: ${s.areaServed.slice(0, 5).join(", ")})` : ""}. Detected place names (heuristic): ${s.placeCandidates.slice(0, 10).join(", ")}.`);
      }
      if (s.serviceAreaPages.length) {
        return { status: "warning", score: 0.6, summary: "Service-area wording found, but no specific place names could be identified.", drafts: [{ checkId: "local-service-areas", url: homeUrl(ctx), discriminator: "vague", title: "Service areas mentioned without naming places", severity: "low", evidence: [`Area wording found on: ${s.serviceAreaPages.slice(0, 3).join(", ")}`] }] };
      }
      return { status: "fail", score: 0, summary: "No service-area or location mentions were detected.", drafts: [{ checkId: "local-service-areas", url: homeUrl(ctx), evidence: ["No phrases like \"serving…\", \"areas we serve…\" and no schema areaServed found.", "Detection is heuristic and may miss unusual wording."] }] };
    },
  },
  {
    id: "local-location-pages",
    category: "local",
    title: "Location landing pages",
    description: "Heuristic: dedicated pages target specific towns/regions (URL or title contains a served place, or a /areas/ style path).",
    weight: 4,
    template: {
      title: "No location landing pages found",
      severity: "medium",
      why: "Businesses serving several towns often win more local searches with a genuinely useful page per key area (\"[service] in [town]\").",
      fix: "Create dedicated pages for your most important service areas with unique, locally relevant content, and link them from an \"Areas we serve\" section.",
      implementation:
        "Create /areas/[town]/ pages with: a unique H1 (\"[Service] in [Town]\"), local details (projects completed there, response times, local regulations/conditions), testimonials from that area, and a clear call/WhatsApp CTA. Avoid copy-paste pages that only swap the town name.",
      benefit: "Potential to appear for more town-specific searches; results vary by competition.",
      impact: 3,
      effort: "high",
      confidence: "low",
    },
    run(ctx) {
      const s = localSignals(ctx);
      if (s.locationPages.length) {
        return pass(`${plural(s.locationPages.length, "location page")} detected among crawled pages: ${s.locationPages.slice(0, 5).map((l) => new URL(l.url).pathname).join(", ")}.`);
      }
      return { status: "warning", score: 0.4, summary: `No location landing pages detected among ${plural(htmlPages(ctx).length, "crawled page")} (heuristic; uncrawled pages may exist).`, drafts: [{ checkId: "local-location-pages", url: homeUrl(ctx), evidence: [s.placeCandidates.length ? `Places mentioned without a dedicated page: ${s.placeCandidates.slice(0, 8).join(", ")}` : "No place names detected to match against page URLs/titles.", `Crawl limited to ${ctx.pages.length} pages.`] }] };
    },
  },
  {
    id: "local-maps",
    category: "local",
    title: "Map / Google Business Profile link",
    description: "The site embeds a Google Map or links to the business's Google Maps / Business Profile listing.",
    weight: 2,
    template: {
      title: "No map or Google Business Profile link",
      severity: "low",
      why: "Linking to your Google Business Profile (or embedding its map) helps visitors find directions and reviews and reinforces the website–listing connection.",
      fix: "Add a link to your Google Business Profile (\"Find us on Google\" / \"Read our reviews\") or embed its map on the contact page.",
      implementation: "In Google Maps open your listing > Share > copy link (maps.app.goo.gl/...) or Embed a map > copy the iframe into the contact page.",
      benefit: "Easier directions and review discovery; supports local trust.",
      impact: 1,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const s = localSignals(ctx);
      if (s.mapsLinks.length) return pass(`Google Maps link/embed found: ${s.mapsLinks[0].slice(0, 80)}.`);
      return { status: "warning", score: 0.5, summary: "No Google Maps embed or Business Profile link found.", drafts: [{ checkId: "local-maps", url: homeUrl(ctx), evidence: ["No links or iframes pointing to google.com/maps, maps.app.goo.gl or g.page."] }] };
    },
  },
  {
    id: "local-gbp",
    category: "local",
    title: "Google Business Profile completeness",
    description: "Profile existence, categories, photos and posts. Requires Google Business Profile access.",
    weight: 0,
    template: EXTERNAL_TEMPLATE,
    run: () => externalOnly("Requires access to the Google Business Profile; cannot be verified from a public website crawl."),
  },
  {
    id: "local-reviews",
    category: "local",
    title: "Reviews and ratings",
    description: "Review count, rating and response rate on Google and directories.",
    weight: 0,
    template: EXTERNAL_TEMPLATE,
    run: () => externalOnly("Review data lives on Google and third-party platforms; cannot be verified from a public website crawl."),
  },
  {
    id: "local-citations",
    category: "local",
    title: "NAP consistency across directories",
    description: "Name, address and phone consistency across external directories and citations.",
    weight: 0,
    template: EXTERNAL_TEMPLATE,
    run: () => externalOnly("Requires a citation data source; cannot be verified from a public website crawl."),
  },
  {
    id: "local-rankings",
    category: "local",
    title: "Local pack rankings",
    description: "Positions in Google's map/local pack results.",
    weight: 0,
    template: EXTERNAL_TEMPLATE,
    run: () => externalOnly("Requires rank-tracking or Search Console data; this tool does not simulate rankings."),
  },
];
