"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copies text, or fetches it from `url` first (used for the developer task list). */
export function CopyButton({ text, url, label = "Copy", copiedMessage = "Copied to clipboard" }: { text?: string; url?: string; label?: string; copiedMessage?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (text !== undefined) {
        await navigator.clipboard.writeText(text);
      } else {
        const load = fetch(url ?? "").then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        });
        // Passing a promise to ClipboardItem keeps the user gesture alive in Safari.
        if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
          await navigator.clipboard.write([new ClipboardItem({ "text/plain": load.then((t) => new Blob([t], { type: "text/plain" })) })]);
        } else {
          await navigator.clipboard.writeText(await load);
        }
      }
      setCopied(true);
      toast.success(copiedMessage);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(`Couldn't copy: ${(err as Error).message}`);
    }
  };
  return (
    <Button variant="outline" onClick={copy}>
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  );
}
