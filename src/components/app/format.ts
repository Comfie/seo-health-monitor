export function formatDate(value: Date | string | number | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatMs(value: number | null | undefined): string {
  if (value == null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    // A bare "/" is ambiguous across hosts (e.g. www vs non-www), so show the host for root URLs.
    return path === "/" ? `${u.hostname}/` : path;
  } catch {
    return url;
  }
}

export function scoreTone(score: number | null | undefined): "good" | "ok" | "poor" | "na" {
  if (score == null) return "na";
  if (score >= 90) return "good";
  if (score >= 50) return "ok";
  return "poor";
}

export const TONE_COLOR: Record<ReturnType<typeof scoreTone>, string> = {
  good: "var(--sev-pass)",
  ok: "var(--sev-medium)",
  poor: "var(--sev-critical)",
  na: "var(--sev-na)",
};
