import robotsParser from "robots-parser";
import { ROBOTS_USER_AGENT } from "@/lib/config";
import type { RobotsInfo } from "@/lib/audit/types";
import { decodeBody, safeFetch } from "./http";

export interface RobotsRules {
  info: RobotsInfo;
  isAllowed(url: string): boolean;
}

export function parseRobots(robotsUrl: string, content: string, status: number | null): RobotsRules {
  const parser = robotsParser(robotsUrl, content);
  const origin = new URL(robotsUrl).origin;
  const home = `${origin}/`;
  const info: RobotsInfo = {
    url: robotsUrl,
    status,
    found: true,
    content: content.slice(0, 20_000),
    sitemaps: parser.getSitemaps(),
    crawlDelay: parser.getCrawlDelay(ROBOTS_USER_AGENT) ?? undefined,
    blocksAllForGoogle: parser.isAllowed(home, "Googlebot") === false,
    blocksAllForAll: parser.isAllowed(home, "*") === false,
  };
  return {
    info,
    isAllowed: (url) => parser.isAllowed(url, ROBOTS_USER_AGENT) !== false,
  };
}

/**
 * Fetches robots.txt. Missing (4xx) means everything is allowed; an unreachable
 * file is reported but does not stop the audit.
 */
export async function fetchRobots(origin: string, timeoutMs: number): Promise<RobotsRules> {
  const robotsUrl = `${origin}/robots.txt`;
  const res = await safeFetch(robotsUrl, { timeoutMs, maxBytes: 500_000, accept: "text/plain,*/*" });
  const empty = (found: boolean, error?: string): RobotsRules => ({
    info: {
      url: robotsUrl,
      status: res.status,
      found,
      error,
      sitemaps: [],
      blocksAllForGoogle: false,
      blocksAllForAll: false,
    },
    isAllowed: () => true,
  });
  if (res.error) return empty(false, res.error);
  if (res.status !== null && res.status >= 400 && res.status < 500) return empty(false);
  if (res.status !== 200) return empty(false, `robots.txt returned HTTP ${res.status}`);
  const type = res.headers["content-type"] ?? "";
  const text = decodeBody(res);
  if (/text\/html/i.test(type) && /<html/i.test(text)) {
    return empty(false, "robots.txt returned an HTML page instead of a plain-text file");
  }
  return parseRobots(robotsUrl, text, res.status);
}
