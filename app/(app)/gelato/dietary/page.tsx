"use client";

import { useMemo } from "react";
import { ChevronLeft, Printer } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { Empty, PageHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import { ALLERGEN_NOTICE } from "@/lib/allergens";
import { flavourName } from "@/lib/gelato";
import { buildDietarySheet, gelatoLabelsForPrep, type SheetSection } from "@/lib/gelato-labels";

/** Print rules: A4 portrait, white paper, black text, no app chrome. The colour blocks keep their colour on paper. */
const CSS = `
@media print {
  @page { size: A4 portrait; margin: 14mm; }
  html, body { background: #fff !important; color: #000 !important; }
  aside, nav[aria-label="Main"] { display: none !important; }
  div[class*="lg:pl-"] { padding-left: 0 !important; }
  main { max-width: none !important; padding: 0 !important; }
  .dietary-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000; }
  .dietary-sheet .ds-card { background: #fff !important; box-shadow: none !important; border: 1px solid #000; border-radius: 0 !important; break-inside: avoid; }
  .dietary-sheet .ds-row { border-color: #999 !important; color: #000 !important; }
}
`;

function Section({ s }: { s: SheetSection }) {
  return (
    <section className="ds-card overflow-hidden rounded-2xl bg-surface">
      <h2 className="px-4 py-2.5 text-[17px] font-bold text-[#141414] print:text-[15pt]" style={{ backgroundColor: s.swatch }}>
        {s.heading}
      </h2>
      {s.rows.length ? (
        <ul>
          {s.rows.map((r, i) => (
            <li key={`${r.text}-${i}`} className="ds-row border-t-[0.5px] border-sep px-4 py-2 text-[17px] sm:text-[15px] print:py-1 print:text-[13pt]">
              {r.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ds-row border-t-[0.5px] border-sep px-4 py-2 text-[15px] text-label-2 print:py-1 print:text-[12pt]">None</p>
      )}
    </section>
  );
}

export default function GelatoDietaryPage() {
  const store = useStore();
  const venue = store.gelato.venue;
  const flavours = store.gelato.flavours;
  const sheet = useMemo(
    () =>
      buildDietarySheet(
        flavours.filter((f) => f.active).map((f) => ({ name: flavourName(f), labels: gelatoLabelsForPrep(f, store.index).labels })),
      ),
    [flavours, store.index],
  );
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Brisbane" });
  const activeCount = flavours.filter((f) => f.active).length;

  if (!venue) return <Empty title="Gelato Rumba Isn’t Set Up" body="There’s no Gelato Rumba venue in the system." />;

  return (
    <div className="dietary-sheet">
      <style>{CSS}</style>
      <div className="pt-2 lg:pt-6 print:hidden">
        <BackLink path="/gelato" fallback="/gelato" className="btn-text -ml-1 !gap-0 !text-accent">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Price Grid
        </BackLink>
      </div>
      <div className="print:hidden">
        <PageHeader
          className="!pt-1 lg:!pt-1"
          title="Dietary Requirements"
          subtitle={`${venue.name} · ${activeCount} ${activeCount === 1 ? "flavour" : "flavours"}`}
          trailing={
            <button type="button" className="btn-primary hidden sm:inline-flex" onClick={() => window.print()}>
              <Printer className="h-4 w-4" strokeWidth={2.25} /> Print
            </button>
          }
        />
        <p className="max-w-2xl px-1 pb-3 text-[15px] text-label-2">Each flavour’s labels are worked out from its ingredients, unless someone has set them by hand on the flavour page. Print it on A4 to laminate.</p>
        <button type="button" className="btn-primary mb-4 w-full sm:hidden" onClick={() => window.print()}>
          <Printer className="h-4 w-4" strokeWidth={2.25} /> Print
        </button>
      </div>

      <h1 className="display hidden pb-3 text-[34pt] leading-none print:block">
        {venue.name}
        <span className="block pt-1 text-[18pt]">Dietary Requirements</span>
      </h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start print:grid-cols-2 print:items-start print:gap-3">
        <div className="space-y-4 print:space-y-3">
          {sheet.left.map((s) => (
            <Section key={s.id} s={s} />
          ))}
        </div>
        <div className="space-y-4 print:space-y-3">
          {sheet.right.map((s) => (
            <Section key={s.id} s={s} />
          ))}
        </div>
      </div>

      <p className="px-1 pt-4 text-[13px] text-label-2 print:pt-3 print:text-[9pt] print:text-black">
        {ALLERGEN_NOTICE} Printed {today}.
      </p>
    </div>
  );
}
