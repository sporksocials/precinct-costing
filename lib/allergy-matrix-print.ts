import { DEFAULT_CROSS_CONTACT, MATRIX_COLUMNS, MATRIX_FOOTER_NOTE, MATRIX_LEGEND, STATE_WORD, crossContactLine, type MatrixSection, type MatrixState } from "./allergy-matrix";

/**
 * The printed Allergy Matrix model (Troy, 10 Oct 2026): A4 LANDSCAPE, one matrix per (venue, section). Pure: it turns the
 * section rows into sheets and pages; components/matrix/print-view.tsx draws them. Nothing here holds a cost, price, GP,
 * target or supplier (tests/allergy-matrix.test.ts walks the model for that), and every cell carries its WORD so a black and
 * white print reads as well as a coloured one.
 *
 * Paging. The sheet is laid out in fixed millimetres (table-layout: fixed, the widths below), so the height of a row can be
 * estimated from the longest note in it. Rows are filled onto pages up to a conservative budget; each page repeats the title,
 * the legend and the column heading, so every laminated page stands alone. The print stylesheet also stops a row splitting and
 * repeats the heading group, so a row that was estimated a little short still never tears across two pages.
 */

export const PAGE_W_MM = 297;
export const PAGE_H_MM = 210;
export const PAGE_MARGIN_MM = 9;
export const BODY_W_MM = PAGE_W_MM - 2 * PAGE_MARGIN_MM; // 279
export const BODY_H_MM = PAGE_H_MM - 2 * PAGE_MARGIN_MM; // 192

/** the dish column and the eleven answer columns */
export const DISH_COL_MM = 44;
export const ANSWER_COL_MM = (BODY_W_MM - DISH_COL_MM) / MATRIX_COLUMNS.length; // about 20.3

/** type sizes in points; nothing in a cell is below MIN_BODY_PT (it has to read off a laminated sheet) */
export const MIN_BODY_PT = 11;
export const BODY_PT = 11;
export const DISH_PT = 12;
export const TITLE_PT = 20;
export const FOOTER_PT = 10;

export interface PrintCellModel {
  state: MatrixState;
  /** the printed word: No, Swap, Yes, Not checked */
  word: string;
  /** yellow only */
  note: string | null;
}

export interface PrintRowModel {
  id: string;
  name: string;
  /** in MATRIX_COLUMNS order */
  cells: PrintCellModel[];
}

export interface PrintPageModel {
  /** 1-based, within its section */
  number: number;
  of: number;
  rows: PrintRowModel[];
}

export interface PrintSheetModel {
  key: string;
  title: string;
  venueName: string;
  sectionLabel: string;
  legend: string;
  columns: { id: string; label: string }[];
  pages: PrintPageModel[];
  /** "Printed 10 Oct 2026, Brisbane time" */
  printedLine: string;
  /** "Sheet version 3", or null when the print log could not be read (the sheet then has no version) */
  versionLine: string | null;
  footerNote: string;
  /** the venue's standing cross-contact line, printed on every page (its own or the default) */
  crossContact: string;
  /** the address the footer QR code opens (the live kitchen iPad matrix), or null when the venue has no iPad matrix */
  qrUrl: string | null;
  /** dishes on the sheet that are not signed off (they print grey, Not checked) */
  notCheckedCount: number;
}

/* ------------------------------------------------------------------ paging */

/** Printable height of a page's body, after the title block, the heading row and the footer (mm). Deliberately a little short. */
export const PAGE_ROW_BUDGET_MM = 126;
export const MIN_ROW_MM = 11;
const LINE_MM = 4.9; // 11pt at 1.25 leading is 4.85mm
const ROW_PAD_MM = 3.6;
/** about how many characters of 11pt text fit a line of an answer column, and of the dish column at 12pt bold */
export const CHARS_PER_LINE = 8;
export const DISH_CHARS_PER_LINE = 17;

function wrappedLines(text: string, perLine: number): number {
  if (!text) return 1;
  // greedy word wrap, a word longer than a line breaks across lines
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = word.length;
    if (w > perLine) {
      const extra = Math.ceil(w / perLine);
      lines += used > 0 ? extra : extra - 1;
      used = w % perLine || perLine;
    } else if (used === 0) used = w;
    else if (used + 1 + w <= perLine) used += 1 + w;
    else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}

/** The estimated height of a row in mm: the tallest of the dish name and the notes, never below the minimum row. */
export function estimateRowMm(row: PrintRowModel): number {
  const dish = wrappedLines(row.name, DISH_CHARS_PER_LINE);
  let cellLines = 1;
  for (const c of row.cells) {
    // a yellow cell prints the word Swap on its own line, then the note
    const n = c.note ? 1 + wrappedLines(c.note, CHARS_PER_LINE) : c.state === "grey" ? wrappedLines(c.word, CHARS_PER_LINE) : 1;
    if (n > cellLines) cellLines = n;
  }
  return Math.max(MIN_ROW_MM, Math.max(dish, cellLines) * LINE_MM + ROW_PAD_MM);
}

