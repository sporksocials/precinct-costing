import type { Workbook } from "exceljs";
import { sheetTabName, type PosRow, type PosSheet } from "./pos-list";

/**
 * Writes the POS list workbook (one tab per venue plus a Notes tab). The layout follows the hand-built Chiobu sheet:
 * title row, subtitle line, GST rate cell, frozen dark header, blue price inputs, ex GST as a real formula, yellow rows
 * for anything that needs a look. exceljs is imported here, inside the function, so it only loads when someone taps
 * Download POS List and never enters the normal page bundle.
 */

export const POS_HEADERS = ["Menu Group", "Item", "POS Button Name", "Size / Option", "Price inc GST", "Price ex GST", "Happy Hour inc GST", "Notes"] as const;
const WIDTHS = [22, 34, 22, 18, 14, 14, 19, 46];
/** Row of the header; everything above it (title, subtitle, GST rate) stays on screen when scrolling. */
export const HEADER_ROW = 4;
/** The GST rate input sits here, on every venue tab. The ex GST formulas point at it. */
export const GST_CELL = "G2";

const FONT = "Arial";
const YELLOW = "FFFFF2A8";
const DARK = "FF1F1F1F";
const RULE = "FFD9D9D9";
const MONEY = "$#,##0.00";

export interface PosWorkbookOptions {
  /** GST as a rate, 0.1 for 10% (the app's gst_rate setting) */
  gstRate: number;
  /** "7 Oct 2026" */
  dateLabel: string;
}

export function notesLines(opts: Pick<PosWorkbookOptions, "dateLabel">, hasGelato: boolean): { heading: string; lines: string[] } {
  const lines = [
    "One row per thing the POS sells. A drink sold in several sizes has one row per size. In the POS, set it up as one item with size options, or as separate buttons, whichever suits the venue.",
    "Item is the full menu name. POS Button Name is a shorter version (19 characters or fewer) for buttons and kitchen dockets.",
    `Price inc GST is the menu price as at ${opts.dateLabel}. Price ex GST is worked out from the GST rate in cell ${GST_CELL} at the top of each venue tab, so change the rate there and every row follows.`,
    "Happy hour is set in the POS as a time-based price. The Happy Hour inc GST column holds the price to use during the happy hour window.",
    "Yellow rows need a look before setup: a missing price, or a button name that is too long and needs shortening by hand.",
  ];
  if (hasGelato) lines.push("Gelato has one row per serve. Flavours are not listed here.");
  return { heading: "How to use this list", lines };
}

function addVenueSheet(wb: Workbook, sheet: PosSheet, tab: string, opts: PosWorkbookOptions) {
  const ws = wb.addWorksheet(tab, {
    views: [{ state: "frozen", ySplit: HEADER_ROW, showGridLines: true }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}` },
  });
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const title = ws.getCell("A1");
  title.value = `${sheet.venue.name} POS List`;
  title.font = { name: FONT, size: 14, bold: true };
  const sub = ws.getCell("A2");
  sub.value = `${sheet.venue.name} menu and prices as at ${opts.dateLabel}. Yellow rows need a look before setup.`;
  sub.font = { name: FONT, size: 9, color: { argb: "FF555555" } };
  const gstLabel = ws.getCell("F2");
  gstLabel.value = "GST rate";
  gstLabel.font = { name: FONT, size: 9, bold: true };
  gstLabel.alignment = { horizontal: "right" };
  const gst = ws.getCell(GST_CELL);
  gst.value = opts.gstRate;
  gst.numFmt = "0%";
  gst.font = { name: FONT, size: 9, color: { argb: "FF0000FF" } };
  gst.alignment = { horizontal: "left" };

  const head = ws.getRow(HEADER_ROW);
  POS_HEADERS.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
    c.alignment = { vertical: "middle", horizontal: i >= 4 && i <= 6 ? "right" : "left", wrapText: true };
  });
  head.height = 30;

  let prevGroup: string | null = null;
  sheet.rows.forEach((r: PosRow, i) => {
    const n = HEADER_ROW + 1 + i;
    const row = ws.getRow(n);
    const values: Array<string | number | { formula: string; result?: number } | null> = [
      r.group,
      r.item,
      r.button,
      r.size || null,
      r.priceInc,
      r.priceInc != null ? { formula: `E${n}/(1+$G$2)`, result: r.priceInc / (1 + opts.gstRate) } : null,
      r.hhInc,
      r.notes || null,
    ];
    values.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      if (v != null) cell.value = v;
      const money = c >= 4 && c <= 6;
      cell.font = { name: FONT, size: 10, bold: c === 1, color: c === 4 || c === 6 ? { argb: "FF0000FF" } : undefined };
      if (money) {
        cell.numFmt = MONEY;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else cell.alignment = { vertical: "middle", wrapText: c === 7 };
      cell.border = {
        bottom: { style: "thin", color: { argb: RULE } },
        ...(r.group !== prevGroup && i > 0 ? { top: { style: "thin", color: { argb: "FF8C8C8C" } } } : {}),
      };
      if (r.needsLook) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
    });
    prevGroup = r.group;
  });

  const last = HEADER_ROW + Math.max(sheet.rows.length, 1);
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: last, column: POS_HEADERS.length } };
}

function addNotesSheet(wb: Workbook, opts: PosWorkbookOptions, hasGelato: boolean) {
  const ws = wb.addWorksheet("Notes", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.getColumn(1).width = 120;
  const { heading, lines } = notesLines(opts, hasGelato);
  const h = ws.getCell("A1");
  h.value = heading;
  h.font = { name: FONT, size: 12, bold: true };
  lines.forEach((l, i) => {
    const c = ws.getCell(`A${i + 2}`);
    c.value = `• ${l}`;
    c.font = { name: FONT, size: 10 };
    c.alignment = { wrapText: true, vertical: "top" };
  });
}

/** Builds the workbook: one tab per sheet (tab name = the venue's short name), then the Notes tab. */
export async function buildPosWorkbook(sheets: PosSheet[], opts: PosWorkbookOptions): Promise<Workbook> {
  const mod = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Caloundra Food Precinct";
  wb.created = new Date();
  const taken = new Set<string>(["notes"]);
  for (const s of sheets) {
    const tab = sheetTabName(s.venue.short, taken);
    taken.add(tab.toLowerCase());
    addVenueSheet(wb, s, tab, opts);
  }
  addNotesSheet(wb, opts, sheets.some((s) => s.rows.some((r) => r.group === "Gelato")));
  return wb;
}

/** The .xlsx file contents. In the browser this is an ArrayBuffer-like, in node a Buffer. */
export async function buildPosXlsx(sheets: PosSheet[], opts: PosWorkbookOptions): Promise<ArrayBuffer | Uint8Array> {
  const wb = await buildPosWorkbook(sheets, opts);
  return (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer | Uint8Array;
}
