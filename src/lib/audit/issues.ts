import crypto from "node:crypto";
import type { Category, Confidence, Effort, Issue, IssueDraft, Severity } from "./types";

export interface IssueTemplate {
  title: string;
  severity: Severity;
  why: string;
  fix: string;
  implementation: string;
  benefit: string;
  /** 1 (minor) .. 5 (major) expected effect on search visibility or conversions. */
  impact: number;
  effort: Effort;
  confidence: Confidence;
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 100, high: 70, medium: 40, low: 15 };
const CONFIDENCE_FACTOR: Record<Confidence, number> = { high: 1, medium: 0.8, low: 0.55 };
const EFFORT_FACTOR: Record<Effort, number> = { low: 1, medium: 0.8, high: 0.6 };

/**
 * Stable identifier for "the same problem on the same URL" across audits.
 * Depends only on the check, the normalised URL and an optional discriminator,
 * never on wording, so comparing scans stays reliable when copy changes.
 */
export function issueKey(checkId: string, url: string, discriminator = ""): string {
  let normalized = url;
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    normalized = u.toString();
  } catch {
    /* site-level keys may not be URLs */
  }
  return crypto.createHash("sha1").update(`${checkId}|${normalized}|${discriminator}`).digest("hex").slice(0, 16);
}

/**
 * Priority = severity weight x confidence x effort factor + impact bonus.
 * High-severity, high-confidence, low-effort fixes float to the top.
 */
export function priorityScore(severity: Severity, impact: number, confidence: Confidence, effort: Effort): number {
  return Math.round(SEVERITY_WEIGHT[severity] * CONFIDENCE_FACTOR[confidence] * EFFORT_FACTOR[effort] + impact * 4);
}

export function priorityBucket(score: number): "Fix first" | "Fix next" | "Plan later" {
  if (score >= 70) return "Fix first";
  if (score >= 40) return "Fix next";
  return "Plan later";
}

export function buildIssue(category: Category, template: IssueTemplate, draft: IssueDraft): Issue {
  const severity = draft.severity ?? template.severity;
  const confidence = draft.confidence ?? template.confidence;
  return {
    key: issueKey(draft.checkId, draft.url, draft.discriminator),
    checkId: draft.checkId,
    category,
    severity,
    title: draft.title ?? template.title,
    url: draft.url,
    evidence: draft.evidence.slice(0, 25),
    why: template.why,
    fix: template.fix,
    implementation: template.implementation,
    benefit: template.benefit,
    impact: template.impact,
    confidence,
    effort: template.effort,
    priorityScore: priorityScore(severity, template.impact, confidence, template.effort),
  };
}
