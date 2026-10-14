import { AlertTriangle } from "lucide-react";
import type { ScoreAssessment } from "@/lib/audit/scoring";

/** Coverage line shown under every on-site health score. */
export function ScoreCoverage({ assessment, compact = false }: { assessment: ScoreAssessment; compact?: boolean }) {
  const pct = Math.round(assessment.coverage * 100);
  return (
    <div className={compact ? "text-center" : ""}>
      {assessment.provisional && (
        <span className="inline-flex items-center gap-1 rounded bg-sev-medium/12 px-2 py-0.5 text-xs font-semibold text-[#7a5b00] ring-1 ring-inset ring-sev-medium/40">
          <AlertTriangle className="size-3.5" aria-hidden />
          Provisional score
        </span>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Audit coverage <span className="font-semibold tabular-nums text-foreground">{pct}%</span> of the scoring model measured
      </p>
      {assessment.provisional && !compact && (
        <ul className="mt-1 text-xs text-muted-foreground">
          {assessment.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
