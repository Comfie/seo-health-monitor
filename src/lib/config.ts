import "server-only";

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function strEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const config = {
  databasePath: strEnv("DATABASE_PATH") ?? "./data/seo-health.db",
  pagespeedApiKey: strEnv("PAGESPEED_API_KEY"),
  anthropicApiKey: strEnv("ANTHROPIC_API_KEY"),
  aiModel: strEnv("AI_MODEL") ?? "claude-opus-5-5",
  crawl: {
    maxPages: intEnv("CRAWL_MAX_PAGES", 25, 1, 100),
    concurrency: intEnv("CRAWL_CONCURRENCY", 2, 1, 5),
    timeoutMs: intEnv("CRAWL_TIMEOUT_MS", 15_000, 2_000, 60_000),
    maxBytes: intEnv("CRAWL_MAX_BYTES", 3_000_000, 100_000, 20_000_000),
    maxLinkChecks: 60,
  },
  pagespeed: {
    maxPages: intEnv("PAGESPEED_MAX_PAGES", 3, 0, 10),
    timeoutMs: 120_000,
  },
  rateLimit: {
    max: intEnv("AUDIT_RATE_LIMIT_MAX", 5, 1, 1000),
    windowMs: intEnv("AUDIT_RATE_LIMIT_WINDOW_MS", 600_000, 1_000, 86_400_000),
  },
  searchConsole: {
    clientId: strEnv("GOOGLE_CLIENT_ID"),
    clientSecret: strEnv("GOOGLE_CLIENT_SECRET"),
  },
};

export const USER_AGENT =
  "Mozilla/5.0 (compatible; SEOHealthMonitor/1.0; +https://github.com/seo-health-monitor)";
/** Token matched against robots.txt groups. */
export const ROBOTS_USER_AGENT = "SEOHealthMonitor";
