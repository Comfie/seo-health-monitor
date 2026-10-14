export class UrlValidationError extends Error {}

const NON_HTML_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|avi|mp3|wav|ogg|zip|rar|7z|gz|tar|exe|dmg|apk|docx?|xlsx?|pptx?|csv|txt|xml|json|js|mjs|css|woff2?|ttf|eot|rss|atom)$/i;

const EXCLUDED_PATHS =
  /^\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|cart|checkout|my-account|basket|login|logout|signin|register|cgi-bin|cdn-cgi)(\/|$)|\/feed\/?$|\/trackback\/?$/i;

const LOW_VALUE_PATHS = /\/(tag|tags|author|category|page)\/|[?&](replytocom|share|add-to-cart|orderby|filter_)/i;

/**
 * Turns user input into a canonical absolute URL. Adds https:// when the scheme
 * is missing, lowercases the host, drops fragments, credentials and default ports.
 */
export function normalizeInputUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new UrlValidationError("Enter a website URL.");
  if (trimmed.length > 2048) throw new UrlValidationError("The URL is too long.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UrlValidationError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("Only http:// and https:// URLs can be audited.");
  }
  if (url.username || url.password) {
    throw new UrlValidationError("URLs containing credentials are not allowed.");
  }
  if (!url.hostname.includes(".") && !url.hostname.includes(":")) {
    throw new UrlValidationError("Enter a public domain name such as example.com.");
  }
  return normalizeUrl(url.toString());
}

/** Canonical string form used for de-duplication and deterministic issue IDs. */
export function normalizeUrl(input: string, base?: string): string {
  const url = new URL(input, base);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  if (!url.pathname) url.pathname = "/";
  // Collapse duplicate slashes, keep trailing slash semantics as-is (they are distinct URLs).
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}

/** Resolves an href found on a page; returns null for non-web links. */
export function resolveHref(href: string, pageUrl: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith("#")) return null;
  if (/^(mailto|tel|javascript|data|sms|whatsapp|callto|fax|skype|ftp):/i.test(value)) return null;
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeUrl(url.toString());
  } catch {
    return null;
  }
}

export function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** Same site means the same host, treating www and the bare domain as one site. */
export function isSameSite(url: string, siteHost: string): boolean {
  try {
    return stripWww(new URL(url).hostname) === stripWww(siteHost);
  } catch {
    return false;
  }
}

export function isCrawlableHtmlUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return !NON_HTML_EXTENSIONS.test(pathname) && !EXCLUDED_PATHS.test(pathname);
  } catch {
    return false;
  }
}

export function isLowValueUrl(url: string): boolean {
  return LOW_VALUE_PATHS.test(url);
}

export function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
