import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function NoAuditYet({ message = "Run your first audit to see findings here." }: { message?: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-card px-6 py-14 text-center">
      <h2 className="text-xl font-semibold">No completed audits yet</h2>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground">{message}</p>
      <Link href="/audits/new" className={buttonVariants({ className: "mt-6" })}>
        Run an audit
      </Link>
    </div>
  );
}
