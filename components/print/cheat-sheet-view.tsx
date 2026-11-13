"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronLeft, Printer, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { buildCheatSheet, SHEET_TITLE, type CheatPage, type ScaleFit } from "@/lib/cheat-sheet";
import { CHEAT_CSS } from "./cheat-sheet-css";
import { CheatSheetPage } from "./cheat-sheet-page";

/** A4 landscape at 96dpi: 297mm wide, and the sheet's 209.6mm tall. The sheet is drawn at this size and scaled down to the screen width. */
const SHEET_PX_W = 1122.5;
const SHEET_PX_H = 792.2;

/**
 * The Kitchen Cheat Sheet preview: the pages exactly as they will print, full screen over the app (so the app shell is never
 * on screen or on paper), with a toolbar that is never printed. Same technique as the recipe print (components/print/print-view.tsx):
 * its own element on <body>, `<html data-print-job>` makes the print stylesheet hide everything else, and Print fits every page
 * again once fonts are loaded and then calls window.print(); the browser's own dialog has Save as PDF.
 */
export function CheatSheetView({ slug }: { slug: string | null }) {
  const store = useStore();
  const router = useRouter();
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.id = "print-root";
    document.body.appendChild(el);
    document.documentElement.setAttribute("data-print-job", "1");
    const title = document.title;
    setRoot(el);
    return () => {
      document.documentElement.removeAttribute("data-print-job");
      document.title = title;
      el.remove();
      setRoot(null);
    };
  }, []);

  const sheet = useMemo(() => {
    if (!store.ready || !slug) return null;
    return buildCheatSheet(slug, { items: store.items, index: store.index, venueById: store.venueById });
  }, [store.ready, slug, store.items, store.index, store.venueById]);

  useEffect(() => {
    document.title = sheet ? `${sheet.venue.short} Kitchen Cheat Sheet` : "Kitchen Cheat Sheet";
  }, [sheet]);

  // every page's fit, and a way to run them all again (fonts loaded, just before printing)
  const refitters = useRef(new Map<string, () => void>());
  const [fits, setFits] = useState<Record<string, ScaleFit>>({});
  const register = useCallback((id: string, refit: () => void) => {
    refitters.current.set(id, refit);
    return () => {
      if (refitters.current.get(id) === refit) refitters.current.delete(id);
    };
  }, []);
  const onFit = useCallback((id: string, r: ScaleFit) => {
    setFits((prev) => (prev[id]?.fits === r.fits && prev[id]?.scale === r.scale ? prev : { ...prev, [id]: r }));
  }, []);
  const refitAll = useCallback(() => refitters.current.forEach((f) => f()), []);

  // fonts arriving late change line breaks: fit again when they land, and when the browser itself starts to print (Ctrl+P)
  useEffect(() => {
    if (!root) return;
    let live = true;
    void document.fonts?.ready.then(() => live && refitAll());
    const onDone = () => refitAll();
    document.fonts?.addEventListener?.("loadingdone", onDone);
    window.addEventListener("beforeprint", onDone);
    return () => {
      live = false;
      document.fonts?.removeEventListener?.("loadingdone", onDone);
      window.removeEventListener("beforeprint", onDone);
    };
  }, [root, refitAll]);

  const onPrint = async () => {
    // normally fonts are long loaded and this stays inside the tap, which iPad and iPhone Safari need to open the print sheet
    if (document.fonts && document.fonts.status !== "loaded") await document.fonts.ready;
    refitAll();
    window.print();
  };
  const onBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(slug ? `/menu?venue=${slug}` : "/menu");
  };

  // preview scale: A4 landscape shrunk to the screen width, never enlarged
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!root) return;
    const measure = () => setScale(Math.min(1, Math.max(0.2, (root.clientWidth - 32) / SHEET_PX_W)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [root]);

  if (!root) return <p className="py-10 text-center text-[15px] text-label-2">Preparing the print preview…</p>;

  const ready = store.ready;
  const dishes = sheet?.dishCount ?? 0;
  const pages = sheet?.pages ?? [];
  const full = pages.filter((p) => fits[String(p.n)] && !fits[String(p.n)].fits).length;
  const venueName = sheet?.venue.name ?? "this venue";
  const sub = !ready
    ? "Loading dishes"
    : dishes
      ? `${dishes} ${dishes === 1 ? "dish" : "dishes"}, ${pages.length} ${pages.length === 1 ? "page" : "pages"}, A4 landscape`
      : "Nothing to print";

  return createPortal(
    <>
      <style>{CHEAT_CSS}</style>
      <div className="pr-noprint bar-blur sticky top-0 z-10 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]" style={{ boxShadow: "inset 0 -0.5px 0 var(--separator)" }}>
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={onBack} className="-ml-1 inline-flex min-h-[44px] min-w-[44px] items-center gap-0 pr-3 text-[17px] font-medium text-accent">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
            Back
          </button>
          <div className="min-w-0 flex-1 basis-[160px]">
            <p className="truncate text-[17px] font-semibold leading-tight">{sheet ? `${sheet.venue.short} ${SHEET_TITLE}` : SHEET_TITLE}</p>
            <p className="truncate text-[13px] leading-tight text-label-2">{sub}</p>
          </div>
          <button type="button" onClick={() => void onPrint()} disabled={!dishes} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl bg-accent-fill px-5 text-[17px] font-semibold text-accent-on transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40">
            <Printer className="h-5 w-5" strokeWidth={2.25} aria-hidden />
            Print
          </button>
        </div>
        {full ? (
          <div className="mx-auto mt-1 max-w-[860px] text-[14px] leading-snug" role="status">
            <p className="flex items-start gap-2 font-semibold text-warn">
              <TriangleAlert className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
              <span>
                {full} {full === 1 ? "page is" : "pages are"} too full for the smallest text size. Some lines at the bottom may be cut off.
              </span>
            </p>
          </div>
        ) : null}
      </div>

      <div className="pr-stage">
        {ready && !sheet ? (
          <div className="pr-noprint mt-16 max-w-sm text-center">
            <p className="text-[20px] font-semibold">Choose A Venue</p>
            <p className="mt-1.5 text-[15px] text-label-2">Go back to the Menu, choose a venue, then tap Print Cheat Sheet.</p>
          </div>
        ) : null}
        {ready && sheet && !dishes ? (
          <div className="pr-noprint mt-16 max-w-sm text-center">
            <p className="text-[20px] font-semibold">No Food Dishes To Print</p>
            <p className="mt-1.5 text-[15px] text-label-2">No food dishes to print for {venueName}. Active food dishes on the Menu appear here.</p>
          </div>
        ) : null}
        {sheet
          ? pages.map((p) => <PageBox key={p.n} page={p} sheet={sheet} scale={scale} register={register} onFit={onFit} />)
          : null}
      </div>
    </>,
    root,
  );
}

/** One page in the preview: the scaled A4 landscape sheet in a box that follows its scaled size. */
function PageBox({
  page,
  sheet,
  scale,
  register,
  onFit,
}: {
  page: CheatPage;
  sheet: NonNullable<ReturnType<typeof buildCheatSheet>>;
  scale: number;
  register: (id: string, refit: () => void) => () => void;
  onFit: (id: string, r: ScaleFit) => void;
}) {
  return (
    <section className="pr-item" style={{ width: SHEET_PX_W * scale }} aria-label={`Page ${page.n} of ${sheet.total}`}>
      <div className="pr-scale" style={{ width: SHEET_PX_W * scale, height: SHEET_PX_H * scale }}>
        <div className="cs-sheet" style={{ transform: `scale(${scale})` }}>
          <CheatSheetPage page={page} venue={sheet.venue} printedOn={sheet.printedOn} total={sheet.total} register={register} onFit={onFit} />
        </div>
      </div>
    </section>
  );
}
