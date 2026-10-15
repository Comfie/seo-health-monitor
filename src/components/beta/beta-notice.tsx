import { Info } from "lucide-react";

/** Honest scope statement for the private beta. */
export function BetaNotice() {
  return (
    <div className="mb-6 flex gap-3 rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        Private beta: add your websites, run SEO audits, compare scans, download reports and generate Fix with AI instructions. You can also
        connect your own Google Search Console for real search performance and index status. Everything is stored privately for your account.
      </p>
    </div>
  );
}
