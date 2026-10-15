import "server-only";
import PDFDocument from "pdfkit";
import type { ReportSearchConsole } from "./search-summary";
import type { FullAudit } from "@/lib/audit/repository";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/audit/types";
import { assessScore, scoreLabel } from "@/lib/audit/scoring";
import { buildActionPlan, categoryLabel } from "./action-plan";

const COLORS = {
  ink: "#111827",
  muted: "#6b7280",
  line: "#e5e7eb",
  accent: "#0f766e",
  critical: "#b91c1c",
  high: "#c2410c",
  medium: "#a16207",
  low: "#2563eb",
  pass: "#15803d",
};

/** The built-in PDF fonts only cover WinAnsi; map common symbols and drop the rest. */
function clean(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/→/g, "->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/·/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ–—…€]/g, "");
}

function scoreColor(score: number | null): string {
  if (score === null) return COLORS.muted;
  if (score >= 90) return COLORS.pass;
  if (score >= 50) return COLORS.medium;
  return COLORS.critical;
}

export async function renderAuditPdf(full: FullAudit, extras: { searchConsole?: ReportSearchConsole } = {}): Promise<Buffer> {
  const { audit, meta, checks, issues, performance } = full;
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: { Title: `SEO audit - ${meta?.origin ?? audit.startUrl}`, Author: "SEO Health Monitor" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const width = doc.page.width - 100;
  const h1 = (text: string) => {
    doc.moveDown(0.5).font("Helvetica-Bold").fontSize(18).fillColor(COLORS.ink).text(clean(text));
    doc.moveTo(50, doc.y + 4).lineTo(50 + width, doc.y + 4).strokeColor(COLORS.line).stroke();
    doc.moveDown(0.8);
  };
  const h2 = (text: string, color = COLORS.ink) => doc.moveDown(0.4).font("Helvetica-Bold").fontSize(12).fillColor(color).text(clean(text));
  const body = (text: string, opts: PDFKit.Mixins.TextOptions = {}) => doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.ink).text(clean(text), opts);
  const muted = (text: string) => doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.muted).text(clean(text));
  const ensureSpace = (needed: number) => {
    if (doc.y + needed > doc.page.height - 60) doc.addPage();
  };

  // Cover
  doc.font("Helvetica-Bold").fontSize(24).fillColor(COLORS.ink).text("SEO Health Report");
  doc.font("Helvetica").fontSize(12).fillColor(COLORS.accent).text(clean(meta?.origin ?? audit.startUrl));
  muted(`Audit #${audit.id} - completed ${audit.completedAt?.toISOString().replace("T", " ").slice(0, 16) ?? "n/a"} UTC - ${audit.pagesScanned ?? 0} pages scanned`);
  doc.moveDown(1.2);

  const overall = audit.overallScore;
  const scoreText = overall === null ? "n/a" : String(overall);
  const top = doc.y;
  doc.font("Helvetica-Bold").fontSize(48).fillColor(scoreColor(overall)).text(scoreText, 50, top, { lineBreak: false });
  const scoreWidth = doc.widthOfString(scoreText);
  doc.font("Helvetica").fontSize(14).fillColor(COLORS.muted).text(`/ 100   ${scoreLabel(overall)}`, 50 + scoreWidth + 10, top + 26, { lineBreak: false });
  doc.x = 50;
  doc.y = top + 64;
  const assessment = assessScore(checks, CATEGORY_LABELS);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(assessment.provisional ? COLORS.medium : COLORS.ink).text(`On-site SEO health${assessment.provisional ? " - PROVISIONAL" : ""}`);
  muted(`Audit coverage: ${Math.round(assessment.coverage * 100)}% of the scoring model measured. ${assessment.reasons.join(" ")}`);
  doc.moveDown(0.5);
  const cats = audit.categoryScores ?? {};
  for (const c of CATEGORIES) {
    const s = (cats as Record<string, number | null>)[c] ?? null;
    doc.font("Helvetica").fontSize(10.5).fillColor(COLORS.ink).text(`${CATEGORY_LABELS[c]}: `, { continued: true });
    doc.font("Helvetica-Bold").fillColor(scoreColor(s)).text(s === null ? "unavailable" : `${s}/100`);
  }
  doc.moveDown(0.6);
  const counts = audit.counts ?? {};
  body(`Critical issues: ${counts.critical ?? 0}   High: ${counts.high ?? 0}   Medium: ${counts.medium ?? 0}   Low: ${counts.low ?? 0}`);
  body(`Passing checks: ${counts.passing ?? 0} of ${counts.totalChecks ?? 0}   Not verifiable from a public crawl: ${counts.unavailable ?? 0}`);
  doc.moveDown(0.6);
  muted("Scores are weighted averages of explicit checks (Technical 30%, On-page 25%, Performance 20%, Local 15%, Conversion 10%). Unavailable checks are excluded rather than counted as passes or failures. This measures the website itself; actual Google search performance (Search Console) is reported separately.");
  if (meta?.notes.length) {
    doc.moveDown(0.5);
    for (const n of meta.notes) muted(`Note: ${n}`);
  }

  // Owner-authorised Google data, kept apart from the on-site score.
  const sc = extras.searchConsole;
  if (sc && !sc.verified) {
    doc.moveDown(0.5);
    muted(`Google Search Console: not verified. ${sc.note}`);
  } else if (sc?.verified) {
    doc.addPage();
    h1("Google search performance");
    muted(`Source: ${sc.source}, property ${sc.property}, ${sc.period.start} to ${sc.period.end} (fetched ${sc.fetchedAt.slice(0, 10)}). Google's data lags 2-3 days. These figures are not part of the on-site health score.`);
    doc.moveDown(0.4);
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const prev = sc.previous;
    body(`Clicks: ${Math.round(sc.clicks)}${prev ? ` (previous period ${Math.round(prev.clicks)})` : ""}`);
    body(`Impressions: ${Math.round(sc.impressions)}${prev ? ` (previous period ${Math.round(prev.impressions)})` : ""}`);
    body(`Average CTR: ${pct(sc.ctr)}${prev ? ` (previous period ${pct(prev.ctr)})` : ""}`);
    body(`Average position: ${sc.position === null ? "no impressions" : sc.position.toFixed(1)}`);
    if (sc.topQueries.length) {
      h2("Top search queries");
      for (const q of sc.topQueries.slice(0, 10)) body(`${q.key} - ${Math.round(q.clicks)} clicks, ${Math.round(q.impressions)} impressions, position ${q.position.toFixed(1)}`);
    }
    if (sc.topPages.length) {
      h2("Top landing pages");
      for (const p of sc.topPages.slice(0, 10)) body(`${p.key} - ${Math.round(p.clicks)} clicks, ${Math.round(p.impressions)} impressions`);
    }
    h2("Google index status");
    body(sc.indexing.inspected ? `${sc.indexing.inspected - sc.indexing.notIndexed.length} of ${sc.indexing.inspected} inspected pages are indexed by Google.` : "No pages have been inspected yet.");
    for (const n of sc.indexing.notIndexed.slice(0, 15)) muted(`Not indexed: ${n.url} - ${n.coverage}`);
  }

  // Action plan
  const plan = buildActionPlan(issues);
  doc.addPage();
  h1("Prioritised action plan");
  if (!plan.length) body("No issues were found.");
  plan.forEach((item, i) => {
    ensureSpace(90);
    h2(`${i + 1}. ${item.title}`, COLORS[item.severity as keyof typeof COLORS] ?? COLORS.ink);
    muted(`${item.bucket} - ${item.severity} severity - ${categoryLabel(item.category)} - effort ${item.effort} - confidence ${item.confidence} - ${item.issues.length} affected URL(s)`);
    body(`Why it matters: ${item.why}`);
    body(`Fix: ${item.fix}`);
    body(`Expected benefit: ${item.benefit}`);
    for (const issue of item.issues.slice(0, 6)) {
      ensureSpace(24);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.accent).text(clean(issue.url), { indent: 10 });
      if (issue.evidence[0]) doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted).text(clean(issue.evidence.slice(0, 2).join(" | ")), { indent: 10 });
    }
    if (item.issues.length > 6) muted(`   …and ${item.issues.length - 6} more URLs (see CSV/JSON export).`);
    doc.moveDown(0.4);
  });

  // Developer fix instructions
  doc.addPage();
  h1("Developer Fix Instructions");
  muted("Precise implementation guidance for each task, in priority order. Verify each fix by re-running the audit.");
  plan.forEach((item, i) => {
    ensureSpace(70);
    h2(`${i + 1}. ${item.title}`);
    body(item.implementation);
    body(`Affected: ${item.issues.slice(0, 10).map((x) => x.url).join(", ")}${item.issues.length > 10 ? ", …" : ""}`, { width });
  });

  // Check results
  doc.addPage();
  h1("All checks");
  for (const c of CATEGORIES) {
    ensureSpace(60);
    h2(CATEGORY_LABELS[c]);
    for (const check of checks.filter((x) => x.category === c)) {
      ensureSpace(28);
      const color = check.status === "pass" ? COLORS.pass : check.status === "fail" ? COLORS.critical : check.status === "warning" ? COLORS.medium : COLORS.muted;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(color).text(`[${check.status.toUpperCase()}] `, { continued: true });
      doc.fillColor(COLORS.ink).text(clean(check.title));
      doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.muted).text(clean(check.summary), { indent: 10 });
    }
  }

  // Performance
  if (performance.length) {
    doc.addPage();
    h1("Performance (Google PageSpeed Insights)");
    for (const p of performance) {
      ensureSpace(40);
      h2(`${p.url} (${p.strategy})`);
      if (p.status !== "ok") muted(`Unavailable: ${p.error}`);
      else {
        body(`Score ${p.performanceScore ?? "n/a"}/100 - LCP ${p.lcpMs ? (p.lcpMs / 1000).toFixed(1) + " s" : "n/a"} - CLS ${p.cls?.toFixed(3) ?? "n/a"} - TBT ${p.tbtMs ? Math.round(p.tbtMs) + " ms" : "n/a"} - Field INP ${p.fieldInpMs ? Math.round(p.fieldInpMs) + " ms" : "no field data"}`);
        for (const o of p.opportunities.slice(0, 4)) muted(`- ${o.title}${o.displayValue ? ` (${o.displayValue})` : ""}`);
      }
    }
  }

  // AI consultant
  if (audit.aiReport) {
    doc.addPage();
    h1("AI consultant notes");
    muted(`Generated by ${audit.aiModel ?? "an AI model"} from the measured findings above. Suggestions are labelled as such in the text.`);
    doc.moveDown(0.4);
    for (const line of audit.aiReport.split("\n")) {
      const heading = /^#{1,3}\s+(.*)/.exec(line);
      if (heading) h2(heading[1]);
      else if (line.trim()) body(line.replace(/\*\*/g, "").replace(/^\s*[-*]\s+/, "- "));
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(COLORS.muted).text(`SEO Health Monitor - ${clean(meta?.origin ?? audit.startUrl)} - page ${i + 1} of ${range.count}`, 50, doc.page.height - 35, { width, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}
