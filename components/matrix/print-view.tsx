"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, CircleHelp, Printer, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { buildRows, crossContactFromSettings, matrixSections, type MatrixState } from "@/lib/allergy-matrix";
import { ANSWER_COL_MM, DISH_COL_MM, MATRIX_PRINT_CSS, PAGE_W_MM, buildMatrixSheets, liveMatrixUrl, pickSections, type PrintCellModel, type PrintPageModel, type PrintSheetModel } from "@/lib/allergy-matrix-print";
import { matrixDishesForVenue } from "@/lib/allergy-matrix-store";
import { isKitchenVenue } from "@/lib/kitchen";
import { nextVersion, printKey, printRow } from "@/lib/matrix-prints";
import { qrModules, qrPath, qrSize } from "@/lib/qr";
import { useStore } from "@/lib/store";
import { useToast } from "../ui";
import { useAllergenIndex } from "../allergen-picker";
import { VENUE_SHORT } from "../venue";

/** A4 landscape at 96dpi. The sheet is drawn at this size and scaled down with a transform to fit the screen. */
const SHEET_PX = (PAGE_W_MM / 25.4) * 96;
const SHEET_PX_H = (210 / 25.4) * 96;

const ICON: Record<MatrixState, LucideIcon> = { red: X, yellow: TriangleAlert, green: Check, grey: CircleHelp };

/**
 * The Allergy Matrix print preview (Troy, 10 Oct 2026): one A4 LANDSCAPE sheet per menu section, as it will print, full screen
 * over the app (so the app shell is never on screen or on paper), with a toolbar that is never printed. Same technique as the
 * recipe print (components/print/print-view.tsx): rendered into its own element on <body>, with `<html data-print-job>` making
 * the print stylesheet hide everything else. The browser's own print dialog has Save as PDF, so there is no PDF code here.
 * Every cell prints its word (No, Swap with the note, Yes, Not checked) beside its colour and icon, so a black and white
 * print reads as well. Nothing is saved and no price, cost or target is ever on the sheet.
 */
