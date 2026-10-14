import { sketchSimilarity } from "@/lib/crawler/extract";
import type { IssueDraft } from "../types";
import { htmlPages, indexablePages, isUtilityPage, pass, plural, ratioOutcome, truncate, unavailable, type CheckDefinition, type HtmlPage } from "./helpers";

const STOPWORDS = new Set(
  "a an and are as at be by for from has have home how in is it its of on or our the to us we what when where who why with you your page welcome best top services service company official site website".split(" "),
);

function duplicateGroups(pages: HtmlPage[], key: (p: HtmlPage) => string | null): Map<string, HtmlPage[]> {
  const groups = new Map<string, HtmlPage[]>();
  for (const p of pages) {
    const value = key(p)?.trim().toLowerCase();
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), p]);
  }
  return new Map([...groups].filter(([, list]) => list.length > 1));
}

function confidenceFor(p: HtmlPage) {
  return p.extracted.jsRendering.suspected ? ("low" as const) : undefined;
}

export const onPageChecks: CheckDefinition[] = [
  {
    id: "onpage-title",
    category: "onpage",
    title: "Pages have a title tag",
    description: "Every page has exactly one non-empty <title>.",
    weight: 10,
    template: {
      title: "Missing page title",
      severity: "high",
      why: "The title tag is the clickable headline in search results and one of the strongest on-page relevance signals.",
      fix: "Write a unique, descriptive title (about 30–60 characters) that names the service and location, ending with the brand.",
      implementation:
        "Set the title in the CMS SEO fields (Yoast/Rank Math \"SEO title\") or in the page <head>: <title>[Service] in [Town] | [Brand]</title>. In Next.js export `metadata.title` from the page.",
      benefit: "Better relevance and click-through from search results.",
      impact: 5,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      const drafts: IssueDraft[] = [];
      for (const p of pages) {
        if (!p.extracted.title) drafts.push({ checkId: "onpage-title", url: p.finalUrl, evidence: [p.extracted.titleCount ? "The <title> element is empty." : "No <title> element found."], confidence: confidenceFor(p) });
        else if (p.extracted.titleCount > 1) drafts.push({ checkId: "onpage-title", url: p.finalUrl, discriminator: "multiple", title: "Multiple title tags", severity: "low", evidence: [`${p.extracted.titleCount} <title> elements found; search engines use only one.`] });
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have a missing or duplicated <title> element.` : `All ${t} pages have a title.`));
    },
  },
  {
    id: "onpage-title-length",
    category: "onpage",
    title: "Title length",
    description: "Titles are roughly 30–60 characters so they are descriptive and not truncated in results.",
    weight: 3,
    template: {
      title: "Title length outside recommended range",
      severity: "low",
      why: "Very short titles waste the chance to describe the page; very long titles are cut off in search results, hiding the key message.",
      fix: "Rewrite the title to roughly 30–60 characters with the main service and location first.",
      implementation: "Edit the SEO title field for the page. Lead with the primary keyword phrase, then a separator and the brand name.",
      benefit: "Clearer search listings and potentially better click-through.",
      impact: 2,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx).filter((p) => p.extracted.title);
      const drafts = pages
        .filter((p) => p.extracted.title!.length < 30 || p.extracted.title!.length > 60)
        .map((p) => ({
          checkId: "onpage-title-length",
          url: p.finalUrl,
          title: p.extracted.title!.length < 30 ? "Title is too short" : "Title is too long",
          evidence: [`Title (${p.extracted.title!.length} chars): "${p.extracted.title}"`],
        }));
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "title")} of ${t} are shorter than 30 or longer than 60 characters.` : `All ${t} titles are 30–60 characters.`));
    },
  },
  {
    id: "onpage-title-duplicate",
    category: "onpage",
    title: "Unique titles",
    description: "No two indexable pages share the same title.",
    weight: 5,
    template: {
      title: "Duplicate page title",
      severity: "medium",
      why: "When several pages share a title, search engines struggle to tell which one to show, and the pages compete with each other.",
      fix: "Give each page a unique title that reflects its specific topic, service or location.",
      implementation: "Edit the SEO title of each page listed in the evidence. If the titles come from a template, include the page name variable (e.g. %%title%% in Yoast).",
      benefit: "Clearer targeting so the right page ranks for the right search.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = indexablePages(ctx);
      const groups = duplicateGroups(pages, (p) => p.extracted.title);
      const drafts: IssueDraft[] = [];
      for (const [title, list] of groups) {
        for (const p of list) {
          drafts.push({ checkId: "onpage-title-duplicate", url: p.finalUrl, evidence: [`Title: "${truncate(title, 100)}"`, ...list.filter((o) => o !== p).map((o) => `Also used on: ${o.finalUrl}`)] });
        }
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} share a title with another page.` : `All ${t} indexable pages have unique titles.`));
    },
  },
  {
    id: "onpage-meta-description",
    category: "onpage",
    title: "Pages have a meta description",
    description: "Every indexable page has a non-empty meta description.",
    weight: 6,
    template: {
      title: "Missing meta description",
      severity: "medium",
      why: "The meta description is often used as the snippet under your search result. Without one, search engines pick arbitrary page text, which may not encourage clicks.",
      fix: "Write a unique 70–160 character description summarising the page and including a call to action.",
      implementation:
        "Fill in the meta description field in the SEO plugin, or add <meta name=\"description\" content=\"...\"> to the <head>. In Next.js export `metadata.description`.",
      benefit: "More compelling search snippets and potentially more clicks.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = indexablePages(ctx);
      const drafts = pages
        .filter((p) => !p.extracted.metaDescription)
        .map((p) => ({ checkId: "onpage-meta-description", url: p.finalUrl, evidence: [p.extracted.metaDescriptionCount ? "Meta description tag is empty." : "No <meta name=\"description\"> found."], confidence: confidenceFor(p) }));
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have no meta description.` : `All ${t} indexable pages have a meta description.`));
    },
  },
  {
    id: "onpage-meta-description-length",
    category: "onpage",
    title: "Meta description length",
    description: "Meta descriptions are roughly 70–160 characters.",
    weight: 2,
    template: {
      title: "Meta description length outside recommended range",
      severity: "low",
      why: "Short descriptions under-sell the page; long ones are truncated in search results.",
      fix: "Rewrite the description to about 70–160 characters.",
      implementation: "Edit the meta description field for the page in the CMS or template.",
      benefit: "Complete, persuasive search snippets.",
      impact: 1,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = indexablePages(ctx).filter((p) => p.extracted.metaDescription);
      const drafts = pages
        .filter((p) => p.extracted.metaDescription!.length < 70 || p.extracted.metaDescription!.length > 160)
        .map((p) => ({
          checkId: "onpage-meta-description-length",
          url: p.finalUrl,
          title: p.extracted.metaDescription!.length < 70 ? "Meta description is too short" : "Meta description is too long",
          evidence: [`Description (${p.extracted.metaDescription!.length} chars): "${truncate(p.extracted.metaDescription!, 200)}"`],
        }));
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "description")} of ${t} are outside 70–160 characters.` : `All ${t} descriptions are 70–160 characters.`));
    },
  },
  {
    id: "onpage-meta-description-duplicate",
    category: "onpage",
    title: "Unique meta descriptions",
    description: "No two indexable pages share the same meta description.",
    weight: 3,
    template: {
      title: "Duplicate meta description",
      severity: "low",
      why: "Identical descriptions make different pages look the same in search results and suggest templated, low-effort content.",
      fix: "Write a specific description for each page.",
      implementation: "Edit the meta description for each listed page so it summarises that page's unique content.",
      benefit: "Distinct, relevant snippets for each page.",
      impact: 2,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = indexablePages(ctx);
      const groups = duplicateGroups(pages, (p) => p.extracted.metaDescription);
      const drafts: IssueDraft[] = [];
      for (const [desc, list] of groups) {
        for (const p of list) {
          drafts.push({ checkId: "onpage-meta-description-duplicate", url: p.finalUrl, evidence: [`Description: "${truncate(desc, 120)}"`, ...list.filter((o) => o !== p).map((o) => `Also used on: ${o.finalUrl}`)] });
        }
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} share a meta description.` : `No duplicate meta descriptions across ${t} pages.`));
    },
  },
  {
    id: "onpage-h1",
    category: "onpage",
    title: "One clear H1 per page",
    description: "Each page has exactly one non-empty H1 heading.",
    weight: 6,
    template: {
      title: "Missing H1 heading",
      severity: "medium",
      why: "The H1 is the main on-page headline. It tells visitors and search engines what the page is about.",
      fix: "Add a single H1 that states the page topic (e.g. \"[Service] in [Town]\").",
      implementation:
        "Make the page's main heading an <h1> element (in the block editor choose Heading > H1). Make sure the theme doesn't output the site name as an H1 on every page, and demote other H1s to H2.",
      benefit: "Clearer topical relevance and readability.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      const drafts: IssueDraft[] = [];
      for (const p of pages) {
        const h1s = p.extracted.h1s.filter(Boolean);
        if (h1s.length === 0) drafts.push({ checkId: "onpage-h1", url: p.finalUrl, evidence: [p.extracted.h1s.length ? "H1 element is empty." : "No <h1> element found."], confidence: confidenceFor(p) });
        else if (h1s.length > 1) drafts.push({ checkId: "onpage-h1", url: p.finalUrl, discriminator: "multiple", title: "Multiple H1 headings", severity: "low", evidence: h1s.slice(0, 6).map((h) => `H1: "${truncate(h, 100)}"`) });
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have a missing or multiple H1.` : `All ${t} pages have exactly one H1.`));
    },
  },
  {
    id: "onpage-heading-hierarchy",
    category: "onpage",
    title: "Logical heading hierarchy",
    description: "Headings do not skip levels (e.g. H2 straight to H4).",
    weight: 2,
    template: {
      title: "Heading levels are skipped",
      severity: "low",
      why: "A logical outline (H1 > H2 > H3) helps screen-reader users and makes page structure clearer to search engines.",
      fix: "Adjust heading levels so they nest without skipping (use CSS for visual size, not heading level).",
      implementation: "Change the heading block levels in the editor, or update the theme templates so widgets/footers don't use H4–H6 out of sequence.",
      benefit: "Better accessibility and clearer content structure.",
      impact: 1,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      const drafts: IssueDraft[] = [];
      for (const p of pages) {
        const skips: string[] = [];
        let prev = 0;
        for (const h of p.extracted.headings) {
          if (prev && h.level > prev + 1) skips.push(`H${prev} → H${h.level} ("${truncate(h.text, 60)}")`);
          prev = h.level;
        }
        if (skips.length) drafts.push({ checkId: "onpage-heading-hierarchy", url: p.finalUrl, evidence: skips.slice(0, 6) });
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} skip heading levels.` : `Headings nest logically on all ${t} pages.`));
    },
  },
  {
    id: "onpage-image-alt",
    category: "onpage",
    title: "Images have alt text",
    description: "<img> elements carry an alt attribute (empty alt is allowed for decorative images).",
    weight: 4,
    template: {
      title: "Images missing alt attributes",
      severity: "medium",
      why: "Alt text describes images to visually impaired visitors and to search engines (including Google Images). Missing alt attributes are an accessibility failure.",
      fix: "Add descriptive alt text to meaningful images, and alt=\"\" to purely decorative ones.",
      implementation:
        "In the WordPress Media Library fill in \"Alternative Text\" for each image listed. In code, add alt=\"Technician repairing a geyser in a customer kitchen\" to the <img>. Describe what the image shows; avoid keyword stuffing.",
      benefit: "Better accessibility and image search visibility.",
      impact: 2,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx).filter((p) => p.extracted.images.length);
      const drafts = pages
        .map((p) => ({ p, missing: p.extracted.images.filter((i) => i.alt === null) }))
        .filter(({ missing }) => missing.length)
        .map(({ p, missing }) => ({
          checkId: "onpage-image-alt",
          url: p.finalUrl,
          title: `${plural(missing.length, "image")} missing alt attribute`,
          severity: missing.length >= 5 ? ("medium" as const) : ("low" as const),
          evidence: missing.slice(0, 10).map((i) => `Image: ${truncate(i.src, 150)}`),
        }));
      if (!pages.length) return unavailable("No images were found on crawled pages.");
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} with images have images without alt attributes.` : `All images on ${t} pages have alt attributes.`));
    },
  },
  {
    id: "onpage-internal-links",
    category: "onpage",
    title: "Healthy internal linking",
    description: "Pages link to at least 3 other internal pages and are linked from at least one other crawled page.",
    weight: 4,
    template: {
      title: "Weak internal linking",
      severity: "low",
      why: "Internal links help visitors find related services and help search engines discover pages and understand which ones matter most.",
      fix: "Link to this page from relevant pages (menus, service lists, related-content blocks) using descriptive anchor text, and add contextual links from it to related pages.",
      implementation:
        "Add the page to the main or footer navigation if it is a key service/location page, and add in-content links such as \"Learn more about <a href=\"/your-service/\">your service</a>\".",
      benefit: "Better discovery and distribution of ranking strength across the site.",
      impact: 2,
      effort: "low",
      confidence: "medium",
    },
    run(ctx) {
      const pages = indexablePages(ctx);
      const drafts: IssueDraft[] = [];
      for (const p of pages) {
        const outlinks = new Set(p.extracted.links.filter((l) => l.internal && l.href !== p.finalUrl).map((l) => l.href));
        const inbound = (ctx.inlinks[p.finalUrl] ?? ctx.inlinks[p.url] ?? []).filter((s) => s !== p.finalUrl);
        if (p.depth > 0 && inbound.length === 0) {
          drafts.push({ checkId: "onpage-internal-links", url: p.finalUrl, discriminator: "orphan", title: "Page has no internal links pointing to it", severity: "medium", evidence: [`Found via ${p.source === "sitemap" ? "the XML sitemap" : "a link"}, but none of the ${plural(htmlPages(ctx).length, "crawled page")} link to it.`, "The crawl is limited, so links from uncrawled pages may exist."] });
        } else if (outlinks.size < 3) {
          drafts.push({ checkId: "onpage-internal-links", url: p.finalUrl, discriminator: "few-outlinks", title: "Page has very few internal links", evidence: [`Only ${plural(outlinks.size, "internal link")} found on the page.`] });
        }
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have weak internal linking.` : `All ${t} pages are internally linked.`));
    },
  },
  {
    id: "onpage-open-graph",
    category: "onpage",
    title: "Open Graph metadata",
    description: "Pages define og:title, og:description and og:image for social sharing previews.",
    weight: 3,
    template: {
      title: "Incomplete Open Graph tags",
      severity: "low",
      why: "Open Graph tags control how the page looks when shared on Facebook, WhatsApp, LinkedIn and similar apps. Without them, previews may be blank or pick the wrong image.",
      fix: "Add og:title, og:description, og:image (at least 1200×630px) and og:url to each page.",
      implementation:
        "Enable social metadata in Yoast/Rank Math and set a default share image, or add <meta property=\"og:image\" content=\"https://YOUR-DOMAIN/share.jpg\"> etc. In Next.js use `metadata.openGraph`.",
      benefit: "More attractive, clickable link previews when people share the site.",
      impact: 1,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = indexablePages(ctx);
      const drafts = pages
        .map((p) => ({ p, missing: ["og:title", "og:description", "og:image"].filter((k) => !p.extracted.og[k]) }))
        .filter(({ missing }) => missing.length)
        .map(({ p, missing }) => ({ checkId: "onpage-open-graph", url: p.finalUrl, evidence: [`Missing: ${missing.join(", ")}`] }));
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} lack complete Open Graph tags.` : `All ${t} pages have core Open Graph tags.`));
    },
  },
  {
    id: "onpage-thin-content",
    category: "onpage",
    title: "Substantial page content",
    description: "Indexable content pages contain at least ~300 words of server-rendered text (utility pages such as contact/privacy are excluded).",
    weight: 5,
    template: {
      title: "Potentially thin content",
      severity: "medium",
      why: "Pages with very little text give search engines little to understand or rank, and give visitors little reason to enquire.",
      fix: "Expand the page with genuinely useful, specific content: what the service involves, process, pricing factors, areas served, FAQs and proof (photos, reviews).",
      implementation:
        "Add sections with H2 headings covering common customer questions. Aim for content that fully answers the searcher's question rather than a word count; 300+ words is a rough lower bound for service pages.",
      benefit: "Greater relevance for more search queries and better-informed visitors.",
      impact: 3,
      effort: "medium",
      confidence: "medium",
    },
    run(ctx) {
      const pages = indexablePages(ctx).filter((p) => !isUtilityPage(p.finalUrl));
      const drafts = pages
        .filter((p) => p.extracted.wordCount < 300)
        .map((p) => ({
          checkId: "onpage-thin-content",
          url: p.finalUrl,
          confidence: p.extracted.jsRendering.suspected ? ("low" as const) : undefined,
          evidence: [`${p.extracted.wordCount} words of visible text in the server HTML (including navigation and footer).`, ...(p.extracted.jsRendering.suspected ? ["Content may be rendered by JavaScript, so the real word count could be higher."] : [])],
        }));
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have under 300 words.` : `All ${t} content pages have 300+ words.`));
    },
  },
  {
    id: "onpage-duplicate-content",
    category: "onpage",
    title: "No duplicate pages",
    description: "Indexable pages are not identical or near-identical to each other (≥85% estimated shingle similarity).",
    weight: 4,
    template: {
      title: "Duplicate or near-duplicate content",
      severity: "medium",
      why: "Near-identical pages compete with each other and may be filtered out of results. Location pages that only swap the town name are a common cause.",
      fix: "Make each page substantially unique, or consolidate duplicates with a 301 redirect or canonical tag pointing to the main version.",
      implementation:
        "For location pages, add location-specific details (local projects, area-specific conditions, travel times, local testimonials). For true duplicates, keep the best page and redirect the others.",
      benefit: "Each page gets a fair chance to rank for its own topic.",
      impact: 3,
      effort: "medium",
      confidence: "medium",
    },
    run(ctx) {
      const pages = indexablePages(ctx).filter((p) => p.extracted.wordCount >= 50);
      const drafts: IssueDraft[] = [];
      const flagged = new Set<string>();
      for (let i = 0; i < pages.length; i++) {
        for (let j = i + 1; j < pages.length; j++) {
          const a = pages[i];
          const b = pages[j];
          const exact = a.extracted.contentHash === b.extracted.contentHash;
          const sim = exact ? 1 : sketchSimilarity(a.extracted.shingles, b.extracted.shingles);
          if (sim < 0.85) continue;
          for (const [p, other] of [[a, b], [b, a]] as const) {
            if (flagged.has(`${p.finalUrl}|${other.finalUrl}`)) continue;
            flagged.add(`${p.finalUrl}|${other.finalUrl}`);
            drafts.push({ checkId: "onpage-duplicate-content", url: p.finalUrl, discriminator: other.finalUrl, title: exact ? "Identical content on another page" : "Near-duplicate content", evidence: [`${Math.round(sim * 100)}% similar to ${other.finalUrl}`] });
          }
        }
      }
      if (pages.length < 2) return unavailable("Fewer than two content pages were available to compare.");
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} are duplicates or near-duplicates of another page.` : `No duplicate content found across ${t} pages.`));
    },
  },
  {
    id: "onpage-content-relevance",
    category: "onpage",
    title: "Title matches page content",
    description: "Heuristic: most meaningful words in the title also appear in the H1 or body text.",
    weight: 3,
    template: {
      title: "Title and page content may not match",
      severity: "low",
      why: "When the title promises something the page content doesn't discuss, search engines may judge the page less relevant and visitors may bounce.",
      fix: "Align the title, H1 and opening paragraph around the same main topic and phrasing.",
      implementation: "Either rewrite the title to describe what the page actually covers, or add content that addresses the title's topic (mention the key terms naturally in the H1 and first paragraph).",
      benefit: "Stronger, clearer topical relevance.",
      impact: 2,
      effort: "low",
      confidence: "low",
    },
    run(ctx) {
      const pages = indexablePages(ctx).filter((p) => p.extracted.title && p.extracted.wordCount >= 50);
      const drafts: IssueDraft[] = [];
      for (const p of pages) {
        const titleMain = p.extracted.title!.split(/\s[|–—-]\s/)[0];
        const terms = [...new Set((titleMain.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w)))];
        if (terms.length < 2) continue;
        const haystack = `${p.extracted.h1s.join(" ")} ${p.extracted.bodyText}`.toLowerCase();
        const missing = terms.filter((t) => !haystack.includes(t.slice(0, Math.max(4, t.length - 2))));
        if (missing.length / terms.length > 0.5) {
          drafts.push({ checkId: "onpage-content-relevance", url: p.finalUrl, evidence: [`Title: "${p.extracted.title}"`, `Title terms not found in H1/body: ${missing.join(", ")}`] });
        }
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have titles whose key terms rarely appear in the content.` : `Title terms appear in the content on all ${t} pages checked.`));
    },
  },
  {
    id: "onpage-lang",
    category: "onpage",
    title: "Language declared",
    description: "The <html> element declares the page language.",
    weight: 1,
    template: {
      title: "Page language not declared",
      severity: "low",
      why: "The lang attribute helps screen readers pronounce content correctly and helps search engines serve the page to the right audience.",
      fix: "Add a lang attribute to the <html> element, e.g. <html lang=\"en-ZA\">.",
      implementation: "Set it in the theme's header template (WordPress sets it from Settings > General > Site Language) or the root layout.",
      benefit: "Better accessibility and language targeting.",
      impact: 1,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      const drafts = pages.filter((p) => !p.extracted.lang).map((p) => ({ checkId: "onpage-lang", url: p.finalUrl, evidence: ["<html> has no lang attribute."] }));
      if (pages.length && drafts.length === 0) return pass(`All ${pages.length} pages declare a language (${pages[0].extracted.lang}).`);
      return ratioOutcome(pages.length, drafts, (f, t) => `${plural(f, "page")} of ${t} lack a lang attribute.`);
    },
  },
];
