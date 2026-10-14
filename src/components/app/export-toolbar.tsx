"use client";

import { Download, FileJson, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "./copy-button";

export function ExportToolbar({ auditId, showPrint = false }: { auditId: number; showPrint?: boolean }) {
  const href = (format: string) => `/api/audits/${auditId}/export?format=${format}`;
  return (
    <div className="no-print flex flex-wrap gap-2">
      <a href={href("pdf")} className={buttonVariants()}>
        <Download /> PDF
      </a>
      <a href={href("json")} className={buttonVariants({ variant: "outline" })}>
        <FileJson /> JSON
      </a>
      <a href={href("csv")} className={buttonVariants({ variant: "outline" })}>
        <FileSpreadsheet /> CSV
      </a>
      <a href={href("md")} className={buttonVariants({ variant: "outline" })}>
        <FileText /> Tasks (.md)
      </a>
      <CopyButton url={href("tasks")} label="Copy developer tasks" copiedMessage="Developer task list copied" />
      {showPrint && (
        <Button variant="ghost" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      )}
    </div>
  );
}
