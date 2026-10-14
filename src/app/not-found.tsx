import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">That audit or page doesn’t exist. It may have been deleted.</p>
      <Link href="/audits" className={buttonVariants({ className: "mt-6" })}>Go to audit history</Link>
    </div>
  );
}
