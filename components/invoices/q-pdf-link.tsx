"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileText } from "lucide-react";
import { signedPdfUrl } from "@/lib/invoice-data-extra";
import { TouchButton } from "@/components/ordering/touch";

/**
 * "View Invoice Page": opens the split PDF of this invoice in a new tab. The link is signed for ten minutes and made when the
 * button is pressed, so an old screen never holds a dead link. The tab is opened first, inside the tap, so a phone's pop-up
 * blocker allows it, and pointed at the file once the link is ready.
 */
export function PdfLink({ sb, path, className }: { sb: SupabaseClient; path: string | null | undefined; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!path) return <p className="text-[13px] text-label-2">The page of this invoice is not saved yet.</p>;
  async function open() {
    setProblem(null);
    setBusy(true);
    const tab = window.open("about:blank", "_blank");
    const url = await signedPdfUrl(sb, path);
    setBusy(false);
    if (!url) {
      tab?.close();
      setProblem("The invoice page could not be opened. Try again in a moment.");
      return;
    }
    if (tab) tab.location.href = url;
    else window.location.href = url;
  }
  return (
    <div className={className}>
      <TouchButton variant="tinted" className="w-full sm:w-auto" onClick={() => void open()} disabled={busy}>
        <FileText className="h-5 w-5" strokeWidth={2} aria-hidden />
        {busy ? "Opening..." : "View Invoice Page"}
      </TouchButton>
      {problem ? (
        <p role="alert" className="mt-1.5 text-[13px] text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
