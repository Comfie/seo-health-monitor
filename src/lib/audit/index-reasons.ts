/**
 * Plain-language explanations for the coverage states Google's URL Inspection API reports
 * (the same wording as Search Console's Page indexing report). Matching is on Google's own
 * text, case-insensitively; anything unrecognised is shown verbatim with a generic action,
 * never reinterpreted.
 */
export type IndexReason = { title: string; explanation: string; action: string };

const REASONS: { match: RegExp; reason: IndexReason }[] = [
  {
    match: /crawled - currently not indexed/i,
    reason: {
      title: "Google crawled this page but chose not to index it",
      explanation: "Google fetched the page and decided not to add it to the index, usually because it judged the content thin, duplicated elsewhere or not useful enough yet.",
      action: "Strengthen the page's unique content, link to it from relevant pages, and request indexing once it is improved.",
    },
  },
  {
    match: /discovered - currently not indexed/i,
    reason: {
      title: "Google knows this page but hasn't crawled it yet",
      explanation: "Google found the URL but postponed crawling it, often because the site has many low-value URLs or the page has few internal links.",
      action: "Add internal links from important pages, list it in the XML sitemap and remove low-value URLs that compete for crawl attention.",
    },
  },
  {
    match: /url is unknown to google/i,
    reason: {
      title: "Google hasn't discovered this page",
      explanation: "Google has no record of this URL, so it cannot appear in search results.",
      action: "Link to it from crawlable pages, add it to the submitted XML sitemap, then request indexing in Search Console.",
    },
  },
  {
    match: /excluded by .?noindex.? tag/i,
    reason: {
      title: "A noindex directive keeps this page out of Google",
      explanation: "Google found a noindex meta tag or X-Robots-Tag header and respected it.",
      action: "If the page should rank, remove the noindex directive (check the CMS, SEO plugin and server headers); otherwise leave it.",
    },
  },
  {
    match: /^blocked by robots\.txt/i,
    reason: {
      title: "robots.txt blocks Google from crawling this page",
      explanation: "Google could not fetch the page because robots.txt disallows it.",
      action: "If the page should be indexed, allow it in robots.txt and request indexing. Use noindex (not robots.txt) to keep pages out of results.",
    },
  },
  {
    match: /indexed, though blocked by robots\.txt/i,
    reason: {
      title: "Indexed without its content because robots.txt blocks it",
      explanation: "Google indexed the URL from links but could not read the page, so results show little or no description.",
      action: "Allow crawling in robots.txt if the page should rank, or allow crawling and add noindex if it should not.",
    },
  },
  {
    match: /duplicate, google chose different canonical than user/i,
    reason: {
      title: "Google picked a different canonical URL",
      explanation: "The page declares itself canonical, but Google treats another URL as the main version and indexes that one instead.",
      action: "Consolidate duplicates: make internal links, sitemap entries and redirects point to one preferred URL, and keep the canonical tags consistent.",
    },
  },
  {
    match: /duplicate without user-selected canonical/i,
    reason: {
      title: "Duplicate page without a canonical tag",
      explanation: "Google considers this page a duplicate of another and, with no canonical declared, indexed the other version.",
      action: "Add a canonical tag to the preferred version on every duplicate, or redirect the duplicates.",
    },
  },
  {
    match: /alternate page with proper canonical tag/i,
    reason: {
      title: "Alternate version pointing to its canonical",
      explanation: "This URL correctly points to another canonical page, so Google indexes that one. This is usually expected.",
      action: "No action needed unless this URL itself should rank; then fix its canonical tag.",
    },
  },
  {
    match: /page with redirect/i,
    reason: {
      title: "This URL redirects",
      explanation: "Google indexes the redirect target, not this URL.",
      action: "Link directly to the final URL and list only final URLs in the sitemap.",
    },
  },
  {
    match: /soft 404/i,
    reason: {
      title: "Google treats this page as a soft 404",
      explanation: "The page returns 200 but looks empty or like an error page to Google.",
      action: "Return a real 404/410 for missing content, or add substantial content if the page is meant to exist.",
    },
  },
  {
    match: /not found \(404\)/i,
    reason: {
      title: "Google received a 404 for this URL",
      explanation: "When Google last crawled it, the URL returned Not Found.",
      action: "Restore the page or redirect it to the closest replacement, and update internal links and the sitemap.",
    },
  },
  {
    match: /server error \(5xx\)/i,
    reason: {
      title: "Google received a server error",
      explanation: "The server returned a 5xx error when Google tried to crawl the page.",
      action: "Check server logs and hosting capacity at Google's crawl time, fix the error, then request indexing.",
    },
  },
  {
    match: /redirect error/i,
    reason: {
      title: "Google hit a redirect error",
      explanation: "The redirect chain was too long, looped, or pointed to an invalid URL.",
      action: "Replace chains with a single 301 to the final URL and fix redirect loops.",
    },
  },
  {
    match: /unauthorized request \(401\)|access forbidden \(403\)|blocked due to access forbidden/i,
    reason: {
      title: "Google was refused access",
      explanation: "The server required authorisation or refused Google's crawler.",
      action: "Make the page publicly accessible to Googlebot (check authentication, firewalls and bot protection).",
    },
  },
  {
    match: /other 4xx issue/i,
    reason: {
      title: "Google received a client error",
      explanation: "The page returned a 4xx status other than 401, 403 or 404 to Google.",
      action: "Make the URL return 200 if it should be indexed, otherwise remove links to it.",
    },
  },
  {
    match: /submitted and indexed|indexed, not submitted in sitemap/i,
    reason: {
      title: "Indexed",
      explanation: "Google has this page in its index.",
      action: "No action needed.",
    },
  },
];

export function explainCoverage(coverageState: string | null | undefined): IndexReason | null {
  if (!coverageState) return null;
  return REASONS.find((r) => r.match.test(coverageState))?.reason ?? null;
}

/** Pages Google most needs to index: the homepage, shallow pages and well-linked pages. */
export function isImportantPage(page: { depth: number; inlinks: number } | undefined): boolean {
  return !!page && (page.depth <= 1 || page.inlinks >= 3);
}