/** Splits rows into pages by estimated height. Always at least one page; a single very tall row gets a page of its own. */
export function paginate(rows: readonly PrintRowModel[], budgetMm: number = PAGE_ROW_BUDGET_MM): PrintRowModel[][] {
  const pages: PrintRowModel[][] = [];
  let cur: PrintRowModel[] = [];
  let used = 0;
  for (const r of rows) {
    const h = estimateRowMm(r);
    if (cur.length && used + h > budgetMm) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(r);
    used += h;
  }
  if (cur.length || !pages.length) pages.push(cur);
  return pages;
}

/* ------------------------------------------------------------------ the model */

const DATE_FORMAT = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" });

/** "10 Oct 2026" in Brisbane time. */
export function printedDate(now: Date): string {
  const p = Object.fromEntries(DATE_FORMAT.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.day} ${String(p.month).slice(0, 3)} ${p.year}`;
}

export function printedLine(now: Date): string {
  return `Printed ${printedDate(now)}, Brisbane time`;
}

function rowModel(r: MatrixSection["rows"][number]): PrintRowModel {
  return {
    id: r.dish.id,
    name: r.dish.name,
    cells: MATRIX_COLUMNS.map((c) => {
      const cell = r.cells[c.id];
      return { state: cell.state, word: STATE_WORD[cell.state], note: cell.state === "yellow" ? cell.note ?? null : null };
    }),
  };
}

export function versionLine(version: number | null | undefined): string | null {
  return version == null ? null : `Sheet version ${version}`;
}

/** The live iPad matrix a printed sheet's QR code opens. */
export function liveMatrixUrl(origin: string, venueSlug: string): string {
  return `${origin.replace(/\/+$/, "")}/kitchen/${venueSlug}/matrix`;
}

/** One sheet per section that has at least one dish. */
export function buildMatrixSheets(input: { venueName: string; sections: readonly MatrixSection[]; now: Date; version?: number | null; crossContact?: string | null; qrUrl?: string | null }): PrintSheetModel[] {
  const line = printedLine(input.now);
  const crossContact = crossContactLine(input.crossContact);
  return input.sections
    .filter((s) => s.rows.length > 0)
    .map((s) => {
      const rows = s.rows.map(rowModel);
      const chunks = paginate(rows);
      return {
        key: `${input.venueName}:${s.label}`,
        title: `${input.venueName} Allergy Matrix`,
        venueName: input.venueName,
        sectionLabel: s.label,
        legend: MATRIX_LEGEND,
        columns: MATRIX_COLUMNS.map((c) => ({ id: c.id, label: c.label })),
        pages: chunks.map((rs, i) => ({ number: i + 1, of: chunks.length, rows: rs })),
        printedLine: line,
        versionLine: versionLine(input.version),
        footerNote: MATRIX_FOOTER_NOTE,
        crossContact,
        qrUrl: input.qrUrl ?? null,
        notCheckedCount: s.rows.filter((r) => !r.confirmed).length,
      };
    });
}

/** The address of the print preview: /matrix/print?venue=drift&section=Mains, or section=* for every section. */
export function matrixPrintHref(venueSlug: string, section: string | null): string {
  const p = new URLSearchParams({ venue: venueSlug, section: section ?? "*" });
  return `/matrix/print?${p.toString()}`;
}

/** The sections a print job wants: "*" or nothing = all of them, otherwise the one with that label (case blind). */
export function pickSections(all: readonly MatrixSection[], wanted: string | null | undefined): MatrixSection[] {
  const w = (wanted ?? "").trim();
  if (!w || w === "*") return [...all];
  const hit = all.filter((s) => s.label.toLowerCase() === w.toLowerCase());
  return hit;
}

/**
 * The print stylesheet. Landscape A4, 9mm margins, colour kept on paper, the heading group repeats and a row never splits.
 * Only rendered inside the print preview (like components/print/print-css.ts), so it cannot touch any other screen.
 */
export const MATRIX_PRINT_CSS = `
@page { size: A4 landscape; margin: ${PAGE_MARGIN_MM}mm; }

#print-root { position: fixed; inset: 0; z-index: 100; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; background: var(--bg); color: var(--label); }
.am-stage { display: flex; flex-direction: column; align-items: center; gap: 22px; padding: 16px 16px calc(40px + env(safe-area-inset-bottom)); }
.am-item { flex: none; }
.am-scale { position: relative; flex: none; }
.am-sheet { box-sizing: border-box; width: ${PAGE_W_MM}mm; min-height: ${PAGE_H_MM}mm; padding: ${PAGE_MARGIN_MM}mm; background: #fff; color: #000; transform-origin: top left; box-shadow: 0 2px 16px rgba(0, 0, 0, 0.55); }

.am-page { box-sizing: border-box; width: ${BODY_W_MM}mm; min-height: ${BODY_H_MM}mm; display: flex; flex-direction: column; font-family: var(--font-body), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${BODY_PT}pt; line-height: 1.25; color: #000; background: #fff; -webkit-text-size-adjust: none; text-size-adjust: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.am-page * { box-sizing: border-box; }
.am-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6mm; border-bottom: 0.6mm solid #000; padding-bottom: 1.5mm; }
.am-title { margin: 0; font-size: ${TITLE_PT}pt; font-weight: 800; line-height: 1.05; letter-spacing: -0.01em; }
.am-section { margin: 0; font-size: 14pt; font-weight: 700; white-space: nowrap; }
.am-legend { margin: 1.6mm 0 2mm; font-size: ${BODY_PT}pt; font-weight: 600; line-height: 1.25; }

.am-table { width: ${BODY_W_MM}mm; table-layout: fixed; border-collapse: collapse; }
.am-table th, .am-table td { border: 0.35mm solid #000; padding: 1mm 1.2mm; vertical-align: middle; text-align: center; overflow-wrap: anywhere; }
.am-table thead { display: table-header-group; }
.am-table tr { break-inside: avoid; page-break-inside: avoid; }
.am-table tbody tr { height: ${MIN_ROW_MM}mm; }
.am-table thead th { font-size: ${BODY_PT}pt; font-weight: 700; line-height: 1.15; letter-spacing: -0.01em; padding: 1mm 0.4mm; overflow-wrap: normal; background: #fff; vertical-align: bottom; }
.am-table th.am-dish, .am-table td.am-dish { width: ${DISH_COL_MM}mm; text-align: left; font-size: ${DISH_PT}pt; font-weight: 700; }
.am-table td.am-c { font-size: ${BODY_PT}pt; font-weight: 700; line-height: 1.2; }
.am-word { display: block; font-size: ${BODY_PT}pt; font-weight: 800; letter-spacing: 0.01em; }
.am-note { display: block; margin-top: 0.4mm; font-size: ${BODY_PT}pt; font-weight: 600; }
.am-red { background: #f08a80 !important; color: #000; }
.am-yellow { background: #ffe35a !important; color: #000; }
.am-green { background: #a9e3b8 !important; color: #000; }
.am-grey { background: #d6d6d6 !important; color: #000; background-image: repeating-linear-gradient(135deg, #bdbdbd 0 1.2mm, #d6d6d6 1.2mm 2.4mm) !important; }
.am-icon { display: inline-block; width: 3.2mm; height: 3.2mm; vertical-align: -0.5mm; margin-right: 0.8mm; }
.am-foot { margin-top: auto; padding-top: 1.6mm; display: flex; align-items: flex-end; justify-content: space-between; gap: 6mm; font-size: ${FOOTER_PT}pt; line-height: 1.25; }
.am-foot-text { min-width: 0; flex: 1; }
.am-foot-text p { margin: 0; }
.am-cross { margin-top: 1mm !important; font-size: ${BODY_PT}pt; font-weight: 700; line-height: 1.25; }
.am-foot-right { display: flex; align-items: flex-end; gap: 4mm; flex: none; }
.am-pageno { white-space: nowrap; }
.am-qr { display: flex; flex-direction: column; align-items: center; gap: 0.6mm; font-size: 8pt; font-weight: 700; line-height: 1.1; text-align: center; }
.am-qr svg { display: block; width: 19mm; height: 19mm; }
.am-nc { margin: 0 0 1.5mm; font-size: ${BODY_PT}pt; font-weight: 700; }

@media print {
  html[data-print-job] { background: #fff !important; color-scheme: light !important; }
  html[data-print-job] body { background: #fff !important; min-height: 0 !important; }
  html[data-print-job] body > *:not(#print-root) { display: none !important; }
  #print-root { position: static !important; inset: auto !important; overflow: visible !important; background: #fff !important; z-index: auto !important; }
  .am-noprint { display: none !important; }
  .am-stage { display: block !important; padding: 0 !important; gap: 0 !important; }
  .am-item { width: auto !important; break-after: page; page-break-after: always; }
  .am-item:last-child { break-after: auto; page-break-after: auto; }
  .am-scale { position: static !important; width: auto !important; height: auto !important; }
  .am-sheet { transform: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; width: ${BODY_W_MM}mm !important; min-height: 0 !important; }
  .am-page { min-height: ${BODY_H_MM - 1}mm !important; }
}
`;
