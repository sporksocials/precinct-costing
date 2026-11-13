import { INK, SCALE_START } from "@/lib/cheat-sheet";
import { PRINT_SHELL_CSS } from "./print-css";

const GREY = "#6b665f";
const LINE = "#e3dccf";
const CREAM = "#F2F1EB";

/**
 * The Kitchen Cheat Sheet's preview and print stylesheet. It shares the print shell with the recipe print (the full screen
 * layer, the stage, the page box, "hide everything else when printing") and adds its own sheet: A4 LANDSCAPE, page margin 0
 * (the sheet draws its own 6 to 7mm edge, and a zero margin also keeps the browser's own header and footer off the paper).
 *
 * One page = one `.pr-item` over a `.pr-scale` that holds the sheet. On screen the sheet is real A4 landscape size, scaled down
 * with a transform to fit the screen width; printing drops the transform. Ink on white, apart from the five role bars, and every
 * bar carries its word. Text sizes are all in em of the column font size, which is `10.4pt x --cs`; the fit (lib/cheat-sheet.ts
 * fitScale) sets --cs on each page, from 1.25 down to 0.55, until no column overflows. The sheet is 209.6mm tall, not 210: the
 * spare 0.4mm stops a rounding error adding a blank page.
 */
export const CHEAT_CSS = `
@page { size: A4 landscape; margin: 0; }
${PRINT_SHELL_CSS}
.cs-sheet { box-sizing: border-box; width: 297mm; height: 209.6mm; background: #fff; transform-origin: top left; box-shadow: 0 2px 16px rgba(0, 0, 0, 0.55); overflow: hidden; }
.cs-sheet, .cs-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

.cs-page { box-sizing: border-box; width: 100%; height: 100%; padding: 6mm 7mm 3mm; display: flex; flex-direction: column; font-family: var(--font-body), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.25; color: ${INK}; background: #fff; -webkit-text-size-adjust: none; text-size-adjust: none; --cs: ${SCALE_START}; }
.cs-page * { box-sizing: border-box; }

.cs-hd { flex: none; display: flex; align-items: center; gap: 5mm; height: 12mm; border-bottom: 0.9mm solid ${INK}; margin-bottom: 2.5mm; }
.cs-logo { display: block; height: 10mm; width: auto; max-width: 40mm; object-fit: contain; }
.cs-logo[data-invert] { filter: invert(1); }
.cs-venue { font-size: 11pt; font-weight: 800; }
.cs-hd h1 { margin: 0; font-family: var(--font-display), Impact, sans-serif; font-weight: 400; font-size: 22pt; line-height: 1; letter-spacing: 0.03em; }
.cs-hd-sub { margin-left: auto; font-size: 9pt; color: ${GREY}; text-align: right; }

.cs-cols { flex: 1 1 0; min-height: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr); gap: 2.2mm; }
.cs-col { min-height: 0; border: 0.45mm solid ${INK}; border-radius: 2mm; padding: 1.8mm; display: flex; flex-direction: column; overflow: hidden; font-size: calc(10.4pt * var(--cs)); }
.cs-sec { font-size: 0.72em; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: ${GREY}; }
.cs-title { margin: 0.4mm 0 0.8mm; font-family: var(--font-display), Impact, sans-serif; font-weight: 400; font-size: calc(19pt * var(--cs)); line-height: 0.92; letter-spacing: 0.01em; min-height: 1.85em; overflow-wrap: anywhere; }
.cs-pcs { display: inline-block; background: ${INK}; color: #fff; font-family: var(--font-display), Impact, sans-serif; font-size: 0.95em; line-height: 1; letter-spacing: 0.08em; padding: 0.7mm 1.8mm 0.4mm; border-radius: 0.8mm; margin-left: 1.5mm; vertical-align: 2px; }
.cs-photo { flex: none; position: relative; margin-bottom: 1.2mm; }
.cs-img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 1.6mm; }
.cs-img-none { display: flex; align-items: center; justify-content: center; text-align: center; background: ${CREAM}; border: 0.35mm dashed ${GREY}; color: ${GREY}; font-size: 0.8em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }

.cs-g { flex: none; margin-top: 0.9mm; }
.cs-gl { font-size: 0.68em; font-weight: 800; letter-spacing: 0.1em; padding: 0.7mm 1.6mm 0.5mm; border-radius: 0.8mm; }
.cs-it { display: flex; justify-content: space-between; gap: 1mm; align-items: baseline; border-bottom: 0.2mm solid ${LINE}; padding: 0.55mm 0.3mm 0.4mm; line-height: 1.14; }
.cs-it b { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
.cs-it i { font-style: normal; font-size: 0.86em; color: ${GREY}; white-space: nowrap; font-weight: 600; }
.cs-ves { flex: none; margin-top: auto; padding-top: 1mm; display: flex; gap: 1mm; align-items: flex-end; font-size: 0.78em; color: ${GREY}; }
.cs-ves span { flex: 1; height: 3.2mm; border-bottom: 0.3mm dotted ${GREY}; }

.cs-foot { flex: none; margin-top: 1.4mm; height: 4mm; display: flex; justify-content: space-between; align-items: center; gap: 4mm; font-size: 7pt; color: ${GREY}; white-space: nowrap; }
.cs-foot > div:first-child { white-space: pre; }
.cs-legend { display: flex; gap: 2mm; }
.cs-legend span { padding: 0.3mm 1.8mm; border-radius: 0.8mm; font-weight: 800; font-size: 6.5pt; letter-spacing: 0.07em; }

.cs-note { flex: none; border: 0.45mm dashed ${GREY}; border-radius: 2mm; padding: 2.4mm; font-size: 9.5pt; line-height: 1.3; margin-bottom: 3mm; }
.cs-keybox { flex: 1 1 0; min-height: 0; border: 0.45mm solid ${INK}; border-radius: 2mm; padding: 4mm; overflow: hidden; display: flex; flex-direction: column; font-size: calc(10pt * var(--cs)); }
.cs-keybox h2 { margin: 0 0 2.5mm; font-family: var(--font-display), Impact, sans-serif; font-weight: 400; font-size: calc(20pt * var(--cs)); line-height: 1; letter-spacing: 0.02em; }
.cs-keywrap { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
.cs-sk { flex: 1 1 0; min-height: 0; column-gap: 8mm; line-height: 1.26; }
.cs-sk > div { break-inside: avoid; margin-bottom: 2.2mm; }
.cs-sk b { display: block; font-size: 1.15em; color: #8F5F56; }
.cs-empty { color: ${GREY}; }

@media print {
  .cs-sheet { transform: none !important; box-shadow: none !important; margin: 0 !important; width: 297mm !important; height: 209.6mm !important; }
}
`;
