"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronLeft, Printer, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { buildPrintRecipe, TOO_LONG_WARNING, type FitResult, type PrintKind, type PrintRecipe } from "@/lib/print-recipe";
import { CAP_MESSAGE } from "@/lib/print-job";
import type { AllergenIndex } from "@/lib/allergens";
import { PRINT_CSS } from "./print-css";
import { RecipePage } from "./recipe-page";

/** A4 at 96dpi: 210mm. The sheet is drawn at this size and scaled down with a transform to fit the screen. */
const SHEET_PX = 793.7;
const SHEET_PX_H = 1122.5;

/**
 * The print preview: the recipes exactly as they will print, one A4 page each, full screen over the app (so the app shell is
 * never on screen or on paper), with a toolbar that is never printed. Rendered into its own element on <body>; while it is
 * open `<html data-print-job>` makes the print stylesheet hide everything else. Print fits every page again first (fonts must
 * be loaded), then calls window.print(); the browser's own print dialog has Save as PDF, so there is no PDF code here.
 */
export function PrintView({ kind, ids, capped }: { kind: PrintKind; ids: string[]; capped: boolean }) {
  const store = useStore();
  const router = useRouter();
  const [root, setRoot] = useState<HTMLElement | null>(null);

  // the overlay element, the print switch on <html>, and a document title that names the file when Save as PDF is chosen
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

  const index = useMemo<AllergenIndex>(() => ({ ...store.index, items: new Map(store.items.map((i) => [i.id, i])) }), [store.index, store.items]);
  const recipes = useMemo(() => {
    if (!store.ready) return [] as PrintRecipe[];
    return ids.map((id) => buildPrintRecipe(kind, id, { index, venueById: store.venueById })).filter((r): r is PrintRecipe => !!r);
  }, [store.ready, ids, kind, index, store.venueById]);
  const missing = store.ready ? ids.length - recipes.length : 0;

  useEffect(() => {
    document.title = recipes.length === 1 ? `${recipes[0].title} Recipe` : recipes.length > 1 ? `${recipes.length} Recipes` : "Print Recipes";
  }, [recipes]);

  // every page's fit, and a way to run them all again (fonts loaded, just before printing)
  const refitters = useRef(new Map<string, () => void>());
  const [fits, setFits] = useState<Record<string, FitResult>>({});
  const register = useCallback((id: string, refit: () => void) => {
    refitters.current.set(id, refit);
    return () => {
      if (refitters.current.get(id) === refit) refitters.current.delete(id);
    };
  }, []);
  const onFit = useCallback((id: string, r: FitResult) => {
    setFits((prev) => (prev[id]?.fits === r.fits && prev[id]?.size === r.size ? prev : { ...prev, [id]: r }));
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
    else router.push(kind === "prep" ? "/ingredients?type=preps" : "/menu");
  };

  const tooLong = recipes.filter((r) => fits[r.id] && !fits[r.id].fits).length;

  // preview scale: A4 shrunk to the screen width, never enlarged
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!root) return;
    const measure = () => setScale(Math.min(1, Math.max(0.2, (root.clientWidth - 32) / SHEET_PX)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [root]);

  if (!root) return <p className="py-10 text-center text-[15px] text-label-2">Preparing the print preview…</p>;

  const ready = store.ready;
  const count = recipes.length;
  return createPortal(
    <>
      <style>{PRINT_CSS}</style>
      <div className="pr-noprint bar-blur sticky top-0 z-10 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]" style={{ boxShadow: "inset 0 -0.5px 0 var(--separator)" }}>
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={onBack} className="-ml-1 inline-flex min-h-[44px] min-w-[44px] items-center gap-0 pr-3 text-[17px] font-medium text-accent">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
            Back
          </button>
          <div className="min-w-0 flex-1 basis-[160px]">
            <p className="truncate text-[17px] font-semibold leading-tight">Print Preview</p>
            <p className="truncate text-[13px] leading-tight text-label-2">{!ready ? "Loading recipes" : count ? `${count} ${count === 1 ? "recipe" : "recipes"}, one A4 page each` : "Nothing to print"}</p>
          </div>
          <button type="button" onClick={() => void onPrint()} disabled={!count} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl bg-accent-fill px-5 text-[17px] font-semibold text-accent-on transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40">
            <Printer className="h-5 w-5" strokeWidth={2.25} aria-hidden />
            Print
          </button>
        </div>
        {tooLong || missing || capped ? (
          <div className="mx-auto mt-1 max-w-[860px] space-y-1 text-[14px] leading-snug" role="status">
            {tooLong ? (
              <p className="flex items-start gap-2 font-semibold text-warn">
                <TriangleAlert className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                <span>
                  {tooLong} {tooLong === 1 ? "recipe is" : "recipes are"} too long for one page and will print on two.
                </span>
              </p>
            ) : null}
            {missing ? <p className="text-label-2">{missing} {missing === 1 ? "recipe" : "recipes"} could not be found and {missing === 1 ? "was" : "were"} left off.</p> : null}
            {capped ? <p className="text-label-2">{CAP_MESSAGE}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="pr-stage">
        {ready && !count ? (
          <div className="pr-noprint mt-16 max-w-sm text-center">
            <p className="text-[20px] font-semibold">Nothing To Print</p>
            <p className="mt-1.5 text-[15px] text-label-2">The recipe may have been deleted. Go back and choose again.</p>
          </div>
        ) : null}
        {recipes.map((r) => (
          <PageBox key={r.id} recipe={r} scale={scale} long={!!fits[r.id] && !fits[r.id].fits} register={register} onFit={onFit} />
        ))}
      </div>
    </>,
    root,
  );
}

/** One page in the preview: its warning (screen only) above the scaled A4 sheet. The box follows the sheet's real height, so a long recipe shows as taller than one page. */
function PageBox({ recipe, scale, long, register, onFit }: { recipe: PrintRecipe; scale: number; long: boolean; register: (id: string, refit: () => void) => () => void; onFit: (id: string, r: FitResult) => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(SHEET_PX_H);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <section className="pr-item" style={{ width: SHEET_PX * scale }} aria-label={recipe.title}>
      {long ? (
        <p className="pr-warn pr-noprint" role="alert">
          {TOO_LONG_WARNING}
        </p>
      ) : null}
      <div className="pr-scale" style={{ width: SHEET_PX * scale, height: h * scale }}>
        <div ref={sheetRef} className="pr-sheet" style={{ transform: `scale(${scale})` }}>
          <RecipePage recipe={recipe} register={register} onFit={onFit} />
        </div>
      </div>
    </section>
  );
}
