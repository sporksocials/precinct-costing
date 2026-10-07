"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useStore } from "@/lib/store";
import type { PosVenue } from "@/lib/pos-list";
import { useVenue, VENUE_SHORT } from "@/components/venue";
import { cx, useToast } from "@/components/ui";

/**
 * Download POS List: one quiet button on the Menu page. Makes the Excel file the venue team keys or imports into the till,
 * for the venue chosen above (All = one file, one tab per venue). Everything is worked out from what the app already holds;
 * nothing is saved. The Excel library is loaded only when this is tapped, so it never weighs on the page itself.
 */
export function PosListButton({ className }: { className?: string }) {
  const store = useStore();
  const toast = useToast();
  const { venue } = useVenue();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const now = new Date();
      const venues: PosVenue[] = store.venues.map((v) => ({ id: v.id, slug: v.slug, name: VENUE_SHORT[v.slug] ?? v.name, short: VENUE_SHORT[v.slug] ?? v.name }));
      // the list logic and the Excel library are both loaded here, on the tap, so neither is part of the Menu page itself
      const { brisbaneDateLabel, buildPosSheets, posFileName } = await import("@/lib/pos-list");
      const sheets = buildPosSheets(
        {
          items: [...store.itemCosts.values()].map((c) => c.item),
          beers: store.beer.beers,
          beerServes: store.beer.serves,
          gelatoServes: store.gelato.serves,
        },
        venues,
        venue?.slug ?? null,
      );
      if (!sheets.length) {
        toast.show({ message: venue ? `${venue.name} has no active menu items to list yet.` : "There are no active menu items to list yet." });
        return;
      }
      const { buildPosXlsx } = await import("@/lib/pos-list-xlsx");
      const data = await buildPosXlsx(sheets, { gstRate: Number(store.settings.gst_rate) || 0.1, dateLabel: brisbaneDateLabel(now) });
      const blob = new Blob([data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = posFileName(venue ? (VENUE_SHORT[venue.slug] ?? venue.name) : null, now);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.show({ message: "POS list downloaded" });
    } catch {
      toast.show({ message: "The POS list could not be made. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || store.loading}
      aria-busy={busy}
      className={cx("inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-[15px] font-semibold text-accent transition active:opacity-70 disabled:opacity-40", className)}
    >
      <Download className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
      {busy ? "Preparing..." : "Download POS List"}
    </button>
  );
}
