"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { signedPdfUrl } from "@/lib/invoice-data-extra";
import { TouchButton } from "@/components/ordering/touch";

/**
 * "View Invoice": opens the invoice's own PDF in a new tab so the person can look before they decide. The signed link lasts ten
 * minutes and is made when the button is pressed (an old screen never holds a dead link). The tab is opened first, inside the
 * tap, so a phone's pop-up blocker allows it, and pointed at the file once the link is ready.
 */
export function ViewInvoiceButton({ path, className, label = "View Invoice" }: { path: string | null | undefined; className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!path) return <p className="text-[13px] text-label-2">The page of this invoice is not saved yet.</p>;
  async function open() {
    setProblem(null);
    setBusy(true);
    const tab = window.open("about:blank", "_blank");
    const url = await signedPdfUrl(getSupabaseBrowser(), path);
    setBusy(false);
    if (!url) {
      tab?.close();
      setProblem("The invoice could not be opened. Try again in a moment.");
      return;
    }
    if (tab) tab.location.href = url;
    else window.location.href = url;
  }
  return (
    <div className={className}>
      <TouchButton variant="tinted" className="w-full sm:w-auto" onClick={() => void open()} disabled={busy}>
        <FileText aria-hidden className="h-5 w-5" strokeWidth={2} />
        {busy ? "Opening..." : label}
      </TouchButton>
      {problem ? (
        <p role="alert" className="mt-1.5 text-[13px] text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
