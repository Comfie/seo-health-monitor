import { Info } from "lucide-react";

/** Honest scope statement for the private beta. */
export function BetaNotice() {
  return (
    <div className="mb-6 flex gap-3 rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        Your workspace is private. Connect Search Console for Google search and indexing insights, and run audits for on-site findings and mobile and desktop PageSpeed measurements. Provider availability and your account allowances apply.
      </p>
    </div>
  );
}
