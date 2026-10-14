import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Beta customers never get links into the owner-only Phase 1 area. */
export default function BetaNotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">That page doesn’t exist or isn’t available to your account.</p>
      <Link href="/beta" className={buttonVariants({ className: "mt-6" })}>Go to your dashboard</Link>
    </div>
  );
}
