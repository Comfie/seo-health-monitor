import { buildActionPlan, categoryLabel, type ActionItem, type IssueLike } from "./action-plan";

/**
 * "Fix with Claude": turns verified audit findings into a self-contained,
 * implementation-ready prompt for Claude Code (or any developer).
 * Deterministic: everything in it comes from the stored audit.
 */

export type FixArea = "head" | "hosting" | "content" | "crawl-files" | "structured-data" | "performance";

const AREA_BY_CHECK: Record<string, FixArea> = {
  "tech-https": "hosting",
  "tech-http-redirect": "hosting",
  "tech-host-canonical": "hosting",
  "tech-status-codes": "hosting",
  "tech-redirects": "content",
  "tech-broken-links": "content",
  "tech-soft-404": "hosting",
  "tech-response-time": "performance",
  "tech-robots": "crawl-files",
  "tech-sitemap": "crawl-files",
  "tech-indexability": "head",
  "tech-canonical": "head",
  "tech-mixed-content": "content",
  "tech-structured-data": "structured-data",
  "tech-js-rendering": "performance",
  "local-schema": "structured-data",
  "conv-mobile-viewport": "head",
  "onpage-lang": "head",
  "onpage-open-graph": "head",
};

export function areaFor(checkId: string): FixArea {
  if (AREA_BY_CHECK[checkId]) return AREA_BY_CHECK[checkId];
  if (checkId.startsWith("perf-")) return "performance";
  if (/onpage-(title|meta-description)/.test(checkId)) return "head";
  return "content";
}

const AREA_LABEL: Record<FixArea, string> = {
  head: "page <head> metadata",
  hosting: "hosting / server / CDN configuration",
  content: "page content and templates",
  "crawl-files": "robots.txt / sitemap generation",
  "structured-data": "JSON-LD structured data",
  performance: "front-end performance",
};

/** Where each kind of fix usually lives, per detected platform. */
const PLATFORM_HINTS: Record<string, Partial<Record<FixArea, string>>> = {
  Astro: {
    head: "the shared layout's <head> (src/layouts/*.astro) or a SEO/Head component; per-page values usually come from frontmatter props",
    hosting: "the host's redirect config (e.g. netlify.toml / _redirects, vercel.json, Cloudflare Pages _redirects or a Cloudflare Redirect Rule), not Astro code",
    content: "the page files in src/pages/ and shared components in src/components/",
    "crawl-files": "@astrojs/sitemap in astro.config.* and public/robots.txt",
    "structured-data": "a <script type=\"application/ld+json\" set:html={JSON.stringify(schema)} /> in the layout or page",
    performance: "astro:assets <Image /> for images, client:* directives for hydrated islands, and astro.config.* build options",
  },
  "Next.js": {
    head: "the `metadata`/`generateMetadata` export of the route's page.tsx or layout.tsx (App Router) or next/head (Pages Router)",
    hosting: "next.config.* `redirects()` or the hosting platform's redirect/domain settings",
    content: "the route components under app/ (or pages/) and shared components",
    "crawl-files": "app/robots.ts and app/sitemap.ts (or files in public/)",
    "structured-data": "a <script type=\"application/ld+json\"> rendered in the page or layout",
    performance: "next/image, next/font, dynamic imports and third-party script loading (next/script strategy)",
  },
  WordPress: {
    head: "the SEO plugin's per-page fields (Yoast/Rank Math) or the theme's header.php",
    hosting: "the host/CDN settings or .htaccess / Nginx server block; a redirect plugin for page-level redirects",
    content: "the page/post in the block editor, or theme templates for repeated elements",
    "crawl-files": "the SEO plugin's sitemap and robots.txt settings",
    "structured-data": "the SEO plugin's schema settings (avoid duplicating its output in the theme)",
    performance: "a caching plugin, image optimisation and removing unused plugins/scripts",
  },
  Shopify: {
    head: "theme.liquid and the product/collection/page SEO fields in the admin",
    hosting: "Online Store > Navigation > URL Redirects and the Domains settings",
    content: "the theme sections/templates and the admin content",
    "crawl-files": "robots.txt.liquid (sitemap is generated automatically)",
    "structured-data": "the theme's JSON-LD snippets",
    performance: "theme app embeds/apps and image sizes in Liquid (image_url width)",
  },
};

