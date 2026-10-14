import type { RedirectHop } from "@/lib/crawler/http";

export type Category = "technical" | "onpage" | "performance" | "local" | "conversion";
export type Severity = "critical" | "high" | "medium" | "low";
export type CheckStatus = "pass" | "warning" | "fail" | "unavailable" | "info";
export type Confidence = "high" | "medium" | "low";
export type Effort = "low" | "medium" | "high";

export const CATEGORIES: Category[] = ["technical", "onpage", "performance", "local", "conversion"];

export const CATEGORY_LABELS: Record<Category, string> = {
  technical: "Technical SEO",
  onpage: "On-Page SEO",
  performance: "Performance",
  local: "Local SEO",
  conversion: "Conversion Readiness",
};

export interface JsonLdBlock {
  valid: boolean;
  error?: string;
  types: string[];
  /** Parsed JSON-LD items (flattened @graph), kept small for analysis. */
  items: Record<string, unknown>[];
}

export interface FormInfo {
  action: string | null;
  method: string;
  fieldTypes: string[];
  hasEmail: boolean;
  hasPhone: boolean;
  hasMessage: boolean;
  submitText: string | null;
}

export interface LinkInfo {
  href: string;
  text: string;
  internal: boolean;
  nofollow: boolean;
}

export interface ExtractedPage {
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  metaDescriptionCount: number;
  metaRobots: string | null;
  canonicals: string[];
  lang: string | null;
  viewport: string | null;
  headings: { level: number; text: string }[];
  h1s: string[];
  images: { src: string; alt: string | null }[];
  links: LinkInfo[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: JsonLdBlock[];
  microdataTypes: string[];
  wordCount: number;
  contentHash: string;
  /** 5-word shingles hashed to numbers, used for near-duplicate detection. */
  shingles: number[];
  bodyText: string;
  telLinks: string[];
  whatsappLinks: string[];
  mailtoLinks: string[];
  phoneNumbers: string[];
  emails: string[];
  forms: FormInfo[];
  embeddedFormProviders: string[];
  ctas: string[];
  mixedContent: string[];
  mapsLinks: string[];
  addressSnippets: string[];
  hreflang: { lang: string; href: string }[];
  jsRendering: { suspected: boolean; reasons: string[] };
  scriptCount: number;
  /** Detected site platform/framework with the signal that revealed it. */
  platform?: { name: string; evidence: string } | null;
}

export interface PageData {
  url: string;
  finalUrl: string;
  status: number | null;
  redirectChain: RedirectHop[];
  contentType: string | null;
  fetchError?: string;
  responseTimeMs: number;
  bytes: number;
  truncated: boolean;
  xRobotsTag: string | null;
  depth: number;
  source: "start" | "link" | "sitemap";
  inSitemap: boolean;
  isHtml: boolean;
  extracted?: ExtractedPage;
}

export interface RobotsInfo {
  url: string;
  status: number | null;
  found: boolean;
  error?: string;
  content?: string;
  sitemaps: string[];
  crawlDelay?: number;
  blocksAllForGoogle: boolean;
  blocksAllForAll: boolean;
}

export interface SitemapFile {
  url: string;
  status: number | null;
  kind: "urlset" | "index" | "invalid" | "missing";
  urlCount: number;
  error?: string;
}

export interface SitemapInfo {
  files: SitemapFile[];
  urls: string[];
  found: boolean;
}

export interface LinkCheck {
  url: string;
  status: number | null;
  finalUrl: string;
  redirectChain: RedirectHop[];
  error?: string;
  blockedByRobots?: boolean;
}

export interface HostCheck {
  testedUrl: string;
  status: number | null;
  finalUrl: string | null;
  redirectChain: RedirectHop[];
  /** Canonical URL declared by the response, when it is HTML. */
  canonical?: string | null;
  error?: string;
}

export interface PerformanceResult {
  url: string;
  strategy: "mobile" | "desktop";
  status: "ok" | "unavailable";
  error?: string;
  /** Why it is unavailable, so callers can stop early on quota exhaustion. */
  errorCode?: "quota" | "timeout" | "http" | "lighthouse" | "network" | "skipped";
  performanceScore?: number | null;
  lcpMs?: number | null;
  cls?: number | null;
  tbtMs?: number | null;
  fcpMs?: number | null;
  speedIndexMs?: number | null;
  ttfbMs?: number | null;
  fieldLcpMs?: number | null;
  fieldInpMs?: number | null;
  fieldCls?: number | null;
  fieldCategory?: string | null;
  fieldSource?: "url" | "origin" | null;
  opportunities: { id: string; title: string; displayValue?: string; savingsMs?: number; savingsBytes?: number }[];
}

export interface CrawlResult {
  inputUrl: string;
  startUrl: string;
  siteHost: string;
  /** Origin the site actually serves from after redirects. */
  origin: string;
  homepage: PageData | null;
  pages: PageData[];
  robots: RobotsInfo;
  sitemap: SitemapInfo;
  linkChecks: Record<string, LinkCheck>;
  /** Internal link target -> pages that link to it. */
  inlinks: Record<string, string[]>;
  uncheckedLinkCount: number;
  blockedByRobots: string[];
  discoveredUrlCount: number;
  httpToHttps: HostCheck | null;
  hostVariant: HostCheck | null;
  notFoundProbe: HostCheck | null;
  notes: string[];
}

export interface IndexInspection {
  url: string;
  verdict: string;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  error?: string;
}

/** Search Console state available to the audit. Never feeds scores (index check has weight 0). */
export interface SearchConsoleContext {
  configured: boolean;
  linked: boolean;
  property?: string;
  fetchedAt?: Date;
  inspections?: IndexInspection[];
}

export interface AuditContext extends CrawlResult {
  performance: PerformanceResult[];
  performanceSkippedReason?: string;
  searchConsole?: SearchConsoleContext;
}

export interface IssueDraft {
  checkId: string;
  url: string;
  /** Extra discriminator when one check can raise several issues on the same URL. */
  discriminator?: string;
  title?: string;
  evidence: string[];
  severity?: Severity;
  confidence?: Confidence;
}

export interface Issue {
  key: string;
  checkId: string;
  category: Category;
  severity: Severity;
  title: string;
  url: string;
  evidence: string[];
  why: string;
  fix: string;
  implementation: string;
  benefit: string;
  impact: number;
  confidence: Confidence;
  effort: Effort;
  priorityScore: number;
}

export interface CheckResult {
  id: string;
  category: Category;
  title: string;
  description: string;
  weight: number;
  status: CheckStatus;
  /** 0..1, null when unavailable/informational. */
  score: number | null;
  summary: string;
  unavailableReason?: string;
  issues: Issue[];
}

export interface Scores {
  overall: number | null;
  categories: Record<Category, number | null>;
}

export interface AuditCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** Non-critical issues (high + medium + low). */
  warnings: number;
  passing: number;
  failing: number;
  unavailable: number;
  totalChecks: number;
}
