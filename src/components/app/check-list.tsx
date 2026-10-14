import { ChevronRight } from "lucide-react";
import type { CheckRow, IssueRow } from "@/lib/audit/repository";
import type { IssueLike } from "@/lib/reports/action-plan";
import { priorityBucket } from "@/lib/audit/issues";
import { SeverityBadge, StatusIcon, StatusLabel } from "./status";
import { shortUrl } from "./format";

export function IssueDetail({ issue, showFixDetails = true }: { issue: IssueLike; showFixDetails?: boolean }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={issue.severity} />
        <span className="font-medium">{issue.title}</span>
      </div>
      <a href={issue.url} target="_blank" rel="noreferrer noopener" className="break-all font-mono text-xs text-primary hover:underline">
        {issue.url}
      </a>
      {issue.evidence.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Evidence collected</p>
          <ul className="mt-1 space-y-0.5 rounded-md bg-muted/70 px-3 py-2 font-mono text-xs">
            {issue.evidence.map((e, i) => (
              <li key={i} className="break-words">{e}</li>
            ))}
          </ul>
        </div>
      )}
      {showFixDetails && (
        <dl className="grid gap-2 sm:grid-cols-[9rem_1fr]">
          <dt className="text-muted-foreground">Why it matters</dt>
          <dd>{issue.why}</dd>
          <dt className="text-muted-foreground">Recommended fix</dt>
          <dd>{issue.fix}</dd>
          <dt className="text-muted-foreground">How to implement</dt>
          <dd className="whitespace-pre-wrap">{issue.implementation}</dd>
          <dt className="text-muted-foreground">Expected benefit</dt>
          <dd>{issue.benefit}</dd>
          <dt className="text-muted-foreground">Priority</dt>
          <dd>
            {priorityBucket(issue.priorityScore)} · score {issue.priorityScore} · impact {issue.impact}/5 · {issue.confidence} confidence · {issue.effort} effort
          </dd>
        </dl>
      )}
    </div>
  );
}

/** All checks of one category, each expandable to its per-URL issues. */
export function CheckList({ checks, issues }: { checks: CheckRow[]; issues: IssueRow[] }) {
  const measured = checks.filter((c) => c.status !== "unavailable");
  const unverified = checks.filter((c) => c.status === "unavailable");
  const order: Record<string, number> = { fail: 0, warning: 1, info: 2, pass: 3 };
  return (
    <div className="flex flex-col gap-6">
      <ul className="divide-y rounded-lg border bg-card">
        {[...measured]
          .sort((a, b) => order[a.status] - order[b.status])
          .map((check) => {
            const checkIssues = issues.filter((i) => i.checkId === check.checkId);
            return (
              <li key={check.checkId}>
                <details className="group" open={check.status === "fail" && checkIssues.length <= 3}>
                  <summary className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/40">
                    <StatusIcon status={check.status} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{check.title}</span>
                        <StatusLabel status={check.status} />
                        {check.score !== null && check.weight > 0 && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {Math.round(check.score * 100)}% · weight {check.weight}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{check.summary}</p>
                    </div>
                    {checkIssues.length > 0 && (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {checkIssues.length} {checkIssues.length === 1 ? "issue" : "issues"}
                        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
                      </span>
                    )}
                  </summary>
                  {checkIssues.length > 0 && (
                    <div className="border-t bg-background/60 px-4 py-4 sm:pl-11">
                      <p className="mb-3 text-xs text-muted-foreground">{check.description}</p>
                      <ul className="flex flex-col gap-3">
                        {checkIssues.map((issue, i) => (
                          <li key={issue.issueKey}>
                            <details className="rounded-md border bg-card" open={i === 0 && checkIssues.length === 1}>
                              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                                <SeverityBadge severity={issue.severity} />
                                <span className="font-mono text-xs">{shortUrl(issue.url)}</span>
                                <span className="text-muted-foreground">{issue.title}</span>
                              </summary>
                              <div className="border-t px-3 py-3">
                                <IssueDetail issue={issue} />
                              </div>
                            </details>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </details>
              </li>
            );
          })}
      </ul>
      {unverified.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Not verified by this audit</h3>
          <p className="mb-2 text-sm text-muted-foreground">These checks need data a public crawl can’t provide. They are excluded from scores, never counted as passed or failed.</p>
          <ul className="divide-y rounded-lg border border-dashed bg-card/60">
            {unverified.map((c) => (
              <li key={c.checkId} className="flex items-start gap-3 px-4 py-3">
                <StatusIcon status="unavailable" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-sm text-muted-foreground">{c.unavailableReason ?? c.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