export const VERIFY_HINTS: Record<string, (url: string) => string> = {
  "onpage-title": (u) => `curl -s ${u} | grep -io '<title>[^<]*</title>'`,
  "onpage-title-length": (u) => `curl -s ${u} | grep -io '<title>[^<]*</title>'`,
  "onpage-title-duplicate": (u) => `curl -s ${u} | grep -io '<title>[^<]*</title>'`,
  "onpage-meta-description": (u) => `curl -s ${u} | grep -io '<meta name="description"[^>]*>'`,
  "onpage-meta-description-length": (u) => `curl -s ${u} | grep -io '<meta name="description"[^>]*>'`,
  "onpage-meta-description-duplicate": (u) => `curl -s ${u} | grep -io '<meta name="description"[^>]*>'`,
  "onpage-h1": (u) => `curl -s ${u} | grep -io '<h1[^>]*>' | wc -l   # expect 1`,
  "onpage-image-alt": (u) => `curl -s ${u} | grep -o '<img[^>]*>' | grep -v 'alt='   # expect no output`,
  "onpage-open-graph": (u) => `curl -s ${u} | grep -io '<meta property="og:[^>]*>'`,
  "onpage-lang": (u) => `curl -s ${u} | grep -io '<html[^>]*>'`,
  "tech-canonical": (u) => `curl -s ${u} | grep -io '<link[^>]*rel="canonical"[^>]*>'`,
  "tech-indexability": (u) => `curl -sI ${u} | grep -i x-robots-tag; curl -s ${u} | grep -io '<meta name="robots"[^>]*>'`,
  "tech-host-canonical": (u) => `curl -sI ${u} | grep -iE '^(HTTP|location)'   # expect 301 to the main host`,
  "tech-http-redirect": (u) => `curl -sI ${u} | grep -iE '^(HTTP|location)'   # expect 301 to https`,
  "tech-status-codes": (u) => `curl -s -o /dev/null -w '%{http_code}\\n' ${u}   # expect 200 or a deliberate 301`,
  "tech-broken-links": (u) => `curl -s -o /dev/null -w '%{http_code}\\n' ${u}`,
  "tech-redirects": (u) => `curl -sIL ${u} | grep -iE '^(HTTP|location)'`,
  "tech-soft-404": (u) => `curl -s -o /dev/null -w '%{http_code}\\n' ${u}this-page-does-not-exist   # expect 404`,
  "tech-robots": (u) => `curl -s ${new URL(u).origin}/robots.txt`,
  "tech-sitemap": (u) => `curl -s ${u} | head -20`,
  "tech-mixed-content": (u) => `curl -s ${u} | grep -o 'src="http://[^"]*"'   # expect no output`,
  "conv-mobile-viewport": (u) => `curl -s ${u} | grep -io '<meta name="viewport"[^>]*>'`,
  "conv-click-to-call": (u) => `curl -s ${u} | grep -o 'href="tel:[^"]*"'`,
};

/** A shell command when one exists, otherwise a manual verification step. */
function verifyFor(item: ActionItem): { shell: boolean; text: string } {
  const url = item.issues[0]?.url ?? "";
  if (VERIFY_HINTS[item.checkId]) return { shell: true, text: VERIFY_HINTS[item.checkId](url) };
  if (item.checkId === "tech-structured-data" || item.checkId === "local-schema") return { shell: false, text: `Open https://search.google.com/test/rich-results?url=${encodeURIComponent(url)} and confirm no errors.` };
  if (item.checkId.startsWith("perf-")) return { shell: false, text: `Re-test at https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)} (lab results vary by a few points between runs).` };
  return { shell: false, text: "Re-run the SEO Health Monitor audit and confirm this finding is gone." };
}

export interface FixPromptOptions {
  siteUrl: string;
  auditId: number;
  auditDate: Date | null;
  platform: { name: string; evidence: string } | null;
  /** "first": only "Fix first" items; "all": everything. */
  scope: "first" | "all";
  includeLowConfidence: boolean;
  /** Limit to one action item (by ActionItem.id). */
  taskId?: string;
  unverifiedChecks?: string[];
}

export function selectFixItems(issues: IssueLike[], options: Pick<FixPromptOptions, "scope" | "includeLowConfidence" | "taskId">) {
  const verified = options.includeLowConfidence ? issues : issues.filter((i) => i.confidence !== "low");
  const excluded = issues.length - verified.length;
  let items = buildActionPlan(verified);
  if (options.taskId) items = items.filter((i) => i.id === options.taskId);
  else if (options.scope === "first") {
    const first = items.filter((i) => i.bucket === "Fix first");
    // A clean site may have nothing in "Fix first"; fall back to the top items.
    items = first.length ? first : items.slice(0, 5);
  }
  return { items, excludedLowConfidence: excluded };
}

