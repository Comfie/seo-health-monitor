import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuditProgress } from "@/components/app/audit-progress";
import { PageHeader } from "@/components/app/page-header";
import { RerunAuditButton } from "@/components/app/rerun-button";
import { getAuditRow } from "@/lib/audit/repository";

async function AuditContent({ params }: PageProps<"/audits/[id]">) {
  await connection();
  const id = Number.parseInt((await params).id, 10);
  const audit = Number.isFinite(id) ? getAuditRow(id) : null;
  if (!audit) notFound();
  if (audit.status === "completed") redirect(`/?audit=${audit.id}`);

  if (audit.status === "failed") {
    return (
      <>
        <PageHeader title={`Audit #${audit.id} failed`} description={audit.startUrl} actions={<RerunAuditButton url={audit.inputUrl} label="Try again" />} />
        <Alert variant="destructive" className="max-w-2xl">
          <AlertCircle />
          <AlertTitle>The audit couldn’t be completed</AlertTitle>
          <AlertDescription>
            <p>{audit.error ?? "Unknown error."}</p>
            <p className="mt-2">Check the address opens in a browser, that it is a public website (not localhost or a private network), and that it isn’t blocking automated requests. Then try again.</p>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title={`Auditing ${audit.host}`} description={`Audit #${audit.id} · ${audit.startUrl}`} />
      <div className="max-w-2xl">
        <AuditProgress auditId={audit.id} initial={{ status: audit.status, stage: audit.stage, progress: audit.progress, log: audit.log, error: audit.error }} />
      </div>
    </>
  );
}

export default function AuditPage(props: PageProps<"/audits/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <AuditContent {...props} />
    </Suspense>
  );
}
