import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/audit/types";
import { CATEGORY_WEIGHTS } from "@/lib/audit/scoring";
import { TONE_COLOR, scoreTone } from "./format";

/**
 * The overall health dial: a 270° gauge split into one segment per category,
 * segment length proportional to the category's weight, filled to its score.
 */
export function ScoreDial({ overall, categories, size = 248 }: { overall: number | null; categories: Partial<Record<Category, number | null>>; size?: number }) {
  const r = 100;
  const stroke = 16;
  const gapDeg = 4;
  const sweep = 270;
  const start = 135;
  const total = CATEGORIES.reduce((s, c) => s + CATEGORY_WEIGHTS[c], 0);
  const usable = sweep - gapDeg * (CATEGORIES.length - 1);

  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [120 + r * Math.cos(rad), 120 + r * Math.sin(rad)];
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = polar(from);
    const [x2, y2] = polar(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };

  const spans = CATEGORIES.map((c) => (CATEGORY_WEIGHTS[c] / total) * usable);
  const segments = CATEGORIES.map((c, i) => {
    const from = start + spans.slice(0, i).reduce((sum, s) => sum + s + gapDeg, 0);
    return { c, from, to: from + spans[i], score: categories[c] ?? null };
  });
  const tone = scoreTone(overall);

  return (
    <figure className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 240 240" width={size} height={size} role="img" aria-label={`Overall SEO health ${overall ?? "unavailable"} out of 100`}>
        {segments.map((s) => (
          <g key={s.c}>
            <title>{`${CATEGORY_LABELS[s.c]}: ${s.score ?? "unavailable"} (weight ${CATEGORY_WEIGHTS[s.c]}%)`}</title>
            <path d={arc(s.from, s.to)} stroke="var(--muted)" strokeWidth={stroke} fill="none" strokeLinecap="butt" />
            {s.score !== null ? (
              <path d={arc(s.from, s.from + Math.max(0.5, ((s.to - s.from) * s.score) / 100))} stroke={TONE_COLOR[scoreTone(s.score)]} strokeWidth={stroke} fill="none" strokeLinecap="butt" />
            ) : (
              <path d={arc(s.from, s.to)} stroke="var(--sev-na)" strokeOpacity={0.35} strokeWidth={stroke} strokeDasharray="3 4" fill="none" />
            )}
          </g>
        ))}
      </svg>
      <figcaption className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-6xl font-semibold leading-none tabular-nums" style={{ color: TONE_COLOR[tone] }}>
          {overall ?? "—"}
        </span>
        <span className="mt-1 text-sm text-muted-foreground">out of 100</span>
      </figcaption>
    </figure>
  );
}

export function ScoreBar({ label, score, weight, href }: { label: string; score: number | null; weight?: number; href?: string }) {
  const tone = scoreTone(score);
  const content = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-heading text-lg font-semibold tabular-nums" style={{ color: TONE_COLOR[tone] }}>
          {score ?? <span className="text-sm font-normal text-muted-foreground">Not measured</span>}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${score ?? 0}%`, background: TONE_COLOR[tone] }} />
      </div>
      {weight !== undefined && <p className="mt-1 text-xs text-muted-foreground">{weight}% of overall score</p>}
    </>
  );
  return href ? (
    <a href={href} className="block rounded-md p-2 -m-2 hover:bg-muted/60">
      {content}
    </a>
  ) : (
    <div>{content}</div>
  );
}