export function buildFixPrompt(issues: IssueLike[], options: FixPromptOptions): string {
  const { items, excludedLowConfidence } = selectFixItems(issues, options);
  const hints = options.platform ? PLATFORM_HINTS[options.platform.name] : undefined;
  const date = options.auditDate ? options.auditDate.toISOString().slice(0, 10) : "unknown date";
  const out: string[] = [];

  out.push(`# Fix verified SEO issues on ${options.siteUrl}`);
  out.push("");
  out.push(
    `These findings were measured by an automated crawl of the live site on ${date} (SEO Health Monitor audit #${options.auditId}). Each task lists the exact URLs and the evidence collected. They are verified observations, not guesses.`,
  );
  out.push("");
  out.push(
    options.platform
      ? `Detected platform: **${options.platform.name}** (signal: ${options.platform.evidence}). Confirm this matches the codebase before editing.`
      : "Platform: not detected from the public HTML. Inspect the codebase to find where each change belongs.",
  );
  out.push("");
  out.push("## Ground rules");
  out.push("");
  out.push("- Work through the tasks in order; they are ranked by severity, confidence and effort.");
  out.push("- Change only what each task requires. Keep existing wording, design and URLs unless the task says otherwise.");
  out.push("- First locate the code that produces each affected URL. If the live evidence doesn't match the code (e.g. it is already fixed, or generated elsewhere), report that instead of guessing.");
  out.push("- Some fixes are hosting, DNS or CDN settings rather than code. For those, give the owner exact step-by-step instructions instead of inventing code.");
  out.push("- Do not add SEO changes beyond these tasks, and never add hidden text, keyword stuffing or fake reviews/structured data.");
  out.push("- After each task, run its verification against a local build (or the deployed site) and report the result.");
  out.push("");

  if (!items.length) {
    out.push("No verified issues match this selection. Nothing to fix.");
    return out.join("\n");
  }

  out.push(`## Tasks (${items.length})`);
  out.push("");
  items.forEach((item, index) => {
    out.push(`### ${index + 1}. ${item.title}`);
    out.push("");
    out.push(`- **Severity:** ${item.severity} · **Priority:** ${item.bucket} (score ${item.priorityScore}) · **Area:** ${categoryLabel(item.category)} → ${AREA_LABEL[areaFor(item.checkId)]} · **Confidence:** ${item.confidence} · **Effort:** ${item.effort}`);
    out.push(`- **Why it matters:** ${item.why}`);
    out.push(`- **Required change:** ${item.fix}`);
    const hint = hints?.[areaFor(item.checkId)];
    if (hint) out.push(`- **Where to look (${options.platform!.name}):** ${hint}`);
    out.push("");
    out.push("**Implementation guidance:**");
    out.push("");
    out.push(item.implementation.includes("\n") ? "```\n" + item.implementation + "\n```" : item.implementation);
    out.push("");
    out.push(`**Affected URLs and evidence (${item.issues.length}):**`);
    out.push("");
    for (const issue of item.issues.slice(0, 40)) {
      out.push(`- ${issue.url}`);
      for (const ev of issue.evidence.slice(0, 5)) out.push(`  - ${ev}`);
    }
    if (item.issues.length > 40) out.push(`- …and ${item.issues.length - 40} more URLs with the same problem (export the audit JSON for the full list).`);
    out.push("");
    out.push(`**Done when:** a re-run of the audit no longer reports "${item.title}" for these URLs.`);
    out.push("");
    const verify = verifyFor(item);
    if (verify.shell) {
      out.push("**Verify:**");
      out.push("");
      out.push("```bash");
      out.push(verify.text);
      out.push("```");
    } else {
      out.push(`**Verify:** ${verify.text}`);
    }
    out.push("");
  });

  const notes: string[] = [];
  if (excludedLowConfidence > 0) notes.push(`${excludedLowConfidence} lower-confidence (heuristic) findings were excluded. Review them in the app before acting.`);
  if (options.unverifiedChecks?.length) notes.push(`Not verified by this audit (do not assume pass or fail): ${options.unverifiedChecks.join("; ")}.`);
  if (notes.length) {
    out.push("## Not included");
    out.push("");
    for (const n of notes) out.push(`- ${n}`);
    out.push("");
  }
  out.push("When finished, summarise what you changed per task, anything you couldn't do and why, and any owner actions required.");
  return out.join("\n");
}