export function MatrixPrintView({ venueSlug, section }: { venueSlug: string; section: string | null }) {
  const store = useStore();
  const idx = useAllergenIndex();
  const router = useRouter();
  const toast = useToast();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const { loadMatrixPrints } = store;
  useEffect(() => {
    loadMatrixPrints();
  }, [loadMatrixPrints]);

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

  const venue = store.venues.find((v) => v.slug === venueSlug) ?? null;
  const venueName = venue ? VENUE_SHORT[venue.slug] ?? venue.name : "";
  const allRows = useMemo(() => (venue ? buildRows(matrixDishesForVenue(store.items, idx, venue.id)) : []), [venue, store.items, idx]);
  const sections = useMemo(() => matrixSections(allRows), [allRows]);
  const picked = useMemo(() => pickSections(sections, section), [sections, section]);
  const [now] = useState(() => new Date());

  // The version this print will carry: the previous highest for this venue and section (or All Sections), plus one. Taken ONCE when the
  // print log has loaded and then held, so logging the print never changes the number on the sheet that is being printed. If the log
  // cannot be read within a few seconds the sheet prints without a version (and says so) rather than blocking the print.
  const key = printKey(section);
  const [version, setVersion] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (version !== undefined || !venue) return;
    if (store.matrixPrints) setVersion(nextVersion(store.matrixPrints, venue.id, key));
  }, [version, venue, store.matrixPrints, key]);
  useEffect(() => {
    if (version !== undefined) return;
    const t = window.setTimeout(() => setVersion((v) => (v === undefined ? null : v)), 4000);
    return () => window.clearTimeout(t);
  }, [version]);

  const crossContact = crossContactFromSettings(store.rawSettings, venueSlug);
  // the QR code opens the LIVE iPad matrix for this venue (only venues that have the kitchen iPad screen)
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const qrUrl = venue && origin && isKitchenVenue(venue.slug) ? liveMatrixUrl(origin, venue.slug) : null;
  const sheets = useMemo(() => buildMatrixSheets({ venueName, sections: picked, now, version: version ?? null, crossContact, qrUrl }), [venueName, picked, now, version, crossContact, qrUrl]);
  const notChecked = sheets.reduce((n, s) => n + s.notCheckedCount, 0);
  const pageCount = sheets.reduce((n, s) => n + s.pages.length, 0);

  useEffect(() => {
    document.title = sheets.length === 1 ? `${venueName} Allergy Matrix ${sheets[0].sectionLabel}` : `${venueName} Allergy Matrix`;
  }, [sheets, venueName]);

  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!root) return;
    const measure = () => setScale(Math.min(1, Math.max(0.2, (root.clientWidth - 32) / SHEET_PX)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [root]);

  // the print is logged ONCE per preview (pressing Print again prints the same sheet without making a second version)
  const logged = useRef(false);
  const [logNote, setLogNote] = useState<string | null>(null);
  const onPrint = async () => {
    if (document.fonts && document.fonts.status !== "loaded") await document.fonts.ready;
    if (venue && version != null && !logged.current) {
      logged.current = true;
      try {
        await store.logMatrixPrint(printRow({ venueId: venue.id, key, version, by: store.userEmail, rows: allRows }));
      } catch (e) {
        // quietly: the sheet still prints, we only say the log did not take it
        logged.current = false;
        const msg = "The print log could not be saved. The sheet still prints.";
        setLogNote(msg);
        toast.show({ message: msg });
        void e;
      }
    }
    window.print();
  };
  const onBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(`/matrix${venue ? `?venue=${venue.slug}` : ""}`);
  };

  if (!root) return <p className="py-10 text-center text-[15px] text-label-2">Preparing the print preview…</p>;

  const ready = store.ready;
  return createPortal(
    <>
      <style>{MATRIX_PRINT_CSS}</style>
      <div className="am-noprint bar-blur sticky top-0 z-10 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)]" style={{ boxShadow: "inset 0 -0.5px 0 var(--separator)" }}>
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={onBack} className="-ml-1 inline-flex min-h-[44px] min-w-[44px] items-center gap-0 pr-3 text-[17px] font-medium text-accent">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
            Back
          </button>
          <div className="min-w-0 flex-1 basis-[160px]">
            <p className="truncate text-[17px] font-semibold leading-tight">Print Preview</p>
            <p className="truncate text-[13px] leading-tight text-label-2">
              {!ready ? "Loading dishes" : sheets.length ? `${sheets.length} ${sheets.length === 1 ? "matrix" : "matrices"}, ${pageCount} ${pageCount === 1 ? "page" : "pages"}, A4 landscape` : "Nothing to print"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onPrint()}
            disabled={!sheets.length}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl bg-accent-fill px-5 text-[17px] font-semibold text-accent-on transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            <Printer className="h-5 w-5" strokeWidth={2.25} aria-hidden />
            Print
          </button>
        </div>
        {logNote ? (
          <p className="mx-auto mt-1 flex max-w-[960px] items-start gap-2 text-[14px] font-semibold leading-snug text-warn" role="status">
            <TriangleAlert className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
            <span>{logNote}</span>
          </p>
        ) : null}
        {version === null && ready ? (
          <p className="mx-auto mt-1 text-[13px] leading-snug text-label-2" role="status">
            The print log could not be read, so this sheet has no version number.
          </p>
        ) : null}
        {notChecked ? (
          <p className="mx-auto mt-1 flex max-w-[960px] items-start gap-2 text-[14px] font-semibold leading-snug text-warn" role="status">
            <TriangleAlert className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
            <span>
              {notChecked} {notChecked === 1 ? "dish is" : "dishes are"} not confirmed yet and will print grey, Not checked. Confirm them in the recipe first if you want real answers.
            </span>
          </p>
        ) : null}
      </div>

      <div className="am-stage">
        {ready && (!venue || !sheets.length) ? (
          <div className="am-noprint mt-16 max-w-sm text-center">
            <p className="text-[20px] font-semibold">Nothing To Print</p>
            <p className="mt-1.5 text-[15px] text-label-2">{!venue ? "That venue could not be found." : section && section !== "*" ? "That section has no active food dishes." : "This venue has no active food dishes."} Go back and choose again.</p>
          </div>
        ) : null}
        {sheets.flatMap((sheet) => sheet.pages.map((page) => <PageBox key={`${sheet.key}:${page.number}`} sheet={sheet} page={page} scale={scale} />))}
      </div>
    </>,
    root,
  );
}

