import type { AuditContext, IssueDraft } from "../types";
import { htmlPages, isNoindex, pass, plural, ratioOutcome, unavailable, type CheckDefinition, type CheckOutcome } from "./helpers";

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function sourcesFor(ctx: AuditContext, url: string, limit = 5): string[] {
  return (ctx.inlinks[url] ?? []).slice(0, limit).map((s) => `Linked from: ${s}`);
}

export const technicalChecks: CheckDefinition[] = [
  {
    id: "tech-https",
    category: "technical",
    title: "Site served over HTTPS",
    description: "The audited homepage is served over HTTPS with a valid certificate.",
    weight: 10,
    template: {
      title: "Website is not served over HTTPS",
      severity: "critical",
      why: "Browsers label HTTP pages as \"Not secure\", which erodes visitor trust, and Google uses HTTPS as a ranking signal.",
      fix: "Install a TLS certificate and serve every page over https://, redirecting all http:// URLs with a 301.",
      implementation:
        "Issue a free certificate (e.g. Let's Encrypt via your host or Cloudflare). Add a server-level 301 redirect from http:// to https:// (Apache: RewriteCond %{HTTPS} off / RewriteRule; Nginx: return 301 https://$host$request_uri). Update internal links, canonical tags and the sitemap to https URLs.",
      benefit: "Removes browser security warnings and may modestly improve rankings and enquiry rates.",
      impact: 5,
      effort: "medium",
      confidence: "high",
    },
    run(ctx) {
      if (ctx.origin.startsWith("https:")) return pass(`The site is served from ${ctx.origin}.`);
      return {
        status: "fail",
        score: 0,
        summary: `The site is served over plain HTTP (${ctx.origin}).`,
        drafts: [{ checkId: "tech-https", url: ctx.origin + "/", evidence: [`Final homepage URL: ${ctx.homepage?.finalUrl}`] }],
      };
    },
  },
  {
    id: "tech-http-redirect",
    category: "technical",
    title: "HTTP redirects to HTTPS",
    description: "Requests to http:// are permanently redirected to the HTTPS site.",
    weight: 5,
    template: {
      title: "HTTP version of the site does not redirect to HTTPS",
      severity: "high",
      why: "If http:// pages load without redirecting, search engines can index two copies of the site and visitors may land on the insecure version.",
      fix: "Add a site-wide 301 redirect from http:// to the equivalent https:// URL.",
      implementation:
        "Configure the redirect at the web server or CDN (Cloudflare: SSL/TLS > Edge Certificates > Always Use HTTPS; Apache .htaccess or Nginx server block). Use a single 301 hop straight to the final https host.",
      benefit: "Consolidates ranking signals on one secure version of every page.",
      impact: 4,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const check = ctx.httpToHttps;
      if (!check) return unavailable("The site itself is not served over HTTPS, so this redirect cannot be tested.");
      if (check.error && check.status === null) {
        return {
          status: "warning",
          score: 0.5,
          summary: `http://${ctx.siteHost}/ could not be reached (${check.error}). Visitors typing the address without https may get an error.`,
          drafts: [{ checkId: "tech-http-redirect", url: check.testedUrl, evidence: [`Request error: ${check.error}`], severity: "medium", title: "HTTP version of the site is unreachable" }],
        };
      }
      const final = check.finalUrl ?? "";
      if (final.startsWith("https:") && check.redirectChain.length > 0) {
        const firstStatus = check.redirectChain[0].status;
        if (firstStatus === 301 || firstStatus === 308) {
          return pass(`http:// redirects to ${final} with a ${firstStatus} (${plural(check.redirectChain.length, "hop")}).`);
        }
        return {
          status: "warning",
          score: 0.7,
          summary: `http:// redirects to HTTPS with a temporary ${firstStatus} redirect.`,
          drafts: [{ checkId: "tech-http-redirect", url: check.testedUrl, evidence: [`First redirect status: ${firstStatus} (temporary)`, `Final URL: ${final}`], severity: "medium", title: "HTTP to HTTPS redirect is temporary (not 301)" }],
        };
      }
      return {
        status: "fail",
        score: 0,
        summary: `http://${ctx.siteHost}/ responds with HTTP ${check.status} without redirecting to HTTPS.`,
        drafts: [{ checkId: "tech-http-redirect", url: check.testedUrl, evidence: [`Status: ${check.status}`, `Final URL: ${final}`] }],
      };
    },
  },
  {
    id: "tech-host-canonical",
    category: "technical",
    title: "www / non-www consolidated",
    description: "The alternate hostname (www or bare domain) redirects to the main host.",
    weight: 3,
    template: {
      title: "www and non-www versions both serve the site",
      severity: "medium",
      why: "When both hostnames return pages, search engines may treat them as duplicate sites and split ranking signals.",
      fix: "Pick one hostname and 301-redirect the other to it, preserving the path.",
      implementation:
        "Add a host redirect rule at the server or CDN (e.g. Nginx `server_name www.example.com; return 301 https://example.com$request_uri;`). Make sure canonicals and the sitemap use the chosen host.",
      benefit: "Prevents duplicate-site indexing and consolidates link equity.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const check = ctx.hostVariant;
      if (!check) return unavailable("Host variant was not tested.");
      const variantHost = new URL(check.testedUrl).hostname;
      if (check.error && check.status === null) {
        return pass(`${variantHost} does not resolve or respond, so it cannot compete with ${ctx.siteHost}.`);
      }
      const finalHost = check.finalUrl ? new URL(check.finalUrl).hostname : null;
      if (finalHost === ctx.siteHost) return pass(`${variantHost} redirects to ${ctx.siteHost}.`);
      if (check.status !== null && check.status < 400 && check.canonical && new URL(check.canonical).hostname === ctx.siteHost) {
        return {
          status: "warning",
          score: 0.7,
          summary: `${variantHost} serves content (HTTP ${check.status}) without redirecting, but its canonical tag points to ${ctx.siteHost}.`,
          drafts: [{ checkId: "tech-host-canonical", url: check.testedUrl, severity: "low", title: "Alternate hostname serves pages instead of redirecting (canonical mitigates)", evidence: [`${check.testedUrl} returned HTTP ${check.status}`, `Canonical on that response: ${check.canonical}`, "Search engines will usually consolidate via the canonical, but a 301 redirect is the stronger, cleaner signal."] }],
        };
      }
      if (check.status !== null && check.status < 400) {
        return {
          status: "fail",
          score: 0,
          summary: `${variantHost} serves content (HTTP ${check.status}) instead of redirecting to ${ctx.siteHost}.`,
          drafts: [{ checkId: "tech-host-canonical", url: check.testedUrl, evidence: [`Final URL: ${check.finalUrl}`, `Status: ${check.status}`] }],
        };
      }
      return pass(`${variantHost} returns HTTP ${check.status}; it does not serve a duplicate site.`);
    },
  },
  {
    id: "tech-status-codes",
    category: "technical",
    title: "Crawled pages return 200",
    description: "Every crawled page responded successfully (no 4xx/5xx or connection errors).",
    weight: 10,
    template: {
      title: "Page returns an error status",
      severity: "high",
      why: "Pages that return errors cannot rank and send visitors to a dead end. Search engines drop persistent error pages from their index.",
      fix: "Restore the page, or 301-redirect the URL to the most relevant live page and update links pointing to it.",
      implementation:
        "Check the server/application logs for the URL. For deleted content add a 301 redirect (WordPress: Redirection plugin; Nginx/Apache rewrite rule). For 5xx errors investigate PHP/application errors and hosting resource limits.",
      benefit: "Recovers lost visitors and stops search engines wasting crawl effort on broken URLs.",
      impact: 4,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const drafts: IssueDraft[] = [];
      for (const page of ctx.pages) {
        const failed = page.fetchError || page.status === null || page.status >= 400;
        if (!failed) continue;
        const isHome = page.depth === 0;
        drafts.push({
          checkId: "tech-status-codes",
          url: page.url,
          title: page.status ? `Page returns HTTP ${page.status}` : "Page could not be fetched",
          severity: isHome || (page.status ?? 0) >= 500 ? "critical" : "high",
          evidence: [page.status ? `HTTP status: ${page.status}` : `Error: ${page.fetchError}`, ...sourcesFor(ctx, page.url)],
        });
      }
      return ratioOutcome(ctx.pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} crawled returned errors.` : `All ${t} crawled pages returned a successful status.`));
    },
  },
  {
    id: "tech-broken-links",
    category: "technical",
    title: "No broken internal links",
    description: "Internal links point to URLs that respond successfully.",
    weight: 8,
    template: {
      title: "Broken internal link",
      severity: "high",
      why: "Broken links frustrate visitors, waste crawl budget and leak the internal link value that helps pages rank.",
      fix: "Update or remove each link that points to the broken URL, or redirect the broken URL to a relevant live page.",
      implementation:
        "Edit the linking pages listed in the evidence and change the href to the correct live URL. If the target moved, add a 301 redirect from the old path as a safety net.",
      benefit: "Improves user experience and lets link value flow to live pages.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const targets = Object.keys(ctx.inlinks);
      const checked = targets.filter((t) => ctx.linkChecks[t]);
      const drafts: IssueDraft[] = [];
      for (const url of checked) {
        const check = ctx.linkChecks[url];
        const broken = check.error || check.status === null || check.status >= 400;
        if (!broken) continue;
        drafts.push({
          checkId: "tech-broken-links",
          url,
          title: check.status ? `Internal link target returns HTTP ${check.status}` : "Internal link target is unreachable",
          evidence: [check.status ? `Status: ${check.status}` : `Error: ${check.error}`, ...sourcesFor(ctx, url, 8)],
        });
      }
      if (checked.length === 0) return unavailable("No internal links were found to check.");
      const outcome = ratioOutcome(checked.length, drafts, (f, t) =>
        f ? `${plural(f, "internal link target")} of ${t} checked are broken.` : `All ${t} checked internal link targets respond successfully.`,
      );
      if (drafts.length > 0) outcome.status = drafts.length >= 3 ? "fail" : "warning";
      if (ctx.uncheckedLinkCount) outcome.summary += ` ${ctx.uncheckedLinkCount} further targets were not checked (limit reached).`;
      return outcome;
    },
  },
  {
    id: "tech-redirects",
    category: "technical",
    title: "Internal links avoid redirects",
    description: "Internal links point directly at final URLs; no redirect chains or loops.",
    weight: 5,
    template: {
      title: "Internal link points to a redirect",
      severity: "low",
      why: "Each redirect adds latency and slightly dilutes link signals. Chains of several redirects can stop crawlers following them.",
      fix: "Change internal links to point straight at the final destination URL and collapse multi-hop redirects into a single 301.",
      implementation:
        "Search the site content/templates for the old URL and replace it with the final URL shown in the evidence. For chains, update the redirect rule for the first URL so it points directly to the final URL.",
      benefit: "Slightly faster navigation and cleaner crawling.",
      impact: 2,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const drafts: IssueDraft[] = [];
      const targets = Object.keys(ctx.inlinks).filter((t) => ctx.linkChecks[t]);
      for (const url of targets) {
        const check = ctx.linkChecks[url];
        const hops = check.redirectChain.length;
        if (hops === 0) continue;
        const chainText = check.redirectChain.map((h) => `${h.status} ${h.url} → ${h.location}`);
        const loop = check.error?.includes("loop");
        drafts.push({
          checkId: "tech-redirects",
          url,
          title: loop ? "Redirect loop" : hops > 1 ? `Redirect chain with ${hops} hops` : "Internal link points to a redirect",
          severity: loop ? "high" : hops > 1 ? "medium" : "low",
          evidence: [...chainText, ...sourcesFor(ctx, url)],
        });
      }
      if (targets.length === 0) return unavailable("No internal links were found to check.");
      return ratioOutcome(targets.length, drafts, (f, t) => (f ? `${plural(f, "internal link target")} of ${t} redirect.` : `None of the ${t} internal link targets redirect.`));
    },
  },
  {
    id: "tech-robots",
    category: "technical",
    title: "robots.txt is valid and permissive",
    description: "robots.txt exists, does not block search engines from the site and lists the sitemap.",
    weight: 6,
    template: {
      title: "robots.txt problem",
      severity: "medium",
      why: "robots.txt tells search engines what they may crawl. A missing file is harmless, but blocking the whole site or omitting the sitemap reference makes discovery harder.",
      fix: "Publish a plain-text /robots.txt that allows crawling of public pages and includes a `Sitemap:` line with the absolute sitemap URL.",
      implementation:
        "Minimal file:\n\nUser-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: https://YOUR-DOMAIN/sitemap.xml\n\n(WordPress SEO plugins such as Yoast or Rank Math can manage this.)",
      benefit: "Helps search engines discover and crawl the right pages.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const r = ctx.robots;
      const url = r.url;
      if (r.blocksAllForGoogle || r.blocksAllForAll) {
        return {
          status: "fail",
          score: 0,
          summary: "robots.txt blocks search engines from crawling the homepage.",
          drafts: [{ checkId: "tech-robots", url, discriminator: "blocks-all", title: "robots.txt blocks search engines from the site", severity: "critical", evidence: [`Googlebot allowed on /: ${!r.blocksAllForGoogle}`, `All user agents allowed on /: ${!r.blocksAllForAll}`] }],
        };
      }
      if (!r.found) {
        if (r.error) {
          return {
            status: "warning",
            score: 0.5,
            summary: `robots.txt could not be read: ${r.error}.`,
            drafts: [{ checkId: "tech-robots", url, discriminator: "error", title: "robots.txt could not be read", severity: "medium", evidence: [r.error, `Status: ${r.status ?? "no response"}`] }],
          };
        }
        return {
          status: "warning",
          score: 0.7,
          summary: `No robots.txt found (HTTP ${r.status}). Crawlers assume everything is allowed.`,
          drafts: [{ checkId: "tech-robots", url, discriminator: "missing", title: "robots.txt is missing", severity: "low", evidence: [`Status: ${r.status}`] }],
        };
      }
      if (r.sitemaps.length === 0) {
        return {
          status: "warning",
          score: 0.8,
          summary: "robots.txt exists but does not reference a sitemap.",
          drafts: [{ checkId: "tech-robots", url, discriminator: "no-sitemap", title: "robots.txt does not reference the sitemap", severity: "low", evidence: ["No `Sitemap:` directive found."] }],
        };
      }
      return pass(`robots.txt allows crawling and lists ${plural(r.sitemaps.length, "sitemap")}.`);
    },
  },
  {
    id: "tech-sitemap",
    category: "technical",
    title: "XML sitemap available and clean",
    description: "An XML sitemap is reachable, valid, and lists live indexable URLs.",
    weight: 6,
    template: {
      title: "XML sitemap problem",
      severity: "medium",
      why: "The sitemap is the list of pages you want indexed. Missing, invalid or polluted sitemaps make it harder for search engines to find and trust your important pages.",
      fix: "Publish a valid XML sitemap that lists only live (200), canonical, indexable URLs, and submit it in Google Search Console.",
      implementation:
        "On WordPress enable the sitemap in Yoast/Rank Math (or the core wp-sitemap.xml). For custom sites generate sitemap.xml at build time from your routes. Exclude redirected, noindexed and error URLs. Reference it in robots.txt.",
      benefit: "Faster, more complete discovery of the pages that matter.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const { sitemap } = ctx;
      const sitemapUrl = sitemap.files[0]?.url ?? `${ctx.origin}/sitemap.xml`;
      if (!sitemap.found) {
        const broken = sitemap.files.filter((f) => f.kind === "missing" || f.kind === "invalid");
        return {
          status: "fail",
          score: 0,
          summary: broken.length ? "Sitemaps referenced in robots.txt are missing or invalid." : "No XML sitemap was found at robots.txt references or common locations.",
          drafts: [{
            checkId: "tech-sitemap",
            url: sitemapUrl,
            discriminator: "missing",
            title: broken.length ? "Sitemap is missing or invalid" : "No XML sitemap found",
            evidence: broken.length ? broken.map((f) => `${f.url}: ${f.error ?? f.kind}`) : ["Checked robots.txt Sitemap directives, /sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml, /sitemap-index.xml"],
          }],
        };
      }
      const drafts: IssueDraft[] = [];
      for (const f of sitemap.files.filter((f) => f.kind === "invalid" || f.kind === "missing")) {
        drafts.push({ checkId: "tech-sitemap", url: f.url, discriminator: "invalid", title: "Sitemap file is invalid or unreachable", severity: "high", evidence: [f.error ?? f.kind] });
      }
      const pagesByUrl = new Map(ctx.pages.map((p) => [p.url, p]));
      for (const url of sitemap.urls) {
        const page = pagesByUrl.get(url);
        const check = ctx.linkChecks[url];
        if (page && (page.status ?? 0) >= 400) {
          drafts.push({ checkId: "tech-sitemap", url, discriminator: "error", title: "Sitemap lists a URL that returns an error", evidence: [`Status: ${page.status ?? page.fetchError}`] });
        } else if ((page && page.redirectChain.length) || (check && check.redirectChain.length)) {
          drafts.push({ checkId: "tech-sitemap", url, discriminator: "redirect", title: "Sitemap lists a redirecting URL", severity: "low", evidence: [`Redirects to: ${(page ?? check)!.finalUrl}`] });
        } else if (page && isNoindex(page)) {
          drafts.push({ checkId: "tech-sitemap", url, discriminator: "noindex", title: "Sitemap lists a noindex page", severity: "high", evidence: [`Robots directives: ${page.extracted?.metaRobots ?? page.xRobotsTag}`] });
        }
      }
      const listedFiles = sitemap.files.filter((f) => f.kind === "urlset" || f.kind === "index").length;
      const summary = `${plural(listedFiles, "sitemap file")} found listing ${plural(sitemap.urls.length, "URL")}.`;
      if (sitemap.urls.length === 0) {
        drafts.push({ checkId: "tech-sitemap", url: sitemapUrl, discriminator: "empty", title: "Sitemap lists no URLs for this site", evidence: ["The sitemap parsed correctly but contained no same-site <loc> entries."] });
      }
      if (!drafts.length) return pass(`${summary} Crawled sitemap URLs are live and indexable.`);
      const score = Math.max(0, 1 - drafts.length / Math.max(5, sitemap.urls.length));
      return { status: score >= 0.75 ? "warning" : "fail", score, summary: `${summary} ${plural(drafts.length, "problem")} found.`, drafts };
    },
  },
  {
    id: "tech-indexability",
    category: "technical",
    title: "Important pages are indexable",
    description: "Pages do not carry noindex in meta robots or the X-Robots-Tag header unless intended.",
    weight: 8,
    template: {
      title: "Page is blocked from indexing (noindex)",
      severity: "high",
      why: "A noindex directive tells search engines to drop the page from results. If this is unintentional the page cannot rank at all.",
      fix: "Remove the noindex directive from pages that should appear in search results. Keep it only on pages you deliberately want hidden.",
      implementation:
        "Look for <meta name=\"robots\" content=\"noindex\"> in the page template or an X-Robots-Tag response header. In WordPress check Settings > Reading (\"Discourage search engines\") and the SEO plugin's per-page advanced settings.",
      benefit: "Pages that should rank become eligible to appear in search results.",
      impact: 5,
      effort: "low",
      confidence: "medium",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      const drafts: IssueDraft[] = pages
        .filter((p) => isNoindex(p))
        .map((p) => ({
          checkId: "tech-indexability",
          url: p.finalUrl,
          severity: p.depth === 0 ? "critical" : "high",
          confidence: p.depth === 0 || p.inSitemap ? "high" : "medium",
          title: p.depth === 0 ? "Homepage is set to noindex" : "Page is set to noindex",
          evidence: [
            p.extracted.metaRobots ? `Meta robots: ${p.extracted.metaRobots}` : "",
            p.xRobotsTag ? `X-Robots-Tag: ${p.xRobotsTag}` : "",
            p.inSitemap ? "This URL is also listed in the XML sitemap (conflicting signals)." : "",
          ].filter(Boolean),
        }));
      const outcome = ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} carry a noindex directive.` : `None of the ${t} crawled pages carry noindex.`));
      outcome.summary += " Indexing status in Google itself requires Search Console and is not verified here.";
      return outcome;
    },
  },
  {
    id: "tech-canonical",
    category: "technical",
    title: "Canonical tags are correct",
    description: "Each page declares one self-referencing (or deliberate) canonical URL that resolves successfully.",
    weight: 6,
    template: {
      title: "Canonical tag problem",
      severity: "medium",
      why: "The canonical tag tells search engines which URL is the main version of a page. Missing, conflicting or broken canonicals can cause the wrong URL to be indexed or the page to be ignored.",
      fix: "Give every indexable page exactly one absolute, self-referencing canonical tag that points at its live https URL.",
      implementation:
        "Add <link rel=\"canonical\" href=\"https://YOUR-DOMAIN/path/\"> in the <head>. WordPress SEO plugins add this automatically; check for themes or plugins adding a second one. In Next.js use `alternates.canonical` in metadata.",
      benefit: "Consolidates ranking signals on the URL you want to rank.",
      impact: 3,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx).filter((p) => !isNoindex(p));
      const drafts: IssueDraft[] = [];
      for (const p of pages) {
        const unique = [...new Set(p.extracted.canonicals)];
        if (unique.length === 0) {
          drafts.push({ checkId: "tech-canonical", url: p.finalUrl, discriminator: "missing", title: "Canonical tag missing", severity: "low", evidence: ["No <link rel=\"canonical\"> or canonical Link header found."] });
          continue;
        }
        if (unique.length > 1) {
          drafts.push({ checkId: "tech-canonical", url: p.finalUrl, discriminator: "multiple", title: "Multiple conflicting canonical tags", severity: "high", evidence: unique.map((c) => `Canonical: ${c}`) });
          continue;
        }
        const canonical = unique[0];
        const canonicalNorm = canonical.replace(/\/$/, "");
        if (canonicalNorm !== p.finalUrl.replace(/\/$/, "")) {
          const target = ctx.linkChecks[canonical];
          if (target && (target.error || (target.status ?? 0) >= 400)) {
            drafts.push({ checkId: "tech-canonical", url: p.finalUrl, discriminator: "broken", title: "Canonical points to a broken URL", severity: "high", evidence: [`Canonical: ${canonical}`, `Target status: ${target.status ?? target.error}`] });
          } else if (ctx.origin.startsWith("https:") && canonical.startsWith("http:")) {
            drafts.push({ checkId: "tech-canonical", url: p.finalUrl, discriminator: "http", title: "Canonical points to an http:// URL", evidence: [`Canonical: ${canonical}`] });
          } else {
            drafts.push({ checkId: "tech-canonical", url: p.finalUrl, discriminator: "other", title: "Canonical points to a different URL", confidence: "medium", evidence: [`Canonical: ${canonical}`, "If this page is a deliberate duplicate this is fine; otherwise the page may not be indexed."] });
          }
        }
      }
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} have canonical issues.` : `All ${t} indexable pages have a single self-referencing canonical.`));
    },
  },
  {
    id: "tech-structured-data",
    category: "technical",
    title: "Structured data is valid",
    description: "JSON-LD blocks parse as valid JSON and declare @context and @type. (Syntax only; Google rich result eligibility is not verified.)",
    weight: 4,
    template: {
      title: "Structured data error",
      severity: "medium",
      why: "Structured data helps search engines understand your business and can enable rich results. Syntax errors mean the whole block is ignored.",
      fix: "Correct the JSON-LD so it is valid JSON with @context \"https://schema.org\" and a @type, then validate it with Google's Rich Results Test.",
      implementation:
        "Copy the <script type=\"application/ld+json\"> block into a JSON validator to locate the syntax error (often a trailing comma or unescaped quote). Fix it in the theme/plugin that outputs it. Validate at https://search.google.com/test/rich-results.",
      benefit: "Makes the business information machine-readable and eligible for rich results.",
      impact: 2,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      const drafts: IssueDraft[] = [];
      let blocks = 0;
      for (const p of pages) {
        p.extracted.jsonLd.forEach((block, i) => {
          blocks++;
          if (!block.valid) {
            drafts.push({ checkId: "tech-structured-data", url: p.finalUrl, discriminator: `invalid-${i}`, title: "JSON-LD block is not valid JSON", severity: "high", evidence: [`Block #${i + 1}: ${block.error}`] });
          } else if (block.error) {
            drafts.push({ checkId: "tech-structured-data", url: p.finalUrl, discriminator: `incomplete-${i}`, title: "JSON-LD block is incomplete", severity: "medium", evidence: [`Block #${i + 1}: ${block.error}`, `Types: ${block.types.join(", ") || "none"}`] });
          }
        });
      }
      const microdata = pages.some((p) => p.extracted.microdataTypes.length > 0);
      if (blocks === 0 && !microdata) {
        return {
          status: "warning",
          score: 0.5,
          summary: "No structured data (JSON-LD or microdata) was found on any crawled page.",
          drafts: [{ checkId: "tech-structured-data", url: ctx.homepage?.finalUrl ?? ctx.origin, discriminator: "none", title: "No structured data found", severity: "low", evidence: [`Checked ${plural(pages.length, "page")}.`] }],
        };
      }
      if (!drafts.length) return pass(`${plural(blocks, "JSON-LD block")} parsed without errors${microdata ? " (microdata also present)" : ""}.`);
      const score = Math.max(0, 1 - drafts.length / Math.max(1, blocks));
      return { status: score >= 0.75 ? "warning" : "fail", score, summary: `${plural(drafts.length, "structured data block")} of ${blocks} have errors.`, drafts };
    },
  },
  {
    id: "tech-mixed-content",
    category: "technical",
    title: "No mixed content",
    description: "HTTPS pages do not load images, scripts or styles over insecure http://.",
    weight: 3,
    template: {
      title: "Page loads insecure (http://) resources",
      severity: "medium",
      why: "Browsers block or warn about insecure resources on secure pages, which can break layout or functionality and show a \"Not secure\" warning.",
      fix: "Change the listed resource URLs to https:// (or protocol-relative/relative URLs).",
      implementation:
        "Update the hard-coded URLs in the page content or theme. On WordPress, a search-replace of http://YOUR-DOMAIN to https://YOUR-DOMAIN in the database (e.g. Better Search Replace) fixes most cases.",
      benefit: "Removes browser warnings and broken resources.",
      impact: 2,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      if (!ctx.origin.startsWith("https:")) return unavailable("The site is not served over HTTPS, so mixed content does not apply.");
      const pages = htmlPages(ctx);
      const drafts = pages
        .filter((p) => p.extracted.mixedContent.length)
        .map((p) => ({ checkId: "tech-mixed-content", url: p.finalUrl, evidence: p.extracted.mixedContent.slice(0, 10).map((r) => `Insecure resource: ${r}`) }));
      return ratioOutcome(pages.length, drafts, (f, t) => (f ? `${plural(f, "page")} of ${t} load insecure resources.` : `No mixed content found on ${t} pages.`));
    },
  },
  {
    id: "tech-soft-404",
    category: "technical",
    title: "Missing pages return 404",
    description: "A request for a non-existent URL returns a 404/410 status rather than 200.",
    weight: 3,
    template: {
      title: "Non-existent URLs return 200 (soft 404)",
      severity: "medium",
      why: "If missing pages return \"200 OK\", search engines may index error pages and waste crawl budget on junk URLs.",
      fix: "Configure the server or CMS so unknown URLs return a real 404 status with a helpful error page.",
      implementation:
        "Check the catch-all route or .htaccess rule that serves the homepage/template for unknown paths. The response must send `HTTP/1.1 404 Not Found` (Next.js: notFound(); WordPress themes: 404.php is used automatically unless a plugin redirects all 404s).",
      benefit: "Keeps the index clean and makes broken links detectable.",
      impact: 2,
      effort: "low",
      confidence: "high",
    },
    run(ctx) {
      const probe = ctx.notFoundProbe;
      if (!probe || (probe.error && probe.status === null)) return unavailable(`The 404 test URL could not be fetched${probe?.error ? `: ${probe.error}` : ""}.`);
      if (probe.status === 404 || probe.status === 410) return pass(`A random URL correctly returned HTTP ${probe.status}.`);
      if (probe.redirectChain.length && probe.finalUrl) {
        return {
          status: "warning",
          score: 0.6,
          summary: `Unknown URLs redirect to ${probe.finalUrl} instead of returning 404.`,
          drafts: [{ checkId: "tech-soft-404", url: probe.testedUrl.replace(/[^/]+$/, ""), title: "Unknown URLs redirect instead of returning 404", severity: "low", evidence: [`Tested: ${probe.testedUrl}`, `Redirected to: ${probe.finalUrl} (HTTP ${probe.status})`] }],
        };
      }
      return {
        status: "fail",
        score: 0,
        summary: `A random non-existent URL returned HTTP ${probe.status}.`,
        drafts: [{ checkId: "tech-soft-404", url: probe.testedUrl.replace(/[^/]+$/, ""), evidence: [`Tested: ${probe.testedUrl}`, `Status: ${probe.status}`] }],
      };
    },
  },
  {
    id: "tech-response-time",
    category: "technical",
    title: "Fast server response",
    description: "HTML documents are delivered quickly (median full response under 1.5s, measured from the audit server).",
    weight: 2,
    template: {
      title: "Slow server response",
      severity: "low",
      why: "Slow server responses delay everything else on the page and can reduce how often search engines crawl the site.",
      fix: "Enable page caching and review hosting performance.",
      implementation:
        "Enable full-page caching (WordPress: WP Rocket/LiteSpeed Cache/W3TC; or a CDN cache such as Cloudflare APO). Check database and plugin overhead with Query Monitor, and consider a faster hosting plan or server region closer to your visitors.",
      benefit: "Faster first byte for every visitor; measured from this tool's server, so real-world numbers vary by location.",
      impact: 2,
      effort: "medium",
      confidence: "medium",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      if (!pages.length) return unavailable("No pages were fetched successfully.");
      const times = pages.map((p) => p.responseTimeMs);
      const med = median(times);
      const drafts = pages
        .filter((p) => p.responseTimeMs > 3000)
        .map((p) => ({ checkId: "tech-response-time", url: p.finalUrl, evidence: [`Full HTML response took ${p.responseTimeMs} ms (audit server measurement).`] }));
      const score = med <= 800 ? 1 : med <= 1500 ? 0.8 : med <= 3000 ? 0.5 : 0.2;
      const status = score === 1 ? "pass" : score >= 0.75 ? "warning" : "fail";
      return { status, score, summary: `Median HTML response time ${med} ms across ${plural(pages.length, "page")} (measured from the audit server).`, drafts };
    },
  },
  {
    id: "tech-js-rendering",
    category: "technical",
    title: "Content is server-rendered",
    description: "Main content is present in the HTML response. Pages that rely on JavaScript to render content may be audited incompletely.",
    weight: 0,
    template: {
      title: "Content appears to require JavaScript rendering",
      severity: "medium",
      why: "Search engines can render JavaScript, but it is slower and less reliable than plain HTML. This tool reads the raw HTML, so findings for these pages may be incomplete.",
      fix: "Serve the main content, title, meta tags and links in the initial HTML (server-side rendering or static generation).",
      implementation:
        "For React/Vue/Angular single-page apps adopt SSR/SSG (Next.js, Nuxt, Angular Universal) or a pre-rendering service. Verify with Google Search Console's URL Inspection > View crawled page.",
      benefit: "More reliable indexing of page content and more accurate audits.",
      impact: 3,
      effort: "high",
      confidence: "medium",
    },
    run(ctx) {
      const pages = htmlPages(ctx);
      const suspected = pages.filter((p) => p.extracted.jsRendering.suspected);
      if (!pages.length) return unavailable("No HTML pages were fetched.");
      if (!suspected.length) return { status: "pass", score: null, summary: `Content was present in the server HTML on all ${plural(pages.length, "page")}.`, drafts: [] };
      return {
        status: "warning",
        score: null,
        summary: `${plural(suspected.length, "page")} appear to depend on JavaScript to render content. Content-based findings on these pages have reduced confidence.`,
        drafts: suspected.map((p) => ({ checkId: "tech-js-rendering", url: p.finalUrl, evidence: p.extracted.jsRendering.reasons })),
      };
    },
  },
  {
    id: "tech-index-status",
    category: "technical",
    title: "Google index coverage",
    description: "Google's own index status for crawled pages, from the Search Console URL Inspection API. Shown for information; it does not affect the score.",
    weight: 0,
    template: {
      title: "Google hasn't indexed this page",
      severity: "medium",
      why: "A page that isn't in Google's index can't appear in search results at all, however good its content. This status comes directly from Google (URL Inspection), not from a guess.",
      fix: "Make sure the page is worth indexing, reachable through internal links, listed in the XML sitemap and not blocked; then request indexing in Search Console.",
      implementation:
        "1. Confirm the page returns 200, has no noindex and a self-referencing canonical.\n2. Link to it from relevant pages (navigation, category or related-content blocks) so Google sees it as important.\n3. Make sure it is in the XML sitemap and the sitemap is submitted in Search Console (Indexing > Sitemaps).\n4. 'Discovered - currently not indexed' usually means Google deprioritised crawling it: improve unique content and internal links. 'URL is unknown to Google' means Google hasn't found it yet: add links and sitemap entries.\n5. In Search Console, inspect the URL and click 'Request indexing'. Indexing can take days to weeks and is never guaranteed.",
      benefit: "Pages that get indexed become eligible to appear in Google results; how they rank still depends on relevance and competition.",
      impact: 4,
      effort: "medium",
      confidence: "high",
    },
    run(ctx): CheckOutcome {
      const sc = ctx.searchConsole;
      if (!sc?.configured) return unavailable("Indexing status can only be verified through Google Search Console, which isn't configured. This audit never assumes a page is indexed.");
      if (!sc.linked) return unavailable("Search Console is connected but not linked to this site. Link the property on the Search Performance page to see Google's index status.");
      const inspected = (sc.inspections ?? []).filter((i) => !i.error);
      if (!inspected.length) {
        const reason = sc.inspections?.find((i) => i.error)?.error;
        return unavailable(`No URL Inspection results are available for this audit's pages yet${reason ? ` (${reason})` : ""}. Refresh Search Console data to fetch them.`);
      }
      const notIndexed = inspected.filter((i) => i.verdict !== "PASS");
      const when = sc.fetchedAt ? ` (Google URL Inspection, ${sc.fetchedAt.toISOString().slice(0, 10)})` : "";
      const drafts: IssueDraft[] = notIndexed.map((i) => ({
        checkId: "tech-index-status",
        url: i.url,
        severity: i.verdict === "FAIL" ? "high" : "medium",
        evidence: [
          `Google coverage: ${i.coverageState ?? i.verdict}`,
          i.lastCrawlTime ? `Last crawled by Google: ${i.lastCrawlTime.slice(0, 10)}` : "Google has no record of crawling this URL.",
          i.robotsTxtState && i.robotsTxtState !== "ALLOWED" ? `robots.txt state: ${i.robotsTxtState}` : "",
          i.indexingState && i.indexingState !== "INDEXING_ALLOWED" ? `Indexing state: ${i.indexingState}` : "",
          i.googleCanonical && i.userCanonical && i.googleCanonical !== i.userCanonical ? `Google chose a different canonical: ${i.googleCanonical}` : "",
        ].filter(Boolean),
      }));
      const indexed = inspected.length - notIndexed.length;
      const summary = `${indexed} of ${plural(inspected.length, "inspected page")} are indexed by Google${when}.`;
      // Informational: weight 0 and score null keep Search Console data out of the on-site score.
      return { status: notIndexed.length ? "warning" : "pass", score: null, summary, drafts };
    },
  },
];