/** One page in the preview: the scaled A4 landscape sheet. The box follows the sheet's real height. */
function PageBox({ sheet, page, scale }: { sheet: PrintSheetModel; page: PrintPageModel; scale: number }) {
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
    <section className="am-item" style={{ width: SHEET_PX * scale }} aria-label={`${sheet.title}, ${sheet.sectionLabel}, page ${page.number} of ${page.of}`}>
      <div className="am-scale" style={{ width: SHEET_PX * scale, height: h * scale }}>
        <div ref={sheetRef} className="am-sheet" style={{ transform: `scale(${scale})` }}>
          <SheetPage sheet={sheet} page={page} />
        </div>
      </div>
    </section>
  );
}

function PrintCell({ cell }: { cell: PrintCellModel }) {
  const Icon = ICON[cell.state];
  return (
    <td className={`am-c am-${cell.state}`}>
      <span className="am-word">
        <Icon aria-hidden className="am-icon" strokeWidth={3} />
        {cell.word}
      </span>
      {cell.note ? <span className="am-note">{cell.note}</span> : null}
    </td>
  );
}

/** One printed page: title, section, legend, the table with its heading, and the footer. Every page stands alone on the wall. */
function SheetPage({ sheet, page }: { sheet: PrintSheetModel; page: PrintPageModel }) {
  return (
    <div className="am-page">
      <header className="am-head">
        <h1 className="am-title">{sheet.title}</h1>
        <p className="am-section">{sheet.sectionLabel}</p>
      </header>
      <p className="am-legend">{sheet.legend}</p>
      <table className="am-table">
        <colgroup>
          <col style={{ width: `${DISH_COL_MM}mm` }} />
          {sheet.columns.map((c) => (
            <col key={c.id} style={{ width: `${ANSWER_COL_MM}mm` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="am-dish">
              Dish
            </th>
            {sheet.columns.map((c) => (
              <th key={c.id} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="am-dish">
                {r.name}
              </th>
              {r.cells.map((c, i) => (
                <PrintCell key={sheet.columns[i].id} cell={c} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="am-foot">
        <div className="am-foot-text">
          <p>
            {sheet.versionLine ? `${sheet.versionLine}. ` : ""}
            {sheet.printedLine}. {sheet.footerNote}.
          </p>
          <p className="am-cross">{sheet.crossContact}</p>
        </div>
        <div className="am-foot-right">
          <span className="am-pageno">{page.of > 1 ? `${sheet.sectionLabel}, page ${page.number} of ${page.of}` : sheet.sectionLabel}</span>
          {sheet.qrUrl ? (
            <div className="am-qr">
              <QrCode text={sheet.qrUrl} />
              <span>Live matrix</span>
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** The footer QR code: drawn as one SVG path, black on white with a quiet zone, from `lib/qr.ts` (the encoder is loaded on this page only). */
function QrCode({ text }: { text: string }) {
  const [code, setCode] = useState<{ path: string; size: number } | null>(null);
  useEffect(() => {
    let alive = true;
    qrModules(text).then(
      (m) => alive && setCode({ path: qrPath(m), size: qrSize(m) }),
      () => alive && setCode(null),
    );
    return () => {
      alive = false;
    };
  }, [text]);
  if (!code) return <span style={{ display: "block", width: "19mm", height: "19mm" }} aria-hidden />;
  return (
    <svg viewBox={`0 0 ${code.size} ${code.size}`} shapeRendering="crispEdges" role="img" aria-label="QR code that opens the live allergy matrix" xmlns="http://www.w3.org/2000/svg">
      <rect width={code.size} height={code.size} fill="#fff" />
      <path d={code.path} fill="#000" />
    </svg>
  );
}
